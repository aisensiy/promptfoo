import * as fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';
import { generateConfigFile } from '../../code-scan-action/src/config';

describe('generateConfigFile', () => {
  const generatedPaths: string[] = [];

  afterEach(() => {
    for (const configPath of generatedPaths.splice(0)) {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  });

  function readGeneratedConfig(minimumSeverity: string, guidance?: string): string {
    const configPath = generateConfigFile(minimumSeverity, guidance);
    generatedPaths.push(configPath);
    return fs.readFileSync(configPath, 'utf8');
  }

  it('writes a normalized config for full-repository scans', () => {
    expect(readGeneratedConfig(' HIGH ')).toBe('minimumSeverity: high\ndiffsOnly: false\n');
  });

  it('escapes single-line guidance as a YAML string', () => {
    expect(readGeneratedConfig('medium', 'Review "auth" carefully')).toBe(
      'minimumSeverity: medium\ndiffsOnly: false\nguidance: "Review \\"auth\\" carefully"\n',
    );
  });

  it('writes multiline guidance as a YAML literal block', () => {
    expect(readGeneratedConfig('critical', 'Line one\nLine two')).toBe(
      'minimumSeverity: critical\ndiffsOnly: false\nguidance: |\n  Line one\n  Line two\n',
    );
  });

  it('rejects invalid severities', () => {
    expect(() => generateConfigFile('high!')).toThrow();
  });
});
