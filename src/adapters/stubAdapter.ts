import { RequestContext } from '../shared/types.js';

export interface AdapterResult {
  route: string;
  stage: string;
  result: string;
  provider?: string;
  profileId?: string;
}

export function runStubAdapter(context: RequestContext, route: string): AdapterResult {
  const normalizedInput = context.input.trim();
  const historyCount = Array.isArray(context.messages) ? context.messages.length : 0;
  const shortHistory = `context=${historyCount}条消息`;

  if (route === 'summary') {
    return {
      route,
      stage: 'adapter.stub.summary',
      result: `[stub-summary] ${shortHistory}：我已接收到你的内容：${normalizedInput}`
    };
  }

  return {
    route,
    stage: 'adapter.stub.echo',
    result: `[stub-echo][${context.sessionId}] ${shortHistory}，已接收到输入：${normalizedInput}`
  };
}
