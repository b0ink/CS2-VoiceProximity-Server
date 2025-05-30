import crypto from 'crypto';
import { JSONFilePreset } from 'lowdb/node';
import { apiKeyPrefix } from './config';

export type ApiKeyData = {
  id: crypto.UUID;
  key: string;
  iat: number;
  exp: number;
  label: string;
  usage: number;
};

export class ApiKey {
  id!: crypto.UUID;
  key!: string;
  iat!: number;
  exp!: number;
  label!: string;
  usage!: number;

  constructor(data: ApiKeyData) {
    Object.assign(this, data);
  }

  isActive(): boolean {
    return Date.now() < this.exp;
  }

  get censoredKey() {
    return `**************${this.key.slice(-3)}`;
  }
}

const defaultData: ApiKey[] = [];

export async function loadDb() {
  const db = await JSONFilePreset<ApiKeyData[]>('db/db.json', defaultData);
  await db.read();
  return db;
}

export async function getApiKeys(): Promise<ApiKeyData[]> {
  const db = await loadDb();

  const apiKeys = db.data.map((k) => new ApiKey(k));

  const keys = apiKeys.map((k) => ({
    ...k,
    key: k.censoredKey,
    isActive: k.isActive(),
  }));
  return keys;
}

export async function getApiKey(key: string): Promise<ApiKey | null> {
  const db = await loadDb();
  const apiKey = db.data.find((k) => k.key === key);
  if (apiKey) {
    return new ApiKey(apiKey);
  }
  return null;
}

export function generateApiKey(label: string, expiresIn: number): ApiKey {
  const apiKey = new ApiKey({
    id: crypto.randomUUID(),
    key: `${apiKeyPrefix}_${crypto
      .randomBytes(32)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 32)}`,

    iat: Date.now(),
    exp: Date.now() + expiresIn * 1000,
    label,
    usage: 0,
  });
  return apiKey;
}
