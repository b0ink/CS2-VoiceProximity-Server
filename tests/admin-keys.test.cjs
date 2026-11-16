const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { makeAdminApp } = require('./helpers/admin-server.cjs');

async function setup(t) {
  const state = makeAdminApp();
  const server = state.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, cookie = state.cookie()) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { ...state, request };
}

test('dashboard and all key endpoints require the configured admin cookie', async (t) => {
  const { request, cookie, db } = await setup(t);
  for (const session of [
    '',
    'token=invalid',
    cookie('76561198000000002'),
    cookie(undefined, '-1h'),
  ]) {
    const dashboard = await request('/admin', 'GET', undefined, session);
    assert.equal(dashboard.status, 401);
    assert.equal(dashboard.headers.get('cache-control'), 'no-store');
    const html = await dashboard.text();
    assert.match(html, /Sign in to continue/);
    assert.doesNotMatch(html, /id="keys-body"|src="\/admin.js"/);
    for (const [method, url] of [
      ['GET', '/admin/keys'],
      ['POST', '/admin/keys'],
      ['PUT', '/admin/keys/missing'],
      ['DELETE', '/admin/keys/missing'],
    ]) {
      const response = await request(url, method, undefined, session);
      assert.equal(response.status, 401);
    }
  }
  assert.equal(db.data.length, 0);
  for (const url of ['/admin', '/admin/']) {
    const dashboard = await request(url);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /id="keys-body"/);
  }
});

test('create, list, renew, rename, and delete keys without exposing existing secrets', async (t) => {
  const { request, db } = await setup(t);
  const created = await request('/admin/keys', 'POST', { label: '  Sydney #1  ', expiresIn: 3600 });
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const key = await created.json();
  assert.equal(key.label, 'Sydney #1');
  assert.match(key.key, /^test_[a-zA-Z0-9]+$/);
  assert.ok(Math.abs(key.exp - key.iat - 3600000) < 1000);
  const listed = await (await request('/admin/keys')).json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, `**************${key.key.slice(-3)}`);
  assert.equal(listed[0].isActive, true);
  const duplicate = await request('/admin/keys', 'POST', { label: 'Sydney #1', expiresIn: 3600 });
  assert.equal(duplicate.status, 409);

  // Renewing with the unchanged label must succeed, including for an expired key.
  db.data[0].exp = Date.now() - 1000;
  const expired = await (await request('/admin/keys')).json();
  assert.equal(expired[0].isActive, false);
  const renewed = await request(`/admin/keys/${key.id}`, 'PUT', {
    label: key.label,
    expiresIn: 86400,
  });
  assert.equal(renewed.status, 200);
  const updated = await renewed.json();
  assert.equal(updated.key, listed[0].key);
  assert.ok(updated.exp > Date.now() + 86300000);
  assert.equal(db.data[0].key, key.key);
  const expiry = db.data[0].exp;
  const renamed = await request(`/admin/keys/${key.id}`, 'PUT', { label: 'Melbourne #1' });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).label, 'Melbourne #1');
  assert.equal(db.data[0].exp, expiry);
  await request('/admin/keys', 'POST', { label: 'Sydney #2', expiresIn: 60 });
  assert.equal((await request(`/admin/keys/${key.id}`, 'PUT', { label: 'Sydney #2' })).status, 409);
  const deleted = await request(`/admin/keys/${key.id}`, 'DELETE');
  assert.equal(deleted.status, 204);
  assert.equal(
    db.data.some((data) => data.key === key.key),
    false,
  );
  assert.equal((await request(`/admin/keys/${key.id}`, 'DELETE')).status, 404);
  assert.equal((await request(`/admin/keys/${key.id}`, 'PUT', { label: 'Missing' })).status, 404);
});

test('invalid labels and durations cannot create or corrupt stored keys', async (t) => {
  const { request, db } = await setup(t);
  for (const body of [
    undefined,
    {},
    { label: ' ', expiresIn: 60 },
    { label: 5, expiresIn: 60 },
    { label: 'a'.repeat(101), expiresIn: 60 },
    ...[0, -1, 1.5, '60', null, 1e15].map((expiresIn) => ({ label: 'Invalid', expiresIn })),
  ]) {
    assert.equal((await request('/admin/keys', 'POST', body)).status, 400);
  }
  assert.equal(db.data.length, 0);
  const created = await (
    await request('/admin/keys', 'POST', { label: 'Valid', expiresIn: 60 })
  ).json();
  const original = JSON.stringify(db.data);
  for (const body of [
    {},
    { label: '' },
    { label: ' ' },
    { label: {} },
    { expiresIn: -1 },
    { label: 'Changed', expiresIn: 'invalid' },
  ]) {
    assert.equal((await request(`/admin/keys/${created.id}`, 'PUT', body)).status, 400);
    assert.equal(JSON.stringify(db.data), original);
  }
});
