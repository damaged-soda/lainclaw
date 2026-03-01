import { Command, Option } from 'commander';
import {
  runPairingCommand,
  type PairingCommandInput,
} from '../pairing.js';

function setExitCode(command: Command, code: number): void {
  (command as { exitCode?: number }).exitCode = code;
}

function toPairingChannel(raw: string | undefined): string {
  return (raw ?? '').trim() || 'feishu';
}

export function buildPairingCommand(program: Command): Command {
  const pairing = program.command('pairing').description('Run pairing command');
  pairing.addHelpText(
    'after',
    [
      'Examples:',
      '  lainclaw pairing list [--channel feishu] [--json]',
      '  lainclaw pairing approve [--channel feishu] <code> [--account <accountId>]',
      '  lainclaw pairing revoke [--channel feishu] <entry> [--account <accountId>]',
    ].join('\n'),
  );

  pairing
    .command('list')
    .description('List pending pairing requests.')
    .option('--json', 'Output list result as JSON.')
    .option('--account <accountId>', 'Account scope for list.')
    .option('--channel <channel>', 'Pairing channel, only feishu supported.')
    .action(async (options: { channel?: string; account?: string; json?: boolean }, command: Command) => {
      const parsed: PairingCommandInput = {
        kind: 'list',
        channel: toPairingChannel(options.channel) as PairingCommandInput['channel'],
        ...(options.account ? { accountId: options.account } : {}),
        ...(options.json ? { json: true } : {}),
      };
      setExitCode(command, await runPairingCommand(parsed));
    });

  pairing
    .command('approve')
    .description('Approve pairing request.')
    .argument('<code>', 'Pairing code.')
    .option('--account <accountId>', 'Account scope for approval.')
    .option('--channel <channel>', 'Pairing channel, only feishu supported.')
    .action(async (code: string, options: { channel?: string; account?: string }, command: Command) => {
      const parsed: PairingCommandInput = {
        kind: 'approve',
        codeOrEntry: code,
        channel: toPairingChannel(options.channel) as PairingCommandInput['channel'],
        ...(options.account ? { accountId: options.account } : {}),
      };
      setExitCode(command, await runPairingCommand(parsed));
    });

  pairing
    .command('revoke')
    .description('Revoke pairing allow entry.')
    .argument('<entry>', 'Pairing entry id.')
    .option('--account <accountId>', 'Account scope for revoke.')
    .option('--channel <channel>', 'Pairing channel, only feishu supported.')
    .action(async (entry: string, options: { channel?: string; account?: string }, command: Command) => {
      const parsed: PairingCommandInput = {
        kind: 'revoke',
        codeOrEntry: entry,
        channel: toPairingChannel(options.channel) as PairingCommandInput['channel'],
        ...(options.account ? { accountId: options.account } : {}),
      };
      setExitCode(command, await runPairingCommand(parsed));
    });

  return pairing;
}
