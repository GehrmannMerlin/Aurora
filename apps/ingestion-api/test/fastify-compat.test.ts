import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

describe('fastify@5.10.0 / Node 24 compatibility gate', () => {
  it('builds a minimal app and reaches ready()', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    app.get('/ping', () => ({ ok: true }));
    await app.ready();
    expect(app.hasRoute({ method: 'GET', url: '/ping' })).toBe(true);
    await app.close();
  });

  it('serves JSON request and response via inject()', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    app.post('/echo', (request) => request.body);
    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ hello: 'world' }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hello: 'world' });
    await app.close();
  });

  it('invokes the error handler for thrown errors', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      const message = error instanceof Error ? error.message : String(error);
      void reply.code(500).send({ error: message });
    });
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'kaboom' });
    await app.close();
  });

  it('listens on an ephemeral loopback port and accepts a request', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    app.get('/health', () => ({ status: 'ok' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    expect(address).not.toBeNull();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    const url = `http://127.0.0.1:${String(port)}/health`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('closes cleanly, tolerates repeated close, and fires onClose', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    let onCloseFired = 0;
    app.addHook('onClose', () => {
      onCloseFired += 1;
    });
    app.get('/a', () => 'a');
    await app.ready();
    await app.close();
    await app.close();
    await app.close();
    expect(onCloseFired).toBe(1);
  });
});
