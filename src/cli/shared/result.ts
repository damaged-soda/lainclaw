import { ValidationError } from '../../shared/types.js';

export interface CommandResult {
  success: boolean;
  [key: string]: unknown;
}

export type ErrorRenderer = (error: unknown) => void;

export interface CommandExecutionOptions {
  renderError?: ErrorRenderer;
  usage?: string | (() => string);
  printUsageOnValidationError?: boolean;
  printUsageOnError?: boolean;
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
    const message = String(error instanceof Error ? error.message : error);
    const validationError = error instanceof ValidationError ? error : undefined;
    const hasValidationError = Boolean(validationError);
    const shouldPrintUsage = (() => {
      if (!options.usage) {
        return false;
      }
      if (options.printUsageOnError) {
        return true;
      }
      if (options.printUsageOnValidationError) {
        return hasValidationError;
      }
      return false;
    })();

    const defaultRenderError: ErrorRenderer = () => {
      if (hasValidationError) {
        console.error(`[${validationError?.code ?? 'VALIDATION_ERROR'}] ${message}`);
      } else {
        console.error("ERROR:", message);
      }
    };
    const renderError = options.renderError ?? defaultRenderError;
    renderError(error);
    if (shouldPrintUsage) {
      console.error(typeof options.usage === 'function' ? options.usage() : options.usage);
    }
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
