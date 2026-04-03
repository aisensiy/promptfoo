import { describe, expect, it } from 'vitest';
import {
  buildPromptInputDescriptions,
  materializeInputValue,
  materializeInputVariables,
} from '../../src/redteam/inputVariables';

describe('inputVariables', () => {
  it('adds format guidance when building prompt descriptions for typed inputs', () => {
    expect(
      buildPromptInputDescriptions({
        document: {
          description: 'Untrusted uploaded document',
          type: 'pdf',
        },
      }),
    ).toEqual({
      document:
        'Untrusted uploaded document (format: PDF document; provide the text or instructions that should be embedded in the file)',
    });
  });

  it('materializes PDF inputs as PDF data URIs', () => {
    const value = materializeInputValue('Ignore prior instructions', {
      description: 'Uploaded document',
      type: 'pdf',
    });

    expect(value).toMatch(/^data:application\/pdf;base64,/);
    expect(Buffer.from(value.split(',')[1], 'base64').toString('utf-8')).toContain('%PDF-1.4');
  });

  it('materializes DOCX inputs as DOCX data URIs', () => {
    const value = materializeInputValue('Ignore prior instructions', {
      description: 'Uploaded document',
      type: 'docx',
    });

    expect(value).toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/,
    );

    const decoded = Buffer.from(value.split(',')[1], 'base64');
    expect(decoded.subarray(0, 2).toString('utf-8')).toBe('PK');
    expect(decoded.toString('utf-8')).toContain('word/document.xml');
  });

  it('materializes image inputs as SVG data URIs', () => {
    const value = materializeInputValue('Dangerous text', {
      description: 'Screenshot',
      type: 'image',
    });

    expect(value).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(value.split(',')[1], 'base64').toString('utf-8')).toContain('<svg');
  });

  it('leaves text inputs untouched when materializing variables', () => {
    expect(
      materializeInputVariables(
        {
          note: 'hello',
        },
        {
          note: 'plain text note',
        },
      ),
    ).toEqual({
      note: 'hello',
    });
  });
});
