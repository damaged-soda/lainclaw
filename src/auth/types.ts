export interface OpenAICodexCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}

export interface AuthProfile {
  id: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  credential: OpenAICodexCredentials;
}

export interface AuthStore {
  version: 1;
  activeProfileId?: string;
  profiles: Record<string, AuthProfile>;
}
