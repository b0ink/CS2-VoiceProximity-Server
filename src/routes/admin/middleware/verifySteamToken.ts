import { NextFunction, Request, Response } from 'express';
import { authenticateToken } from '../../../authenticateToken';
import { ADMIN_STEAM_ID } from '../../../config';

export function hasAdminSession(req: Request): boolean {
  const token = req.cookies?.token;
  if (typeof token !== 'string' || !token) return false;

  const authData = authenticateToken(token);
  return authData.valid && authData.payload?.steamId === ADMIN_STEAM_ID;
}

export async function verifySteamToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!hasAdminSession(req)) {
    res.status(401).json({ error: 'Unauthorised.' });
    return;
  }

  next();
}
