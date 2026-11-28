import { ApiError } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { buildDeps, buildServer } from '../server';
import type { Store } from '../store/store';

const testConfig = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', ...env });
const server = (env: Record<string, string> = {}) =>
  buildServer(buildDeps({}, testConfig(env)), testConfig(env));

describe('error shapes', () => {
  it('400 with Zod issues for an invalid body', async () => {
    const app = await server();
    const r = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { projectId: 'prj_azure_crest', locale: 'fr', consent: true, consentText: 'x' },
    });
    expect(r.statusCode).toBe(400);
    const body = ApiError.parse(r.json());
    expect(body.error).toBe('Validation failed');
    expect(JSON.stringify(body.details)).toContain('locale');
  });

  it('400 for malformed JSON, in the same shape', async () => {
    const app = await server();
    const r = await app.inject({
      method: 'POST',
      url: '/leads',
      headers: { 'content-type': 'application/json' },
      payload: '{"projectId":',
    });
    expect(r.statusCode).toBe(400);
    expect(ApiError.safeParse(r.json()).success).toBe(true);
  });

  it('413 for an oversized body', async () => {
    const app = await server();
    const r = await app.inject({
      method: 'POST',
      url: '/conversations/x/messages',
      payload: { text: 'a'.repeat(300 * 1024) },
    });
    expect(r.statusCode).toBe(413);
    expect(ApiError.safeParse(r.json()).success).toBe(true);
  });

  it('404 for unknown routes and unknown resources', async () => {
    const app = await server();
    const route = await app.inject({ method: 'GET', url: '/nope?x=1' });
    expect(route.statusCode).toBe(404);
    expect(route.json()).toEqual({ error: 'Route not found: GET /nope' });
    for (const url of ['/projects/prj_nope', '/conversations/conv_nope']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(404);
      expect(ApiError.safeParse(r.json()).success).toBe(true);
    }
    const patch = await app.inject({
      method: 'PATCH',
      url: '/leads/lead_nope',
      payload: { stage: 'lost' },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('409 for an illegal stage move', async () => {
    const app = await server();
    const { lead } = (
      await app.inject({
        method: 'POST',
        url: '/leads',
        payload: { projectId: 'prj_azure_crest', locale: 'en', consent: true, consentText: 'ok' },
      })
    ).json();
    const r = await app.inject({
      method: 'PATCH',
      url: `/leads/${lead.id}`,
      payload: { stage: 'reserved' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'Cannot move contacted -> reserved' });
  });

  it('500 never leaks internals; it returns the request id instead', async () => {
    const deps = buildDeps({}, testConfig());
    const broken: Store = {
      ...deps.store,
      name: 'memory',
      listLeads: async () => Promise.reject(new Error('db password is hunter2')),
    } as Store;
    const app = await buildServer({ ...deps, store: broken }, testConfig());
    const r = await app.inject({
      method: 'GET',
      url: '/leads',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'Internal server error', details: { requestId: 'req-123' } });
    expect(r.body).not.toContain('hunter2');
  });
});

describe('request ids', () => {
  it('echoes a sane incoming x-request-id and mints one otherwise', async () => {
    const app = await server();
    expect(
      (await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'abc-123' } }))
        .headers['x-request-id'],
    ).toBe('abc-123');
    const minted = (
      await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'bad id <script>' },
      })
    ).headers['x-request-id'];
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('health', () => {
  it('reports adapters', async () => {
    const r = await (await server()).inject({ method: 'GET', url: '/health' });
    expect(r.json()).toEqual({ ok: true, store: 'memory', channel: 'mock', crm: 'mock' });
  });
  it('503 when the store is down', async () => {
    const deps = buildDeps({}, testConfig());
    const down = Object.assign(Object.create(Object.getPrototypeOf(deps.store)), deps.store, {
      ping: async () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const r = await (
      await buildServer({ ...deps, store: down }, testConfig())
    ).inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, error: 'Store unreachable' });
  });
});

describe('CORS', () => {
  const preflight = (origin: string, method = 'PATCH') => ({
    method: 'OPTIONS' as const,
    url: '/leads/lead_1',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type',
    },
  });

  it('lets the web app and dashboard call the API, including PATCH from the dashboard', async () => {
    const app = await server({ CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001' });
    const r = await app.inject(preflight('http://localhost:3001'));
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(String(r.headers['access-control-allow-methods'])).toContain('PATCH');
    const get = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(get.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(get.headers['access-control-expose-headers'])).toContain('x-request-id');
  });

  it('does not grant other origins when an allow-list is set', async () => {
    const app = await server({ CORS_ORIGINS: 'http://localhost:3000' });
    const r = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('WhatsApp webhook verification', () => {
  const verify = (q: string) => ({ method: 'GET' as const, url: `/webhooks/whatsapp?${q}` });

  it('returns the challenge only for the configured token', async () => {
    const app = await server({ WHATSAPP_VERIFY_TOKEN: 's3cret' });
    const ok = await app.inject(
      verify('hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=42'),
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('42');
    expect(
      (await app.inject(verify('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42')))
        .statusCode,
    ).toBe(403);
  });

  it('refuses when no token is configured (an unset token must not match a missing one)', async () => {
    const app = await server();
    expect((await app.inject(verify('hub.mode=subscribe&hub.challenge=42'))).statusCode).toBe(403);
  });

  it('always acknowledges inbound webhooks, even with nothing parseable', async () => {
    const app = await server();
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      payload: { object: 'whatsapp_business_account', entry: [{ changes: [null] }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
});
