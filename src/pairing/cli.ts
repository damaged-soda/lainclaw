import { resolvePairingIdLabel } from './pairing-labels.js';
import {
  type PairingChannel,
  approveChannelPairingCode,
  listChannelPairingRequests,
  removeChannelAllowFromStoreEntry,
} from './pairing-store.js';

const FEISHU_PAIRING_CHANNEL = 'feishu';
const DEFAULT_PAIRING_CHANNEL: PairingChannel = 'feishu';

interface PairingArgs {
  channel: PairingChannel;
  accountId: string;
  json: boolean;
  positional: string[];
}

function resolvePairingChannel(raw: string): PairingChannel {
  const normalized = raw.trim().toLowerCase() || FEISHU_PAIRING_CHANNEL;
  if (normalized === FEISHU_PAIRING_CHANNEL) {
    return DEFAULT_PAIRING_CHANNEL;
  }
  throw new Error(`Unsupported channel: ${raw}. only "feishu" is supported in pairing command.`);
}

function parsePairingArgs(argv: string[]): PairingArgs {
  let channel = FEISHU_PAIRING_CHANNEL;
  let accountId = '';
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--channel') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --channel');
      }
      channel = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--channel=')) {
      channel = arg.slice('--channel='.length);
      continue;
    }

    if (arg === '--account') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --account');
      }
      accountId = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--account=')) {
      accountId = arg.slice('--account='.length);
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  return {
    channel: resolvePairingChannel(channel),
    accountId: accountId.trim(),
    json,
    positional,
  };
}

function printUsage(): string {
  return [
    'Usage:',
    '  lainclaw pairing list [--channel <channel>] [--account <accountId>] [--json]',
    '  lainclaw pairing approve [--channel <channel>] [--account <accountId>] <code>',
    '  lainclaw pairing revoke [--channel <channel>] [--account <accountId>] <entry>',
  ].join('\n');
}

export async function runPairingCommand(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
    console.log(printUsage());
    return 0;
  }

  if (subcommand === 'list') {
    const parsed = parsePairingArgs(rest);
    const explicitChannel = parsed.positional[0] && !parsed.positional[0].startsWith('--') ? parsed.positional[0].trim() : '';
    const channel = resolvePairingChannel(explicitChannel || parsed.channel);
    const accountId = parsed.accountId;

    const requests = accountId
      ? await listChannelPairingRequests(channel, process.env, accountId)
      : await listChannelPairingRequests(channel, process.env);

    if (parsed.json) {
      console.log(JSON.stringify({ channel, requests }, null, 2));
      return 0;
    }

    if (requests.length === 0) {
      console.log(`No pending ${channel} pairing requests.`);
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

  if (subcommand === 'approve') {
    const parsed = parsePairingArgs(rest);
    const explicitChannel = parsed.positional[0] && !parsed.positional[0].startsWith('--') ? parsed.positional[0].trim() : '';
    const code = (explicitChannel ? parsed.positional[1] : parsed.positional[0])?.trim();
    const channel = resolvePairingChannel(explicitChannel || parsed.channel);

    if (!code) {
      throw new Error('Usage: lainclaw pairing approve [--channel <channel>] [--account <accountId>] <code>');
    }

    const approved = parsed.accountId
      ? await approveChannelPairingCode({ channel, code, accountId: parsed.accountId })
      : await approveChannelPairingCode({ channel, code });

    if (!approved) {
      throw new Error(`No pending pairing request found for code: ${code}`);
    }

    const idLabel = resolvePairingIdLabel();
    console.log(`Approved ${idLabel}=${approved.id} on ${channel}.`);
    return 0;
  }

  if (subcommand === 'revoke') {
    const parsed = parsePairingArgs(rest);
    const explicitChannel = parsed.positional[0] && !parsed.positional[0].startsWith('--') ? parsed.positional[0].trim() : '';
    const entry = (explicitChannel ? parsed.positional[1] : parsed.positional[0])?.trim();
    const channel = resolvePairingChannel(explicitChannel || parsed.channel);

    if (!entry) {
      throw new Error('Usage: lainclaw pairing revoke [--channel <channel>] [--account <accountId>] <entry>');
    }

    const { changed, allowFrom } = parsed.accountId
      ? await removeChannelAllowFromStoreEntry({ channel, entry, accountId: parsed.accountId })
      : await removeChannelAllowFromStoreEntry({ channel, entry });

    if (!changed) {
      console.log(`No matching allow entry found for ${entry} on ${channel}.`);
      return 0;
    }

    console.log(`Revoked ${entry} on ${channel}.`);
    console.log(`Current allow-from entries: ${allowFrom.length}`);
    return 0;
  }

  throw new Error(`Unknown pairing subcommand: ${subcommand}`);
}
