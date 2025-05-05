import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const domain = process.env.DOMAIN_URL || 'localhost';

if (process.env.COTURN_STATIC_AUTH_SECRET === null) {
  throw Error('Invalid or no COTURN_STATIC_AUTH_SECRET provided in environment variables.');
}
const coturnStaticAuthSecret = process.env.COTURN_STATIC_AUTH_SECRET as string;

const coturnCredentialsExpiry = process.env.COTURN_CREDENTIALS_EXPIRY
  ? parseInt(process.env.COTURN_CREDENTIALS_EXPIRY)
  : 24 * 3600; // 24 hours

if (process.env.JWT_SECRET_KEY === null) {
  throw Error('Invalid or no JWT_SECRET_KEY provided in environment variables.');
}
const jwtSecretKey = process.env.JWT_SECRET_KEY as string;

if (process.env.DEFAULT_SOCKET_API_KEY === null) {
  throw Error('Invalid or no DEFAULT_SOCKET_API_KEY provided in environment variables.');
}
const defaultApiKey = process.env.DEFAULT_SOCKET_API_KEY as string;

export {
  coturnCredentialsExpiry,
  coturnStaticAuthSecret,
  defaultApiKey,
  domain,
  isProduction,
  jwtSecretKey,
  port,
};
