import { ValidationError } from '../shared/types.js';
import { runAsk } from '../gateway/askGateway.js';

const VERSION = '0.1.0';

export function printUsage(): string {
  return [
    'Usage:',
    '  lainclaw --help',
    '  lainclaw --version',
    '  lainclaw ask <input>',
    '',
    'Examples:',
    '  lainclaw ask 这是一段测试文本',
    '',
    'Notes: model is currently stubbed for MVP and runs fully offline.'
  ].join('\n');
}

function printResult(payload: {
  success: boolean;
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
}) {
  if (payload.success) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  return 1;
}

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    console.log(printUsage());
    return 0;
  }

  if (command === '-v' || command === '--version') {
    console.log(`lainclaw v${VERSION}`);
    return 0;
  }

  if (command === 'ask') {
    const input = argv.slice(1).join(' ');
    try {
      const response = runAsk(input);
      return printResult(response);
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`[${error.code}] ${error.message}`);
        console.error('Usage: lainclaw ask <input>');
        return 1;
      }
      console.error('Unexpected error:', String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  console.error(`Unknown command: ${command}`);
  console.error('Try: lainclaw --help');
  return 1;
}

