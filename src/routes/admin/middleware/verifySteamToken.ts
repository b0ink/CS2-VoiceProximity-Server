import { NextFunction, Request, Response } from 'express';
import { authenticateToken } from '../../../authenticateToken';
import { ADMIN_STEAM_ID } from '../../../config';

export async function verifySteamToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.token;
  const authData = await authenticateToken(token);

  if (
    !authData.valid ||
    !authData.payload?.steamId ||
    authData.payload.steamId !== ADMIN_STEAM_ID
  ) {
    res.status(401).json({ error: 'Unauthorised.' });
    return;
  }

  next();
}
