export interface CommandResult {
  success: boolean;
  [key: string]: unknown;
}

export type ErrorRenderer = (error: unknown) => void;

export interface CommandExecutionOptions {
  renderError?: ErrorRenderer;
}

export function printJsonResult(payload: CommandResult): number {
  console.log(JSON.stringify(payload, null, 2));
  return payload.success ? 0 : 1;
}

export async function runCommand(
  execute: () => Promise<number> | number,
  options: CommandExecutionOptions = {},
): Promise<number> {
  try {
    return await Promise.resolve(execute());
  } catch (error) {
    const renderError = options.renderError ?? (() => {
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
    });
    renderError(error);
    return 1;
  }
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
