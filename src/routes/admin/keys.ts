import { Request, Response, Router } from 'express';
import { ApiKey, generateApiKey, getApiKeys, loadDb } from '../../api-keys';
import { adminRateLimit } from './middleware/adminRateLimit';
import { verifySteamToken } from './middleware/verifySteamToken';

const router = Router();

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
    console.log(req.body);
    if (!req.body || !req.body.label || !req.body.expiresIn) {
      res.status(400).json({ error: 'Missing label or expiresIn' });
      return;
    }
    const { label, expiresIn } = req.body;

    const db = await loadDb();

    if (db.data.find((key) => key.label === label)) {
      res.status(401).json({ error: 'Key with this label already exists.' });
      return;
    }

    const newKey = generateApiKey(label, expiresIn);

    db.data.push(newKey);
    await db.write();

    res.status(200).json({
      ...newKey,
      key: newKey.censoredKey,
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
    if (!req.body || (!req.body.label && !req.body.expiresIn)) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    const db = await loadDb();
    const key = db.data.find((k) => k.id === req.params.id);
    if (!key) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }

    if (req.body.label) {
      if (db.data.find((key) => key.label === req.body.label)) {
        res.status(401).json({ error: 'Key with this label already exists.' });
        return;
      }

      key.label = req.body.label;
    }
    if (req.body.expiresIn) {
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
