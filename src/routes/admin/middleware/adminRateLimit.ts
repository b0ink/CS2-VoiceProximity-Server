import { NextFunction, Request, Response } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { RATELIMIT_ADMIN_DURATION, RATELIMIT_ADMIN_POINTS } from '../../../config';

const adminRateLimiter = new RateLimiterMemory({
  points: RATELIMIT_ADMIN_POINTS,
  duration: RATELIMIT_ADMIN_DURATION,
});

export function adminRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip;
  if (!ip) {
    res.status(400).send('Invalid request');
    return;
  }

  adminRateLimiter
    .consume(ip)
    .then(() => next())
    .catch(() => res.status(429).send(`Too Many Requests.`));
}
