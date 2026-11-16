// Real admin routes and authentication with synthetic credentials and an in-memory key store.
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const { config, loadSource } = require('./server.cjs');

function makeAdminApp(initialKeys = []) {
  const adminConfig = {
    ...config,
    ADMIN_STEAM_ID: '76561198000000001',
    API_KEY_PREFIX: 'test',
    RATELIMIT_ADMIN_POINTS: 1000,
    RATELIMIT_ADMIN_DURATION: 60,
  };
  const { ApiKey, generateApiKey } = loadSource('api-keys.ts', { './config': adminConfig });
  const db = { data: structuredClone(initialKeys), write: async () => {} };
  const router = loadSource('routes/admin/keys.ts', {
    './config': adminConfig,
    '../../../config': adminConfig,
    '../../api-keys': {
      ApiKey,
      generateApiKey,
      loadDb: async () => db,
      getApiKeys: async () =>
        db.data.map((data) => {
          const key = new ApiKey(data);
          return { ...key, key: key.censoredKey, isActive: key.isActive() };
        }),
    },
  }).default;
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.resolve(__dirname, '../../src/views'));
  app.use(express.static(path.resolve(__dirname, '../../src/public')));
  app.use(cookieParser());
  app.use(express.json());
  app.use('/admin', router);
  function cookie(steamId = adminConfig.ADMIN_STEAM_ID, expiresIn = '1h') {
    return `token=${jwt.sign({ steamId }, adminConfig.JWT_SECRET_KEY, {
      audience: adminConfig.DOMAIN,
      expiresIn,
    })}`;
  }
  return { app, db, cookie };
}

module.exports = { makeAdminApp };
