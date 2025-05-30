import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

if (process.env.COTURN_STATIC_AUTH_SECRET === null) {
  throw Error('Invalid or no COTURN_STATIC_AUTH_SECRET provided in environment variables.');
}

if (process.env.JWT_SECRET_KEY === null) {
  throw Error('Invalid or no JWT_SECRET_KEY provided in environment variables.');
}

if (process.env.DEFAULT_SOCKET_API_KEY === null) {
  throw Error('Invalid or no DEFAULT_SOCKET_API_KEY provided in environment variables.');
}

if (process.env.ADMIN_STEAM_ID === null) {
  throw Error('Invalid or no ADMIN_STEAM_ID provided in environment variables.');
}

const isProduction = process.env.NODE_ENV === 'production';
const DEBUG = process.env.DEBUG || false;
const port = Number(process.env.PORT) || 3000;
const domain = process.env.DOMAIN_URL || 'localhost';

const apiKeyPrefix = process.env.API_KEY_PREFIX || 'test';
const adminSteamId = process.env.ADMIN_STEAM_ID as string;

const coturnStaticAuthSecret = process.env.COTURN_STATIC_AUTH_SECRET as string;
const coturnCredentialsExpiry = process.env.COTURN_CREDENTIALS_EXPIRY
  ? parseInt(process.env.COTURN_CREDENTIALS_EXPIRY)
  : 24 * 3600; // 24 hours

const jwtSecretKey = process.env.JWT_SECRET_KEY as string;

export {
  adminSteamId,
  coturnCredentialsExpiry,
  coturnStaticAuthSecret,
  domain,
  isProduction,
  jwtSecretKey,
  port,
  DEBUG,
  apiKeyPrefix,
};
