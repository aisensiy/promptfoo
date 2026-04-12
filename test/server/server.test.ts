import { EventEmitter } from 'node:events';
import http from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../../src/migrate', () => ({
  runDbMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/database/signal', () => ({
  setupSignalWatcher: vi.fn().mockReturnValue({
    close: vi.fn(),
    on: vi.fn(),
  }),
}));

vi.mock('../../src/util/server', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/util/server')>('../../src/util/server');
  return {
    ...actual,
    openBrowser: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/models/eval', () => ({
  default: {
    latest: vi.fn().mockResolvedValue(null),
  },
  getEvalSummaries: vi.fn().mockResolvedValue([]),
}));

import { setupSignalWatcher } from '../../src/database/signal';
import logger from '../../src/logger';
// Import after mocks are set up
import { handleServerError, startServer } from '../../src/server/server';
import { BrowserBehavior, openBrowser } from '../../src/util/server';

describe('server', () => {
  describe('handleServerError', () => {
    const originalExit = process.exit;

    beforeEach(() => {
      process.exit = vi.fn() as never;
      vi.clearAllMocks();
    });

    afterEach(() => {
      process.exit = originalExit;
    });

    it('should log specific message for EADDRINUSE error', () => {
      const error = new Error('Address in use') as NodeJS.ErrnoException;
      error.code = 'EADDRINUSE';

      handleServerError(error, 3000);

      expect(logger.error).toHaveBeenCalledWith(
        'Port 3000 is already in use. Do you have another Promptfoo instance running?',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should log generic message for other errors', () => {
      const error = new Error('Some other error') as NodeJS.ErrnoException;
      error.code = 'ENOENT';

      handleServerError(error, 3000);

      expect(logger.error).toHaveBeenCalledWith('Failed to start server: Some other error');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('startServer shutdown behavior', () => {
    type MockHttpServer = EventEmitter & {
      listen: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      listening: boolean;
    };

    let mockHttpServer: MockHttpServer;
    let originalCreateServer: typeof http.createServer;
    let signalHandlers: Map<string | symbol, ((...args: unknown[]) => void)[]>;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(openBrowser).mockResolvedValue(undefined);
      vi.mocked(setupSignalWatcher).mockReturnValue({
        close: vi.fn(),
        on: vi.fn(),
      } as never);

      // Track signal handlers using a Map to support multiple handlers per event
      signalHandlers = new Map();

      vi.spyOn(process, 'once').mockImplementation(
        (event: string | symbol, handler: (...args: unknown[]) => void) => {
          if (event === 'SIGINT' || event === 'SIGTERM') {
            if (!signalHandlers.has(event)) {
              signalHandlers.set(event, []);
            }
            signalHandlers.get(event)!.push(handler);
          }
          return process;
        },
      );

      // Create mock HTTP server
      mockHttpServer = Object.assign(new EventEmitter(), {
        listening: false,
        listen: vi.fn().mockImplementation(function (
          this: MockHttpServer,
          _port: number,
          hostOrCallback: string | (() => void),
          maybeCallback?: () => void,
        ) {
          const callback = typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback;
          // Simulate async listen - server is now listening
          this.listening = true;
          setImmediate(() => callback?.());
          return this;
        }),
        close: vi.fn().mockImplementation(function (
          this: MockHttpServer,
          callback?: (err?: Error) => void,
        ) {
          this.listening = false;
          setImmediate(() => callback?.());
        }),
      });

      // Mock http.createServer
      originalCreateServer = http.createServer;
      (http.createServer as unknown) = vi.fn().mockReturnValue(mockHttpServer);
    });

    afterEach(() => {
      http.createServer = originalCreateServer;
      vi.unstubAllEnvs();
      vi.resetAllMocks();
      vi.restoreAllMocks();
    });

    const triggerSignal = (signal: 'SIGINT' | 'SIGTERM') => {
      const handlers = signalHandlers.get(signal);
      if (handlers) {
        for (const handler of handlers) {
          handler();
        }
      }
    };

    const waitForServerStart = async () => {
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    };

    it('should register SIGINT and SIGTERM handlers', async () => {
      // Start server and immediately trigger shutdown
      const serverPromise = startServer(0);

      // Wait for server to start
      await new Promise((resolve) => setImmediate(resolve));

      expect(signalHandlers.has('SIGINT')).toBe(true);
      expect(signalHandlers.has('SIGTERM')).toBe(true);

      // Trigger shutdown to complete the promise
      triggerSignal('SIGINT');
      await serverPromise;
    });

    it('should close file watcher on shutdown', async () => {
      const mockWatcher = { close: vi.fn(), on: vi.fn() };
      vi.mocked(setupSignalWatcher).mockReturnValue(mockWatcher as never);

      const serverPromise = startServer(0);

      // Wait for server to start
      await new Promise((resolve) => setImmediate(resolve));

      // Trigger SIGINT
      triggerSignal('SIGINT');
      await serverPromise;

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should log server closure', async () => {
      const serverPromise = startServer(0);

      // Wait for server to start
      await new Promise((resolve) => setImmediate(resolve));

      // Trigger SIGINT
      triggerSignal('SIGINT');
      await serverPromise;

      expect(logger.info).toHaveBeenCalledWith('Shutting down server...');
      expect(logger.info).toHaveBeenCalledWith('Server closed');
    });

    it('should handle httpServer.close error gracefully', async () => {
      // Mock close to call callback with error
      mockHttpServer.close = vi.fn().mockImplementation(function (
        callback?: (err?: Error) => void,
      ) {
        setImmediate(() => callback?.(new Error('Close failed')));
      });

      const serverPromise = startServer(0);

      // Wait for server to start
      await new Promise((resolve) => setImmediate(resolve));

      // Trigger SIGINT
      triggerSignal('SIGINT');
      await serverPromise;

      expect(logger.warn).toHaveBeenCalledWith('Error closing server: Close failed');
      expect(logger.info).toHaveBeenCalledWith('Server closed');
    });

    // Note: Testing the case where socket.io already closed the HTTP server would require
    // mocking socket.io at the module level. The fix (checking httpServer.listening) handles
    // this case in production where io.close() closes the underlying server.
    //
    // Note: Testing the 5-second force shutdown timeout requires mocking socket.io
    // at the module level, which is complex. The timeout exists as a safety measure
    // and the core shutdown logic is tested by the other tests.

    it('should handle SIGTERM the same as SIGINT', async () => {
      const serverPromise = startServer(0);

      // Wait for server to start
      await new Promise((resolve) => setImmediate(resolve));

      // Trigger SIGTERM instead of SIGINT
      triggerSignal('SIGTERM');
      await serverPromise;

      expect(logger.info).toHaveBeenCalledWith('Shutting down server...');
      expect(logger.info).toHaveBeenCalledWith('Server closed');
    });

    it('should bind to loopback by default', async () => {
      const serverPromise = startServer(0);

      await waitForServerStart();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(0, 'localhost', expect.any(Function));
      expect(openBrowser).toHaveBeenCalledWith(BrowserBehavior.ASK, 0, 'http://localhost:0');

      triggerSignal('SIGINT');
      await serverPromise;
    });

    it('should use PROMPTFOO_SERVER_HOST when set', async () => {
      vi.stubEnv('PROMPTFOO_SERVER_HOST', '0.0.0.0');
      const serverPromise = startServer(0);

      await waitForServerStart();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(0, '0.0.0.0', expect.any(Function));
      expect(openBrowser).toHaveBeenCalledWith(BrowserBehavior.ASK, 0, 'http://localhost:0');

      triggerSignal('SIGINT');
      await serverPromise;
    });

    it('should pass non-loopback host URLs to browser handling', async () => {
      vi.stubEnv('PROMPTFOO_SERVER_HOST', '192.168.1.10');
      const serverPromise = startServer(5000, BrowserBehavior.OPEN);

      await waitForServerStart();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        5000,
        '192.168.1.10',
        expect.any(Function),
      );
      expect(openBrowser).toHaveBeenCalledWith(
        BrowserBehavior.OPEN,
        5000,
        'http://192.168.1.10:5000',
      );

      triggerSignal('SIGINT');
      await serverPromise;
    });
  });
});
