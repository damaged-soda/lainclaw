import { trace, type SpanContext } from '@opentelemetry/api';
import type { RuntimeAgentEvent } from '../../shared/types.js';
import { buildDebugObservationContent } from '../../shared/debug.js';
import {
  isLangfuseTracingReady,
  runLangfuseOperationSafely,
  startObservation,
} from '../../observability/langfuse.js';
import type { ChannelOutboundTextCapability } from '../contracts.js';

const DEFAULT_SLOW_ACK_TEXT = '已收到，正在处理。完成后我会继续把结果发给你。';

const PROGRESS_EVENT_TYPES = new Set([
  'agent_start',
  'turn_start',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'turn_end',
  'agent_end',
]);

type FeishuTurnState =
  | 'created'
  | 'running'
  | 'ack_sent'
  | 'completed'
  | 'failed';

export interface FeishuTurnControllerOptions {
  requestId: string;
  sessionKey: string;
  replyTo: string;
  slowAckDelayMs: number;
  outbound: ChannelOutboundTextCapability;
  debug?: boolean;
  slowAckText?: string;
}

export interface FeishuTurnController {
  onAgentEvent(event: RuntimeAgentEvent): Promise<void>;
  complete(text: string): Promise<void>;
  fail(text: string): Promise<void>;
  dispose(): void;
}

class DefaultFeishuTurnController implements FeishuTurnController {
  private readonly startedAt = Date.now();

  private lastProgressAt = this.startedAt;

  private state: FeishuTurnState = 'created';

  private ackSent = false;

  private settled = false;

  private slowAckTimer: ReturnType<typeof setTimeout> | undefined;

  private debugParentSpanContext: SpanContext | undefined;

  private startedObservationEmitted = false;

  private pendingSlowAckObservation = false;

  private readonly slowAckText: string;

  constructor(private readonly options: FeishuTurnControllerOptions) {
    this.slowAckText = options.slowAckText?.trim() || DEFAULT_SLOW_ACK_TEXT;
    if (Number.isFinite(options.slowAckDelayMs) && options.slowAckDelayMs > 0) {
      this.slowAckTimer = setTimeout(() => {
        void this.sendSlowAck();
      }, options.slowAckDelayMs);
    }
  }

  async onAgentEvent(event: RuntimeAgentEvent): Promise<void> {
    if (this.settled) {
      return;
    }

    this.captureDebugParentSpanContext();
    if (PROGRESS_EVENT_TYPES.has(event.event.type)) {
      this.lastProgressAt = Date.now();
    }
    if (!this.ackSent) {
      this.state = 'running';
    }
  }

  async complete(text: string): Promise<void> {
    if (this.settled) {
      return;
    }

    this.clearSlowAckTimer();
    this.settled = true;
    this.state = 'completed';
    this.emitDebugObservation('feishu.turn.completed');
    await this.options.outbound.sendText(this.options.replyTo, text);
  }

  async fail(text: string): Promise<void> {
    if (this.settled) {
      return;
    }

    this.clearSlowAckTimer();
    this.settled = true;
    this.state = 'failed';
    this.emitDebugObservation('feishu.turn.failed');
    await this.options.outbound.sendText(this.options.replyTo, text);
  }

  dispose(): void {
    this.clearSlowAckTimer();
  }

  private clearSlowAckTimer(): void {
    if (!this.slowAckTimer) {
      return;
    }
    clearTimeout(this.slowAckTimer);
    this.slowAckTimer = undefined;
  }

  private async sendSlowAck(): Promise<void> {
    if (this.settled || this.ackSent) {
      return;
    }

    try {
      await this.options.outbound.sendText(this.options.replyTo, this.slowAckText);
      this.ackSent = true;
      this.state = 'ack_sent';
      this.emitDebugObservation('feishu.turn.slow_ack_sent');
    } catch {
      // Slow ack send failures should not abort the agent turn.
    }
  }

  private captureDebugParentSpanContext(): void {
    if (!this.options.debug || this.debugParentSpanContext) {
      return;
    }

    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!spanContext) {
      return;
    }

    this.debugParentSpanContext = spanContext;
    this.emitDebugObservation('feishu.turn.started');
    if (this.pendingSlowAckObservation) {
      this.pendingSlowAckObservation = false;
      this.emitDebugObservation('feishu.turn.slow_ack_sent');
    }
  }

  private emitDebugObservation(name: string): void {
    if (!this.options.debug || !isLangfuseTracingReady()) {
      return;
    }

    if (name === 'feishu.turn.started' && this.startedObservationEmitted) {
      return;
    }

    const parentSpanContext = this.debugParentSpanContext ?? trace.getActiveSpan()?.spanContext();
    if (!parentSpanContext) {
      if (name === 'feishu.turn.slow_ack_sent') {
        this.pendingSlowAckObservation = true;
      }
      return;
    }

    this.debugParentSpanContext = parentSpanContext;
    if (name === 'feishu.turn.started') {
      this.startedObservationEmitted = true;
    }

    const content = buildDebugObservationContent(name, {
      requestId: this.options.requestId,
      sessionKey: this.options.sessionKey,
      replyTo: this.options.replyTo,
      ackSent: this.ackSent,
      slowAckDelayMs: this.options.slowAckDelayMs,
      elapsedMs: Date.now() - this.startedAt,
      lastProgressAt: new Date(this.lastProgressAt).toISOString(),
      state: this.state,
    });

    runLangfuseOperationSafely(() => {
      startObservation(
        name,
        {
          level: 'DEBUG',
          ...content,
        },
        {
          asType: 'event',
          parentSpanContext,
        },
      );
    }, `debug.${name}`);
  }
}

export function createFeishuTurnController(
  options: FeishuTurnControllerOptions,
): FeishuTurnController {
  return new DefaultFeishuTurnController(options);
}
