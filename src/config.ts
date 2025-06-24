import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { TurnConfig } from './types';

// __dirname is the /dist directory, but we want to look in the project root directory instead
dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.JWT_SECRET_KEY) {
  throw Error('Invalid or no JWT_SECRET_KEY provided in environment variables.');
}

if (!process.env.ADMIN_STEAM_ID) {
  throw Error('Invalid or no ADMIN_STEAM_ID provided in environment variables.');
}

if (!process.env.RESTART_WARNING_SECRET) {
  throw Error('Invalid or no RESTART_WARNING_SECRET provided in environment variables.');
}

if (
  isNaN(Number(process.env.RATELIMIT_ADMIN_POINTS)) ||
  isNaN(Number(process.env.RATELIMIT_ADMIN_DURATION)) ||
  isNaN(Number(process.env.RATELIMIT_PUBLIC_POINTS)) ||
  isNaN(Number(process.env.RATELIMIT_PUBLIC_DURATION))
) {
  throw Error('Invalid or no RATELIMIT provided in environment variables.');
}

const RATELIMIT_ADMIN_POINTS = Number(process.env.RATELIMIT_ADMIN_POINTS);
const RATELIMIT_ADMIN_DURATION = Number(process.env.RATELIMIT_ADMIN_DURATION);
const RATELIMIT_PUBLIC_POINTS = Number(process.env.RATELIMIT_PUBLIC_POINTS);
const RATELIMIT_PUBLIC_DURATION = Number(process.env.RATELIMIT_PUBLIC_DURATION);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG = process.env.DEBUG || false;
const PORT = Number(process.env.PORT) || 3000;
const DOMAIN = process.env.DOMAIN_URL || 'localhost';

const API_KEY_PREFIX = process.env.API_KEY_PREFIX || 'test';
const ADMIN_STEAM_ID = process.env.ADMIN_STEAM_ID as string;

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY as string;

const RESTART_WARNING_SECRET = process.env.RESTART_WARNING_SECRET as string;

let ICE_SERVER_CONFIG: TurnConfig;

try {
  const peerConfigFile = fs.readFileSync('peer-config.yml', 'utf8');
  ICE_SERVER_CONFIG = yaml.parse(peerConfigFile);
} catch (error) {
  throw new Error(`Failed to load peer-config.yml: ${error}`);
}

export {
  ADMIN_STEAM_ID,
  DOMAIN,
  IS_PRODUCTION,
  JWT_SECRET_KEY,
  PORT,
  DEBUG,
  API_KEY_PREFIX,
  RATELIMIT_ADMIN_POINTS,
  RATELIMIT_ADMIN_DURATION,
  RATELIMIT_PUBLIC_POINTS,
  RATELIMIT_PUBLIC_DURATION,
  RESTART_WARNING_SECRET,
  ICE_SERVER_CONFIG,
};
