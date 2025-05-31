import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { DOMAIN, IS_PRODUCTION, JWT_SECRET_KEY } from '../config';
import { JwtAuthPayload, SteamOpenIDParams } from '../types';

const router = Router();

router.get('/verify-steam', async (req: Request, res: Response) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const params: SteamOpenIDParams = {
    ns: url.searchParams.get('openid.ns') || undefined,
    mode: url.searchParams.get('openid.mode') || undefined,
    op_endpoint: url.searchParams.get('openid.op_endpoint') || undefined,
    claimed_id: url.searchParams.get('openid.claimed_id') || undefined,
    identity: url.searchParams.get('openid.identity') || undefined,
    return_to: url.searchParams.get('openid.return_to') || undefined,
    response_nonce: url.searchParams.get('openid.response_nonce') || undefined,
    assoc_handle: url.searchParams.get('openid.assoc_handle') || undefined,
    signed: url.searchParams.get('openid.signed') || undefined,
    sig: url.searchParams.get('openid.sig') || undefined,
  };

  const steamId64 = params.identity?.split('.com/openid/id/')[1];
  const isPayloadValid = await validateSteamAuth(params);

  if (!isPayloadValid || !steamId64) {
    return res.render('auth-failed');
  }

  const jwtPayload: JwtAuthPayload = {
    steamId: steamId64,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    aud: DOMAIN,
  };

  try {
    const token = jwt.sign(jwtPayload, JWT_SECRET_KEY);
    res
      .cookie('token', token, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
      })
      .render('auth-success', {
        redirectUrl: `${process.env.REDIRECT_URL_PROTOCOL}?token=${token}`,
      });
  } catch (e) {
    console.error(e);
    return res.render('auth-failed');
  }
});

async function validateSteamAuth(payload: SteamOpenIDParams): Promise<boolean> {
  const params = new URLSearchParams({
    'openid.ns': payload.ns!,
    'openid.op_endpoint': payload.op_endpoint!,
    'openid.claimed_id': payload.claimed_id!,
    'openid.identity': payload.identity!,
    'openid.return_to': payload.return_to!,
    'openid.response_nonce': payload.response_nonce!,
    'openid.assoc_handle': payload.assoc_handle!,
    'openid.signed': payload.signed!,
    'openid.sig': payload.sig!,
    'openid.mode': 'check_authentication',
  });

  const response = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  // console.log(`Validating steam auth response:\n---\n${text}\n---`);
  return text.includes('is_valid:true');
}

export default router;
