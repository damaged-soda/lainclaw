import type { Usage } from "@mariozechner/pi-ai";

export interface AggregatedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export function createEmptyUsage(): AggregatedUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

export function addUsage(target: AggregatedUsage, usage: Usage | undefined): void {
  if (!usage) {
    return;
  }

  target.input += usage.input || 0;
  target.output += usage.output || 0;
  target.cacheRead += usage.cacheRead || 0;
  target.cacheWrite += usage.cacheWrite || 0;
  target.totalTokens += usage.totalTokens || 0;
  target.cost.input += usage.cost?.input || 0;
  target.cost.output += usage.cost?.output || 0;
  target.cost.cacheRead += usage.cost?.cacheRead || 0;
  target.cost.cacheWrite += usage.cost?.cacheWrite || 0;
  target.cost.total += usage.cost?.total || 0;
}

export function hasUsage(usage: AggregatedUsage): boolean {
  return (
    usage.input > 0
    || usage.output > 0
    || usage.cacheRead > 0
    || usage.cacheWrite > 0
    || usage.totalTokens > 0
    || usage.cost.total > 0
  );
}

export function toLangfuseUsageDetails(usage: AggregatedUsage): Record<string, number> {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

export function toLangfuseCostDetails(usage: AggregatedUsage): Record<string, number> {
  return {
    input: usage.cost.input,
    output: usage.cost.output,
    cacheRead: usage.cost.cacheRead,
    cacheWrite: usage.cost.cacheWrite,
    total: usage.cost.total,
  };
}
