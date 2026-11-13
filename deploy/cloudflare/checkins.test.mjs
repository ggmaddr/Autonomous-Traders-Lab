import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const url = 'https://example.pages.dev/api/check-in';
const data = { name: 'Visitor Test', session_id: '16e28313-5764-4d9b-8e6a-591dbde4da00', entry_path: '/architecture' };
const request = (body = data, extra = {}) => new Request(url, { method: 'POST', headers: { Origin: 'https://example.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });
test('accepts bounded valid input with bound SQL parameters, acknowledges duplicate retry', async () => {
  let values;
  const CHECKINS = { prepare(sql) { return { bind(...args) { values = args; return { run: async () => ({ meta: { changes: 1 } }) }; } }; } };
  assert.equal((await worker.fetch(request(), { CHECKINS })).status, 200);
  assert.deepEqual(values, [data.session_id, data.name, data.entry_path]);
  const duplicate = { prepare() { return { bind() { return { run: async () => ({ meta: { changes: 0 } }), first: async () => ({ session_id: data.session_id }) }; } }; } };
  assert.equal((await worker.fetch(request(), { CHECKINS: duplicate })).status, 200);
});
test('rejects invalid inputs before storage', async () => {
  for (const body of [null, {}, { ...data, name: '' }, { ...data, name: 'a'.repeat(81) }, { ...data, name: 'bad\nname' }, { ...data, session_id: 'bad' }, { ...data, entry_path: '/?secret=bad' }]) {
    assert.equal((await worker.fetch(request(body), {})).status, 400);
  }
  assert.equal((await worker.fetch(request({ ...data, name: 'x'.repeat(3000) }), {})).status, 413);
  assert.equal((await worker.fetch(request(data, { headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' } }), {})).status, 403);
  assert.equal((await worker.fetch(request(data, { headers: { Origin: 'https://example.pages.dev', 'Content-Type': 'text/plain' } }), {})).status, 415);
});
test('private visitor records and all other writes remain inaccessible', async () => {
  assert.equal((await worker.fetch(new Request(url), {})).status, 405);
  for (const path of ['/api/experiments', '/api/traders', '/api/check-ins']) {
    assert.equal((await worker.fetch(new Request('https://example.pages.dev' + path, { method: 'POST' }), {})).status, 405);
  }
});
test('missing storage, failure and write ceiling have explicit responses', async () => {
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(request(), { CHECKINS: { prepare() { throw Error('secret'); } } })).status, 503);
  const CHECKINS = { prepare() { return { bind() { return { run: async () => ({ meta: { changes: 0 } }), first: async () => null }; } }; } };
  assert.equal((await worker.fetch(request(), { CHECKINS })).status, 429);
});

test('explicit anonymous check-ins store an empty name and stable session ID', async () => {
  let values;
  const CHECKINS = { prepare() { return { bind(...args) { values = args; return { run: async () => ({ meta: { changes: 1 } }) }; } }; } };
  assert.equal((await worker.fetch(request({ ...data, name: '', anonymous: true }), { CHECKINS })).status, 200);
  assert.deepEqual(values, [data.session_id, '', data.entry_path]);
  assert.equal((await worker.fetch(request({ ...data, name: '', anonymous: 'true' }), { CHECKINS })).status, 400);
});
