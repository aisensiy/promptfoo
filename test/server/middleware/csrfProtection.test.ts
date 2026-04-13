import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  csrfProtection,
  isAllowedBrowserOrigin,
} from '../../../src/server/middleware/csrfProtection';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/logger', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/envars', () => ({
  getEnvString: vi.fn((_key: string, defaultValue?: string) => defaultValue ?? ''),
}));

import { getEnvString } from '../../../src/envars';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    path: '/api/eval',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('csrfProtection', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
    vi.mocked(getEnvString).mockImplementation(
      (_key: string, defaultValue?: string) => defaultValue ?? '',
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // Safe methods always pass
  describe('safe methods', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])('%s requests pass through', (method) => {
      const req = mockReq({
        method,
        headers: { 'sec-fetch-site': 'cross-site', origin: 'http://evil.com' },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // Path 1: Sec-Fetch-Site present
  describe('with Sec-Fetch-Site header', () => {
    it.each(['same-origin', 'same-site', 'none'])('allows POST with sec-fetch-site=%s', (value) => {
      const req = mockReq({ headers: { 'sec-fetch-site': value, host: 'localhost:15500' } });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks cross-site POST from evil.com', () => {
      const req = mockReq({
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://evil.com',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows cross-site from local.promptfoo.app to localhost (localhost equiv)', () => {
      const req = mockReq({
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://local.promptfoo.app:5173',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows cross-site from 127.0.0.1 to localhost (localhost equiv)', () => {
      const req = mockReq({
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://127.0.0.1:3000',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows cross-site from env var allowlisted origin', () => {
      vi.mocked(getEnvString).mockImplementation((_key: string, defaultValue?: string) => {
        if (_key === 'PROMPTFOO_CSRF_ALLOWED_ORIGINS') {
          return 'http://allowed.com';
        }
        return defaultValue ?? '';
      });
      const req = mockReq({
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://allowed.com',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks cross-site with no origin header', () => {
      const req = mockReq({
        headers: {
          'sec-fetch-site': 'cross-site',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // Path 2: No Sec-Fetch-Site, Origin present
  describe('with Origin header only (no Sec-Fetch-Site)', () => {
    it('allows POST for known local origin and host', () => {
      const req = mockReq({
        headers: {
          origin: 'http://localhost:5173',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks POST when an arbitrary origin hostname matches host', () => {
      const req = mockReq({
        headers: {
          origin: 'https://evil.example',
          host: 'evil.example:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks POST when origin hostname differs from host', () => {
      const req = mockReq({
        headers: {
          origin: 'http://evil.com',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows localhost equivalence via Origin fallback', () => {
      const req = mockReq({
        headers: {
          origin: 'http://local.promptfoo.app:5173',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // Path 3: No browser headers
  describe('non-browser clients (no Sec-Fetch-Site, no Origin)', () => {
    it('allows POST with no browser headers', () => {
      const req = mockReq({
        headers: { host: 'localhost:15500' },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // Other mutating methods
  describe('other mutating methods', () => {
    it.each(['DELETE', 'PUT', 'PATCH'])('blocks cross-site %s from evil.com', (method) => {
      const req = mockReq({
        method,
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://evil.com',
          host: 'localhost:15500',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // x-forwarded-host is NOT trusted (attacker-controllable)
  describe('x-forwarded-host', () => {
    it('ignores x-forwarded-host and uses Host header for origin comparison', () => {
      const req = mockReq({
        headers: {
          origin: 'http://evil.com',
          host: 'localhost:15500',
          'x-forwarded-host': 'evil.com',
        },
      });
      const res = mockRes();
      csrfProtection(req, res, next);
      // Should block: origin (evil.com) !== host (localhost), even though
      // x-forwarded-host matches origin. The header is attacker-controllable.
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});

describe('isAllowedBrowserOrigin', () => {
  beforeEach(() => {
    vi.mocked(getEnvString).mockImplementation(
      (_key: string, defaultValue?: string) => defaultValue ?? '',
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('allows non-browser requests without origin', () => {
    expect(isAllowedBrowserOrigin(undefined, 'localhost:15500')).toBe(true);
  });

  it('allows same-host browser origins', () => {
    expect(isAllowedBrowserOrigin('http://localhost:3000', 'localhost:15500')).toBe(true);
  });

  it('allows localhost aliases', () => {
    expect(isAllowedBrowserOrigin('http://local.promptfoo.app:5173', '127.0.0.1:15500')).toBe(true);
  });

  it('matches local hostnames case-insensitively', () => {
    expect(isAllowedBrowserOrigin('http://LOCALHOST:3000', 'LOCALHOST:15500')).toBe(true);
  });

  it('allows explicitly configured origins', () => {
    vi.mocked(getEnvString).mockImplementation((_key: string, defaultValue?: string) => {
      if (_key === 'PROMPTFOO_CSRF_ALLOWED_ORIGINS') {
        return 'https://allowed.example';
      }
      return defaultValue ?? '';
    });

    expect(isAllowedBrowserOrigin('https://allowed.example', 'localhost:15500')).toBe(true);
  });

  it('rejects hostile browser origins', () => {
    expect(isAllowedBrowserOrigin('https://evil.example', 'localhost:15500')).toBe(false);
  });
});
