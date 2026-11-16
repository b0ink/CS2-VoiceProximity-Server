import { Request, Response, Router } from 'express';
import { ApiKey, generateApiKey, getApiKeys, loadDb } from '../../api-keys';
import { adminRateLimit } from './middleware/adminRateLimit';
import { hasAdminSession, verifySteamToken } from './middleware/verifySteamToken';

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/', adminRateLimit, (req, res) => {
  const authorised = hasAdminSession(req);
  res.status(authorised ? 200 : 401).render('admin', { authorised });
});

function isValidExpiry(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Date.now() + value * 1000 <= 8.64e15
  );
}

router.get(
  '/keys',
  adminRateLimit,
  verifySteamToken,
  async (req: Request, res: Response): Promise<void> => {
    const keys = await getApiKeys();
    res.json(keys);
  },
);

router.post(
  '/keys',
  adminRateLimit,
  verifySteamToken,
  async (req: Request, res: Response): Promise<void> => {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const expiresIn = req.body?.expiresIn;
    if (!label || label.length > 100 || !isValidExpiry(expiresIn)) {
      res.status(400).json({
        error: 'Provide a label of 1–100 characters and a positive expiry in whole seconds.',
      });
      return;
    }

    const db = await loadDb();

    if (db.data.find((key) => key.label === label)) {
      res.status(409).json({ error: 'Key with this label already exists.' });
      return;
    }

    const newKey = generateApiKey(label, expiresIn);

    db.data.push(newKey);
    await db.write();

    res.status(200).json({
      ...newKey,
    });
  },
);

router.delete(
  '/keys/:id',
  adminRateLimit,
  verifySteamToken,
  async (req: Request, res: Response): Promise<void> => {
    const db = await loadDb();
    const index = db.data.findIndex((k) => k.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }

    db.data.splice(index, 1);
    await db.write();
    res.status(204).end();
  },
);

router.put(
  '/keys/:id',
  adminRateLimit,
  verifySteamToken,
  async (req: Request, res: Response): Promise<void> => {
    const hasLabel = req.body?.label !== undefined;
    const hasExpiry = req.body?.expiresIn !== undefined;
    if (!hasLabel && !hasExpiry) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
    if (hasLabel && (!label || label.length > 100)) {
      res.status(400).json({ error: 'Provide a label of 1–100 characters.' });
      return;
    }
    if (hasExpiry && !isValidExpiry(req.body.expiresIn)) {
      res.status(400).json({ error: 'Provide a positive expiry in whole seconds.' });
      return;
    }

    const db = await loadDb();
    const key = db.data.find((k) => k.id === req.params.id);
    if (!key) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }

    if (hasLabel) {
      if (db.data.some((other) => other.id !== key.id && other.label === label)) {
        res.status(409).json({ error: 'Key with this label already exists.' });
        return;
      }

      key.label = label;
    }
    if (hasExpiry) {
      key.exp = Date.now() + req.body.expiresIn * 1000;
    }

    await db.write();
    const previewKey = new ApiKey(key);
    res.json({
      ...previewKey,
      key: previewKey.censoredKey,
    });
  },
);

export default router;
