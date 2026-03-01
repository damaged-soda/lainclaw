export type CommandOptionType = 'boolean' | 'string' | 'integer' | 'string-list';

export interface CommandOptionSpec {
  name: string;
  usage: string;
  type: CommandOptionType;
  description: string;
}

export interface SubcommandUsageSpec {
  name: string;
  usage: string;
  description: string;
  optionRefs: string[];
  examples: string[];
}

export interface CommandUsageSpec {
  command: string;
  description: string;
  usageLines?: string[];
  subcommands?: SubcommandUsageSpec[];
  optionDefs: CommandOptionSpec[];
  examples: string[];
  notes: string[];
}

const AGENT_OPTIONS: CommandOptionSpec[] = [
  { name: 'provider', usage: '--provider <provider>', type: 'string', description: 'Select model provider by name.' },
  { name: 'profile', usage: '--profile <profile>', type: 'string', description: 'Select provider profile.' },
  { name: 'session', usage: '--session <name>', type: 'string', description: 'Use specified session id.' },
  { name: 'new-session', usage: '--new-session', type: 'boolean', description: 'Start a fresh session.' },
  {
    name: 'memory',
    usage: '--memory|--no-memory|--memory=on|off',
    type: 'boolean',
    description: 'Enable/disable persistent memory persistence for this call.',
  },
  { name: 'with-tools', usage: '--with-tools|--no-with-tools', type: 'boolean', description: 'Enable/disable tool calls.' },
  {
    name: 'tool-allow',
    usage: '--tool-allow <tool1,tool2>',
    type: 'string-list',
    description: 'Limit allowed tool names.',
  },
];

const HEARTBEAT_OPTIONS: CommandOptionSpec[] = [
  { name: 'provider', usage: '--provider <provider>', type: 'string', description: 'Select model provider by name.' },
  { name: 'profile', usage: '--profile <profile>', type: 'string', description: 'Select provider profile.' },
  { name: 'with-tools', usage: '--with-tools|--no-with-tools', type: 'boolean', description: 'Enable/disable tool calls.' },
  {
    name: 'tool-allow',
    usage: '--tool-allow <tool1,tool2>',
    type: 'string-list',
    description: 'Limit allowed tool names.',
  },
  {
    name: 'memory',
    usage: '--memory|--no-memory',
    type: 'boolean',
    description: 'Enable/disable memory usage in heartbeat run.',
  },
];

const HEARTBEAT_INIT_OPTIONS: CommandOptionSpec[] = [
  { name: 'template', usage: '--template <path>', type: 'string', description: 'Use template file path.' },
  { name: 'force', usage: '--force', type: 'boolean', description: 'Overwrite existing HEARTBEAT.md.' },
];

const TOOL_OPTIONS: CommandOptionSpec[] = [
  { name: 'args', usage: '--args <json>', type: 'string', description: 'Tool arguments in json string.' },
];

const AUTH_OPTIONS: CommandOptionSpec[] = [
  { name: 'provider', usage: '<provider>', type: 'string', description: 'Auth provider name.' },
  { name: 'profile', usage: '<profile>', type: 'string', description: 'Profile id.' },
];

const PAIRING_OPTIONS: CommandOptionSpec[] = [
  { name: 'channel', usage: '--channel <channel>', type: 'string', description: 'Pairing channel, only feishu supported.' },
  { name: 'account', usage: '--account <accountId>', type: 'string', description: 'Account scope for pairing list/approve/revoke.' },
  { name: 'json', usage: '--json', type: 'boolean', description: 'Output list result as JSON.' },
];

const GATEWAY_CHANNEL_OPTIONS: CommandOptionSpec[] = [
  { name: 'channel', usage: '--channel <feishu|local>', type: 'string', description: 'Select gateway runtime channel.' },
  {
    name: 'pid-file',
    usage: '--pid-file <path>',
    type: 'string',
    description: 'Gateway service state file path.',
  },
  {
    name: 'log-file',
    usage: '--log-file <path>',
    type: 'string',
    description: 'Gateway service log file path.',
  },
];

const GATEWAY_RUNTIME_OPTIONS: CommandOptionSpec[] = [
  { name: 'provider', usage: '--provider <provider>', type: 'string', description: 'Model provider override.' },
  { name: 'profile', usage: '--profile <profile>', type: 'string', description: 'Model profile override.' },
  { name: 'with-tools', usage: '--with-tools|--no-with-tools', type: 'boolean', description: 'Enable/disable tool calls.' },
  {
    name: 'tool-allow',
    usage: '--tool-allow <tool1,tool2>',
    type: 'string-list',
    description: 'Limit allowed tool names.',
  },
  {
    name: 'memory',
    usage: '--memory|--no-memory',
    type: 'boolean',
    description: 'Enable/disable memory persistence.',
  },
  {
    name: 'heartbeat-enabled',
    usage: '--heartbeat-enabled|--no-heartbeat-enabled',
    type: 'boolean',
    description: 'Enable heartbeat behavior.',
  },
  {
    name: 'heartbeat-interval-ms',
    usage: '--heartbeat-interval-ms <ms>',
    type: 'integer',
    description: 'Heartbeat interval in ms.',
  },
  { name: 'heartbeat-target-open-id', usage: '--heartbeat-target-open-id <openId>', type: 'string', description: 'Heartbeat target open-id.' },
  { name: 'heartbeat-session-key', usage: '--heartbeat-session-key <key>', type: 'string', description: 'Heartbeat session key.' },
  { name: 'pairing-policy', usage: '--pairing-policy <open|allowlist|pairing|disabled>', type: 'string', description: 'Pairing policy.' },
  { name: 'pairing-allow-from', usage: '--pairing-allow-from <id1,id2>', type: 'string-list', description: 'Allowlist for pairing.' },
  { name: 'pairing-pending-ttl-ms', usage: '--pairing-pending-ttl-ms <ms>', type: 'integer', description: 'Pairing pending TTL in ms.' },
  { name: 'pairing-pending-max', usage: '--pairing-pending-max <n>', type: 'integer', description: 'Pairing pending max count.' },
  { name: 'app-id', usage: '--app-id <id>', type: 'string', description: 'Feishu app id.' },
  { name: 'app-secret', usage: '--app-secret <secret>', type: 'string', description: 'Feishu app secret.' },
  { name: 'request-timeout-ms', usage: '--request-timeout-ms <ms>', type: 'integer', description: 'Request timeout ms.' },
  { name: 'debug', usage: '--debug', type: 'boolean', description: 'Enable local debug output.' },
  { name: 'daemon', usage: '--daemon', type: 'boolean', description: 'Run gateway service in daemon mode.' },
  { name: 'service-child', usage: '--service-child', type: 'boolean', description: 'Run as service child process.' },
];

const GATEWAY_CONFIG_OPTIONS: CommandOptionSpec[] = [
  { name: 'provider', usage: '--provider <provider>', type: 'string', description: 'Persist provider override.' },
  { name: 'profile', usage: '--profile <profile>', type: 'string', description: 'Persist profile override.' },
  { name: 'app-id', usage: '--app-id <id>', type: 'string', description: 'Persist feishu app id.' },
  { name: 'app-secret', usage: '--app-secret <secret>', type: 'string', description: 'Persist feishu app secret.' },
  { name: 'with-tools', usage: '--with-tools|--no-with-tools', type: 'boolean', description: 'Persist with-tools default.' },
  {
    name: 'tool-allow',
    usage: '--tool-allow <tool1,tool2>',
    type: 'string-list',
    description: 'Persist tool allow list.',
  },
  { name: 'memory', usage: '--memory|--no-memory', type: 'boolean', description: 'Persist memory behavior.' },
  {
    name: 'heartbeat-enabled',
    usage: '--heartbeat-enabled|--no-heartbeat-enabled',
    type: 'boolean',
    description: 'Persist heartbeat status.',
  },
  {
    name: 'heartbeat-interval-ms',
    usage: '--heartbeat-interval-ms <ms>',
    type: 'integer',
    description: 'Persist heartbeat interval ms.',
  },
  { name: 'heartbeat-target-open-id', usage: '--heartbeat-target-open-id <openId>', type: 'string', description: 'Persist heartbeat target.' },
  { name: 'heartbeat-session-key', usage: '--heartbeat-session-key <key>', type: 'string', description: 'Persist heartbeat session key.' },
  { name: 'pairing-policy', usage: '--pairing-policy <open|allowlist|pairing|disabled>', type: 'string', description: 'Persist pairing policy.' },
  { name: 'pairing-allow-from', usage: '--pairing-allow-from <id1,id2>', type: 'string-list', description: 'Persist pairing allowlist.' },
  { name: 'pairing-pending-ttl-ms', usage: '--pairing-pending-ttl-ms <ms>', type: 'integer', description: 'Persist pairing pending ttl.' },
  { name: 'pairing-pending-max', usage: '--pairing-pending-max <n>', type: 'integer', description: 'Persist pairing pending max.' },
  { name: 'request-timeout-ms', usage: '--request-timeout-ms <ms>', type: 'integer', description: 'Persist request timeout ms.' },
  { name: 'dry-run', usage: '--dry-run', type: 'boolean', description: 'Show migration plan without changing config.' },
];

export const COMMAND_DEFINITIONS: CommandUsageSpec[] = [
  {
    command: 'agent',
    description: 'Run agent command',
    usageLines: [
      '<input>',
      '[--provider <provider>] [--profile <profile>] [--session <name>] [--new-session] [--memory|--no-memory|--memory=on|off] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] <input>',
      '[--provider <provider>] [--profile <profile>] [--session <name>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] <input>',
      '--session <name> --provider <provider> --profile <profile> <input>',
    ],
    optionDefs: AGENT_OPTIONS,
    examples: [
      'lainclaw agent 这是一段测试文本',
      'lainclaw agent --session work --provider <provider> --profile default 这是一段测试输入',
      'lainclaw agent --session work --memory 这是一个长期记忆测试',
      'lainclaw agent --session work --memory=off 这是一条不写入记忆的消息',
    ],
    notes: [],
  },
  {
    command: 'gateway',
    description: 'Run gateway command',
    subcommands: [
      {
        name: 'start',
        usage:
          'start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]',
        description: 'Start gateway service.',
        optionRefs: ['channel', 'provider', 'profile', 'with-tools', 'tool-allow', 'memory', 'heartbeat-enabled', 'heartbeat-interval-ms', 'heartbeat-target-open-id', 'heartbeat-session-key', 'pairing-policy', 'pairing-allow-from', 'pairing-pending-ttl-ms', 'pairing-pending-max', 'app-id', 'app-secret', 'request-timeout-ms', 'debug', 'daemon', 'pid-file', 'log-file'],
        examples: [],
      },
      {
        name: 'status',
        usage: 'status [--channel <channel>] [--pid-file <path>] [--log-file <path>]',
        description: 'Show gateway status.',
        optionRefs: ['channel', 'pid-file', 'log-file'],
        examples: [],
      },
      {
        name: 'stop',
        usage: 'stop [--channel <channel>] [--pid-file <path>] [--log-file <path>]',
        description: 'Stop gateway service.',
        optionRefs: ['channel', 'pid-file', 'log-file'],
        examples: [],
      },
      {
        name: 'config set',
        usage: 'config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]',
        description: 'Set gateway config.',
        optionRefs: ['channel', 'provider', 'profile', 'app-id', 'app-secret', 'with-tools', 'tool-allow', 'memory', 'heartbeat-enabled', 'heartbeat-interval-ms', 'heartbeat-target-open-id', 'heartbeat-session-key', 'pairing-policy', 'pairing-allow-from', 'pairing-pending-ttl-ms', 'pairing-pending-max', 'request-timeout-ms'],
        examples: [],
      },
      {
        name: 'config show',
        usage: 'config show [--channel <channel>]',
        description: 'Show gateway config.',
        optionRefs: ['channel'],
        examples: [],
      },
      {
        name: 'config clear',
        usage: 'config clear [--channel <channel>]',
        description: 'Clear gateway config.',
        optionRefs: ['channel'],
        examples: [],
      },
      {
        name: 'config migrate',
        usage: 'config migrate [--channel <channel>] --dry-run',
        description: 'Show migration plan for legacy config.',
        optionRefs: ['channel', 'dry-run'],
        examples: [],
      },
    ],
    optionDefs: [...GATEWAY_CHANNEL_OPTIONS, ...GATEWAY_RUNTIME_OPTIONS, ...GATEWAY_CONFIG_OPTIONS],
    examples: [
      'lainclaw gateway start --channel local --provider <provider> --profile <profile> --with-tools --memory',
      'lainclaw gateway start --app-id <AppID> --app-secret <AppSecret>',
    ],
    notes: [],
  },
  {
    command: 'pairing',
    description: 'Run pairing command',
    usageLines: [
      'list [--channel <channel>] [--account <accountId>] [--json]',
      'approve [--channel <channel>] [--account <accountId>] <code>',
      'revoke [--channel <channel>] [--account <accountId>] <entry>',
    ],
    optionDefs: PAIRING_OPTIONS,
    examples: [
      'lainclaw pairing list [--channel <channel>] [--json]',
      'lainclaw pairing approve [--channel <channel>] <code> [--account <accountId>]',
      'lainclaw pairing revoke [--channel <channel>] <openIdOrUserId> [--account <accountId>]',
    ],
    notes: [],
  },
  {
    command: 'heartbeat',
    description: 'Run heartbeat command',
    subcommands: [
      {
        name: 'init',
        usage: 'init [--template <path>] [--force]',
        description: 'Initialize HEARTBEAT.md.',
        optionRefs: ['template', 'force'],
        examples: [],
      },
      {
        name: 'add',
        usage: 'add "提醒我：每天中午检查邮件" [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>]',
        description: 'Add heartbeat rule.',
        optionRefs: ['provider', 'profile', 'with-tools', 'tool-allow'],
        examples: ['lainclaw heartbeat add "提醒我：每天中午检查邮件"'],
      },
      {
        name: 'list',
        usage: 'list',
        description: 'List heartbeat rules.',
        optionRefs: [],
        examples: ['lainclaw heartbeat list'],
      },
      {
        name: 'remove',
        usage: 'remove <ruleId>',
        description: 'Remove heartbeat rule.',
        optionRefs: [],
        examples: ['lainclaw heartbeat remove <ruleId>'],
      },
      {
        name: 'enable',
        usage: 'enable <ruleId>',
        description: 'Enable heartbeat rule.',
        optionRefs: [],
        examples: ['lainclaw heartbeat enable <ruleId>'],
      },
      {
        name: 'disable',
        usage: 'disable <ruleId>',
        description: 'Disable heartbeat rule.',
        optionRefs: [],
        examples: ['lainclaw heartbeat disable <ruleId>'],
      },
      {
        name: 'run',
        usage: 'run [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory]',
        description: 'Run heartbeat once.',
        optionRefs: ['provider', 'profile', 'with-tools', 'tool-allow', 'memory'],
        examples: [],
      },
    ],
    optionDefs: [...HEARTBEAT_OPTIONS, ...HEARTBEAT_INIT_OPTIONS],
    examples: [
      'lainclaw heartbeat init [--template <path>] [--force]',
      'lainclaw heartbeat add "提醒我：每天中午检查邮件"',
      'lainclaw heartbeat list',
      'lainclaw heartbeat enable <ruleId>',
      'lainclaw heartbeat disable <ruleId>',
      'lainclaw heartbeat run',
      'lainclaw heartbeat remove <ruleId>',
    ],
    notes: [],
  },
  {
    command: 'tools',
    description: 'Run tools command',
    subcommands: [
      {
        name: 'list',
        usage: 'list',
        description: 'List tools.',
        optionRefs: [],
        examples: [],
      },
      {
        name: 'info',
        usage: 'info <name>',
        description: 'Show tool info.',
        optionRefs: [],
        examples: ['lainclaw tools info <name>'],
      },
      {
        name: 'invoke',
        usage: 'invoke <name> --args <json>',
        description: 'Invoke tool.',
        optionRefs: ['args'],
        examples: ['lainclaw tools invoke fs.read_file --args "{\\"path\\":\\"README.md\\"}"'],
      },
    ],
    optionDefs: TOOL_OPTIONS,
    examples: ['lainclaw tools list', 'lainclaw tools info <name>', 'lainclaw tools invoke <name> --args <json>'],
    notes: [],
  },
  {
    command: 'auth',
    description: 'Run auth command',
    usageLines: [
      'login openai-codex',
      'status',
      'use <profile>',
      'logout [--all|<profile>]',
    ],
    optionDefs: AUTH_OPTIONS,
    examples: ['lainclaw auth login openai-codex', 'lainclaw auth status'],
    notes: [],
  },
];

export const GLOBAL_EXAMPLES: string[] = [
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'agent')?.examples ?? [],
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'gateway')?.examples ?? [],
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'pairing')?.examples ?? [],
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'tools')?.examples ?? [],
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'heartbeat')?.examples ?? [],
  ...COMMAND_DEFINITIONS.find((entry) => entry.command === 'auth')?.examples ?? [],
];

export const GLOBAL_NOTES = [
  'Notes: `provider` 决定运行适配器；未配置或配置错误会直接报错。provider 与 profile 用于查找对应运行配置。',
];

export function getCommandSpec(command: string): CommandUsageSpec | undefined {
  return COMMAND_DEFINITIONS.find((entry) => entry.command === command);
}
