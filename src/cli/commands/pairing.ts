import { runCommand } from '../shared/result.js';
import {
  type PairingChannel,
  approveChannelPairingCode,
  listChannelPairingRequests,
  removeChannelAllowFromStoreEntry,
} from '../../pairing/pairing-store.js';
import { resolvePairingIdLabel } from '../../pairing/pairing-labels.js';

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

    if (parsed.kind === 'revoke') {
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
    }

    return 1;
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
