import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { coturnCredentialsExpiry, coturnStaticAuthSecret, domain, jwtSecretKey } from '../config';
import { JwtAuthPayload, SteamIdTurnCredentialMap, TurnCredential } from '../types';

const router = Router();
const turnCredentials: SteamIdTurnCredentialMap = {};

router.get('/get-turn-credential', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // const credentials = getTURNCredentials('76561197972732773');
  // return res.status(200).json({ message: 'Success', data: credentials });

  if (!token) {
    res.status(401).json({ message: 'Unauthorised' });
    return;
  }
  try {
    const verified = jwt.verify(token, jwtSecretKey, {
      audience: domain,
    });
    const payload = verified as JwtAuthPayload;
    if (payload.steamId) {
      const credentials = getTURNCredentials(payload.steamId);
      res.status(200).json({ message: 'Success', data: credentials });
      return;
    }
  } catch (e) {
    console.error(e);
    res.status(401).json({ message: 'Unauthorised' });
    return;
  }
  res.status(500).json({ message: 'Unauthorised' });
});

const getTURNCredentials = (steamId64: string) => {
  console.log(`Getting turn credentials for ${steamId64}`);
  // TODO: we could also cache via ip to prevent abuse
  const cached = turnCredentials[steamId64];

  if (cached) {
    const [expiryStr] = cached.username.split(':');
    const expiry = parseInt(expiryStr, 10);

    // check if the cached credential has expired (or is about to within 60 seconds)
    if (!isNaN(expiry) && expiry - 60 > Date.now() / 1000) {
      return cached;
    } else {
      delete turnCredentials[steamId64]; // cleanup expired
    }
  }

  const unixTimeStamp = Math.floor(Date.now() / 1000) + coturnCredentialsExpiry; // this credential would be valid for the next 24 hours
  const username = [unixTimeStamp, steamId64].join(':');
  const hmac = crypto.createHmac('sha1', coturnStaticAuthSecret);
  hmac.setEncoding('base64');
  hmac.write(username);
  hmac.end();
  const password = hmac.read();

  const turnCredential: TurnCredential = {
    username,
    password,
  };

  turnCredentials[steamId64] = turnCredential;

  return turnCredential;
};

export default router;
