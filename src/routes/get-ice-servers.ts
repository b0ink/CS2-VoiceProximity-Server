import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { authenticateToken } from '../authenticateToken';
import { ICE_SERVER_CONFIG } from '../config';
import { IceServer, TurnCredential } from '../shared-types';

const router = Router();

interface TurnCredentialCache {
  credential: TurnCredential;
  expiresAt: number;
}
const turnCredentialsCache: Map<string, TurnCredentialCache> = new Map<
  string,
  TurnCredentialCache
>();

router.get('/get-ice-servers', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'Unauthorised' });
    return;
  }

  const authData = await authenticateToken(token);
  if (!authData || !authData.valid || !authData?.payload?.steamId) {
    res.status(401).json({ message: 'Unauthorised' });
    return;
  }

  const iceServers: IceServer[] = [];

  for (const iceServer of ICE_SERVER_CONFIG.iceServers) {
    const server: IceServer = {
      type: 'STUN',
      uri: iceServer.urls,
    };

    if (iceServer.urls.startsWith('turn')) {
      server.type = 'TURN';
      if (iceServer.coturnStaticAuthSecret) {
        server.turnCredential = getTurnCredential(
          authData.payload.steamId,
          iceServer.coturnStaticAuthSecret,
          iceServer.credentialExpiry,
          iceServer.credentialsRenewalWindow,
        );
      } else if (iceServer.defaultUsername && iceServer.defaultPassword) {
        server.turnCredential = {
          username: iceServer.defaultUsername,
          password: iceServer.defaultPassword,
        };
      }
    }
    if (ICE_SERVER_CONFIG.forceRelayOnly && server.type !== 'TURN') {
      continue;
    }
    iceServers.push(server);
  }

  res.status(200).json({
    message: 'Success',
    data: {
      iceServers: iceServers,
      forceRelayOnly: ICE_SERVER_CONFIG.forceRelayOnly,
    },
  });
  return;
});

const getTurnCredential = (
  steamId64: string,
  staticAuthSecret: string,
  credentialExpiry?: number,
  credentialRenewalWindow?: number,
): TurnCredential => {
  console.log(`Getting turn credentials for ${steamId64}`);

  const now = Math.floor(Date.now() / 1000);
  const window = credentialRenewalWindow ?? 3600;
  const expiryBase = Math.ceil(now / window) * window;
  const expiry = expiryBase + (credentialExpiry ?? 86400);
  const username = [expiry, steamId64].join(':');

  // Avoid calling hmac by caching the credentials
  // Once the expiry window is changed the usernames will no longer match, generating new credentials
  const cached = turnCredentialsCache.get(steamId64);
  if (cached && cached.credential.username === username && cached.expiresAt > now) {
    return cached.credential;
  }

  const hmac = crypto.createHmac('sha1', staticAuthSecret);
  hmac.setEncoding('base64');
  hmac.write(username);
  hmac.end();
  const password = hmac.read();

  const turnCredential: TurnCredential = {
    username,
    password,
  };

  turnCredentialsCache.set(steamId64, {
    credential: turnCredential,
    expiresAt: expiry,
  });

  return turnCredential;
};

export default router;
