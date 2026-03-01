import { Command } from 'commander';
import { runCommand } from '../shared/result.js';
import {
  type PairingChannel,
  approveChannelPairingCode,
  listChannelPairingRequests,
  removeChannelAllowFromStoreEntry,
} from '../../pairing/pairing-store.js';
import { resolvePairingIdLabel } from '../../pairing/pairing-labels.js';
import { setExitCode } from '../shared/exitCode.js';

const FEISHU_PAIRING_CHANNEL = 'feishu';
const DEFAULT_PAIRING_CHANNEL: PairingChannel = 'feishu';

function resolvePairingChannel(raw: string): PairingChannel {
  const normalized = raw.trim().toLowerCase() || FEISHU_PAIRING_CHANNEL;
  if (normalized === FEISHU_PAIRING_CHANNEL) {
    return DEFAULT_PAIRING_CHANNEL;
  }
  throw new Error(`Unsupported channel: ${raw}. only "feishu" is supported in pairing command.`);
}

export interface PairingCommandInput {
  kind: 'list' | 'approve' | 'revoke';
  channel: PairingChannel;
  accountId?: string;
  json?: boolean;
  codeOrEntry?: string;
}

export async function runPairingCommand(parsed: PairingCommandInput): Promise<number> {
  return runCommand(async () => {
    if (parsed.kind === 'list') {
      const requests = parsed.accountId
        ? await listChannelPairingRequests(parsed.channel, process.env, parsed.accountId)
        : await listChannelPairingRequests(parsed.channel, process.env);

      if (parsed.json) {
        console.log(JSON.stringify({ channel: parsed.channel, requests }, null, 2));
        return 0;
      }

      if (requests.length === 0) {
        console.log(`No pending ${parsed.channel} pairing requests.`);
        return 0;
      }

      const idLabel = resolvePairingIdLabel();
      for (const request of requests) {
        console.log(
          `- ${idLabel}=${request.id}, code=${request.code}, requested=${request.createdAt}, meta=${request.meta ? JSON.stringify(request.meta) : '{}'}`,
        );
      }
      return 0;
    }

    if (parsed.kind === 'approve') {
      const code = parsed.codeOrEntry?.trim();
      if (!code) {
        throw new Error('Usage: lainclaw pairing approve [--channel <channel>] [--account <accountId>] <code>');
      }

      const approved = parsed.accountId
        ? await approveChannelPairingCode({ channel: parsed.channel, code, accountId: parsed.accountId })
        : await approveChannelPairingCode({ channel: parsed.channel, code });

      if (!approved) {
        throw new Error(`No pending pairing request found for code: ${code}`);
      }

      const idLabel = resolvePairingIdLabel();
      console.log(`Approved ${idLabel}=${approved.id} on ${parsed.channel}.`);
      return 0;
    }

    const entry = parsed.codeOrEntry?.trim();
    if (!entry) {
      throw new Error('Usage: lainclaw pairing revoke [--channel <channel>] [--account <accountId>] <entry>');
    }

    const { changed, allowFrom } = parsed.accountId
      ? await removeChannelAllowFromStoreEntry({ channel: parsed.channel, entry, accountId: parsed.accountId })
      : await removeChannelAllowFromStoreEntry({ channel: parsed.channel, entry });

    if (!changed) {
      console.log(`No matching allow entry found for ${entry} on ${parsed.channel}.`);
      return 0;
    }

    console.log(`Revoked ${entry} on ${parsed.channel}.`);
    console.log(`Current allow-from entries: ${allowFrom.length}`);
    return 0;
  }, {
    renderError: (error) => {
      if (error instanceof Error && error.message.startsWith('Usage:')) {
        console.error(error.message);
        return;
      }
      if (error instanceof Error) {
        console.error(error.message);
        return;
      }
      console.error(String(error));
    },
  });
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
      setExitCode(command, await runPairingCommand({
        kind: 'list',
        channel: resolvePairingChannel(toPairingChannel(options.channel)),
        ...(options.account ? { accountId: options.account } : {}),
        ...(options.json ? { json: true } : {}),
      }));
    });

  pairing
    .command('approve')
    .description('Approve pairing request.')
    .argument('<code>', 'Pairing code.')
    .option('--account <accountId>', 'Account scope for approval.')
    .option('--channel <channel>', 'Pairing channel, only feishu supported.')
    .action(async (code: string, options: { channel?: string; account?: string }, command: Command) => {
      setExitCode(command, await runPairingCommand({
        kind: 'approve',
        codeOrEntry: code,
        channel: resolvePairingChannel(toPairingChannel(options.channel)),
        ...(options.account ? { accountId: options.account } : {}),
      }));
    });

  pairing
    .command('revoke')
    .description('Revoke pairing allow entry.')
    .argument('<entry>', 'Pairing entry id.')
    .option('--account <accountId>', 'Account scope for revoke.')
    .option('--channel <channel>', 'Pairing channel, only feishu supported.')
    .action(async (entry: string, options: { channel?: string; account?: string }, command: Command) => {
      setExitCode(command, await runPairingCommand({
        kind: 'revoke',
        codeOrEntry: entry,
        channel: resolvePairingChannel(toPairingChannel(options.channel)),
        ...(options.account ? { accountId: options.account } : {}),
      }));
    });

  return pairing;
}
