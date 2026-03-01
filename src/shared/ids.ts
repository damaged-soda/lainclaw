const RANDOM_ID_BASE = 16;
const RANDOM_ID_PAD_LENGTH = 4;

function randomHexSegment(): string {
  return Math.floor(Math.random() * 10000).toString(RANDOM_ID_BASE).padStart(RANDOM_ID_PAD_LENGTH, "0");
}

export function createToolCallId(rawToolName: string): string {
  return `lc-tool-${Date.now()}-${randomHexSegment()}-${randomHexSegment()}-${rawToolName}`;
}
