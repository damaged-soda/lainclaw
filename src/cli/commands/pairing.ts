import { Command } from 'commander';
import { runCommand } from '../shared/result.js';
import {
  type PairingChannel,
  approveChannelPairingCode,
  listChannelPairingRequests,
  removeChannelAllowFromStoreEntry,
} from '../../channels/feishu/pairing/pairing-store.js';
import { resolvePairingIdLabel } from '../../channels/feishu/pairing/pairing-labels.js';
import { setExitCode } from '../shared/exitCode.js';
import { channelIds } from '../../gateway/commands/channelsRegistry.js';

const DEFAULT_ACCESS_CONTROL_CHANNEL = 'feishu';
const SUPPORTED_ACCESS_CONTROL_CHANNELS = new Set<string>(channelIds);

function resolveAccessControlChannel(raw: string | undefined): PairingChannel {
  const normalized = toPairingChannel(raw);
  if (!SUPPORTED_ACCESS_CONTROL_CHANNELS.has(normalized)) {
    throw new Error(`不支持该 ${normalized} 的访问控制存储。`);
  }
  return normalized as PairingChannel;
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
        console.log(`No pending ${parsed.channel} access-control requests.`);
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
        throw new Error(`No pending access-control request found for code: ${code}`);
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

    console.log(`Revoked ${entry} from ${parsed.channel} access-control allowlist.`);
    console.log(`Current allow entries: ${allowFrom.length}`);
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
  return (raw ?? '').trim().toLowerCase() || DEFAULT_ACCESS_CONTROL_CHANNEL;
}

export function buildPairingCommand(program: Command): Command {
  const pairing = program.command('pairing').description('Run access control command');
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
    .description('List pending access-control requests.')
    .option('--json', 'Output list result as JSON.')
    .option('--account <accountId>', 'Account scope for list.')
    .option('--channel <channel>', 'Access control channel id.')
    .action(async (options: { channel?: string; account?: string; json?: boolean }, command: Command) => {
      setExitCode(command, await runPairingCommand({
        kind: 'list',
        channel: resolveAccessControlChannel(options.channel),
        ...(options.account ? { accountId: options.account } : {}),
        ...(options.json ? { json: true } : {}),
      }));
    });

  pairing
    .command('approve')
    .description('Approve access-control request.')
    .argument('<code>', 'Access-control code.')
    .option('--account <accountId>', 'Account scope for approval.')
    .option('--channel <channel>', 'Access control channel id.')
    .action(async (code: string, options: { channel?: string; account?: string }, command: Command) => {
      setExitCode(command, await runPairingCommand({
        kind: 'approve',
        codeOrEntry: code,
        channel: resolveAccessControlChannel(options.channel),
        ...(options.account ? { accountId: options.account } : {}),
      }));
    });

  pairing
    .command('revoke')
    .description('Revoke access-control allowlist entry.')
    .argument('<entry>', 'Access-control entry id.')
    .option('--account <accountId>', 'Account scope for revoke.')
    .option('--channel <channel>', 'Access control channel id.')
    .action(async (entry: string, options: { channel?: string; account?: string }, command: Command) => {
      setExitCode(command, await runPairingCommand({
        kind: 'revoke',
        codeOrEntry: entry,
        channel: resolveAccessControlChannel(options.channel),
        ...(options.account ? { accountId: options.account } : {}),
      }));
    });

  return pairing;
}
