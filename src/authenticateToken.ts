import jwt from 'jsonwebtoken';
import { DOMAIN, JWT_SECRET_KEY } from './config';
import { JwtAuthPayload } from './types';

export interface AuthData {
  payload: JwtAuthPayload | null;
  valid: boolean;
  errorMessage: string;
}

export function authenticateToken(jwtToken: string): AuthData {
  const authData: AuthData = {
    payload: null,
    valid: false,
    errorMessage: '',
  };

  try {
    const verified = jwt.verify(jwtToken, JWT_SECRET_KEY, {
      audience: DOMAIN,
    });
    if (
      typeof verified === 'object' &&
      'steamId' in verified &&
      typeof verified.steamId === 'string'
    ) {
      authData.payload = verified as JwtAuthPayload;
      if (!authData.payload.steamId || authData.payload.steamId == '0') {
        throw new Error('Invalid steamId');
      }
      authData.valid = true;
    }
    authData.payload = verified as JwtAuthPayload;
  } catch (err) {
    authData.payload = null;
    console.log(`Failed to verify jwt: ${err}`);
  }
  return authData;
}
