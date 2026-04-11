import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, isSocketIoOriginAllowed } from '../../src/server/server';

describe('server CORS', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.stubEnv('PROMPTFOO_CSRF_ALLOWED_ORIGINS', '');
    app = createApp();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not expose local API responses to hostile browser origins', async () => {
    const response = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows localhost browser origins', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Host', '127.0.0.1:15500');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('keeps non-browser clients working without CORS headers', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows configured browser origins', async () => {
    vi.stubEnv('PROMPTFOO_CSRF_ALLOWED_ORIGINS', 'https://allowed.example');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://allowed.example')
      .set('Host', 'localhost:15500');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example');
  });

  it('uses the same allow policy for Socket.IO origins', () => {
    expect(isSocketIoOriginAllowed('https://evil.example', 15500)).toBe(false);
    expect(isSocketIoOriginAllowed('http://localhost:3000', 15500)).toBe(true);
    expect(isSocketIoOriginAllowed(undefined, 15500)).toBe(true);
  });
});
