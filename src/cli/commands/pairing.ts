import { Command } from 'commander';
import { runCommand } from '../shared/result.js';
import { approveFeishuPairingCode } from '../../channels/feishu/pairing.js';
import { setExitCode } from '../shared/exitCode.js';

export async function runPairingApproveCommand(
  code: string,
): Promise<number> {
  return runCommand(async () => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new Error('Usage: lainclaw pairing approve <code>');
    }

    const approvedOpenId = await approveFeishuPairingCode(normalizedCode);
    if (!approvedOpenId) {
      throw new Error(`No pending pairing request found for code: ${normalizedCode}`);
    }

    console.log(`Approved openId=${approvedOpenId}.`);
    return 0;
  }, {
    renderError: (error) => {
      if (error instanceof Error) {
        console.error(error.message);
        return;
      }
      console.error(String(error));
    },
  });
}

export function buildPairingCommand(program: Command): Command {
  const pairing = program.command('pairing').description('Approve pairing requests.');
  pairing.addHelpText(
    'after',
    [
      'Examples:',
      '  lainclaw pairing approve ABCDEFGH',
    ].join('\n'),
  );

  pairing
    .command('approve')
    .description('Approve pairing request.')
    .argument('<code>', 'Pairing code.')
    .action(async (code: string, _options: Record<string, never>, command: Command) => {
      setExitCode(command, await runPairingApproveCommand(code));
    });

  return pairing;
}
