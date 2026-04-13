import { afterAll, afterEach, beforeAll, beforeEach, describe, vi } from 'vitest';
import { clearCache } from '../../src/cache';
import cliState from '../../src/cliState';
import { runExtensionHook } from '../../src/evaluatorHelpers';
import { runDbMigrations } from '../../src/migrate';

export function describeEvaluator(name: string, defineTests: () => void) {
  describe(name, () => {
    beforeAll(async () => {
      await runDbMigrations();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(runExtensionHook).mockReset();
      vi.mocked(runExtensionHook).mockImplementation(
        async (_extensions, _hookName, context) => context,
      );
      cliState.resume = false;
      cliState.basePath = '';
      cliState.webUI = false;
    });

    afterEach(async () => {
      vi.clearAllMocks();
      cliState.resume = false;
      cliState.basePath = '';
      cliState.webUI = false;
      await clearCache();
      if (global.gc) {
        global.gc();
      }
    });

    afterAll(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    defineTests();
  });
}
