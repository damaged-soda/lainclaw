export interface CommandResult {
  success: boolean;
  [key: string]: unknown;
}

export function printJsonResult(payload: CommandResult): number {
  console.log(JSON.stringify(payload, null, 2));
  return payload.success ? 0 : 1;
}

export function isValidationFailure(error: unknown, expectedMessage?: string): boolean {
  if (!error || typeof error !== "object" || !(error instanceof Error)) {
    return false;
  }
  if (!expectedMessage) {
    return true;
  }
  return error.message.includes(expectedMessage);
}
