import { runPairingCommand as runPairingCommandFromDomain } from '../../pairing/cli.js';

export async function runPairingCommand(args: string[]): Promise<number> {
  return runPairingCommandFromDomain(args);
}
