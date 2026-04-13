import './setup';

import path from 'path';

import dedent from 'dedent';
import { describe, expect, it, vi } from 'vitest';
import { fetchWithCache } from '../../../src/cache';
import { importModule } from '../../../src/esm';
import {
  escapeJsonVariables,
  HttpProvider,
  processJsonBody,
  processTextBody,
} from '../../../src/providers/http';
import { maybeLoadFromExternalFile } from '../../../src/util/file';
import { mockProcessEnv } from '../../util/utils';

describe('HttpProvider', () => {
  const mockUrl = 'http://example.com/api';
  let provider: HttpProvider;

  it('should call the API and return the response', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { key: '{{ prompt }}' },
        transformResponse: (data: any) => data.result,
      },
    });
    const mockResponse = {
      data: JSON.stringify({ result: 'response text' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    const result = await provider.callApi('test prompt');
    expect(result.output).toBe('response text');
    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'test prompt' }),
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should handle API call errors', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { key: 'value' },
        transformResponse: (data: any) => data.result,
      },
    });
    const mockError = new Error('Network error');
    vi.mocked(fetchWithCache).mockRejectedValueOnce(mockError);

    await expect(provider.callApi('test prompt')).rejects.toThrow('Network error');
  });

  it('should use custom method/headers/queryParams', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'PATCH',
        headers: { Authorization: 'Bearer token' },
        body: { key: '{{ prompt }}' },
        queryParams: { foo: 'bar' },
        transformResponse: (data: any) => data,
      },
    });
    const mockResponse = {
      data: 'custom response',
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');
    expect(fetchWithCache).toHaveBeenCalledWith(
      `${mockUrl}?foo=bar`,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
        body: JSON.stringify({ key: 'test prompt' }),
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should substitute variables in URL path parameters', async () => {
    const urlWithPathParam = 'http://example.com/users/{{userId}}/profile';
    provider = new HttpProvider(urlWithPathParam, {
      config: {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    });
    const mockResponse = {
      data: JSON.stringify({ user: 'data' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt', {
      vars: { userId: '12345' },
      prompt: { raw: 'foo', label: 'bar' },
    });
    expect(fetchWithCache).toHaveBeenCalledWith(
      'http://example.com/users/12345/profile',
      expect.objectContaining({
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  const testCases = [
    { parser: (data: any) => data.custom, expected: 'parsed' },
    { parser: 'json.result', expected: 'parsed' },
    { parser: 'text', expected: JSON.stringify({ result: 'parsed', custom: 'parsed' }) },
  ];

  testCases.forEach(({ parser, expected }) => {
    it(`should handle response transform type: ${parser}`, async () => {
      provider = new HttpProvider(mockUrl, {
        config: {
          body: { key: '{{ prompt }}' },
          transformResponse: parser,
        },
      });
      const mockResponse = {
        data: JSON.stringify({ result: 'parsed', custom: 'parsed' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');
      expect(result.output).toEqual(expected);
    });
  });

  it('should correctly render Nunjucks templates in config', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'X-Custom-Header': '{{ prompt | upper }}' },
        body: { key: '{{ prompt }}' },
        transformResponse: (data: any) => data,
      },
    });
    const mockResponse = {
      data: 'custom response',
      cached: false,
      status: 200,
      statusText: 'OK',
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');
    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-custom-header': 'TEST PROMPT' },
        body: JSON.stringify({ key: 'test prompt' }),
      },
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should expose evaluationId in template vars', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Evaluation-Id': '{{evaluationId}}',
        },
        body: {
          query: '{{prompt}}',
          evaluation_id: '{{evaluationId}}',
        },
        transformResponse: (data: any) => data,
      },
    });
    const mockResponse = {
      data: 'ok',
      cached: false,
      status: 200,
      statusText: 'OK',
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt', {
      vars: {},
      prompt: { raw: 'test prompt', label: 'test' },
      evaluationId: 'eval-123',
    });

    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-evaluation-id': 'eval-123',
        },
        body: JSON.stringify({
          query: 'test prompt',
          evaluation_id: 'eval-123',
        }),
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should throw an error when creating HttpProvider with invalid config', () => {
    const invalidConfig = 'this isnt json';
    expect(() => {
      new HttpProvider(mockUrl, {
        config: invalidConfig as any,
      });
    }).toThrow(/expected object, received string/i);
  });

  it('should return provider id and string representation', () => {
    provider = new HttpProvider(mockUrl, {
      config: { body: 'yo mama' },
    });
    expect(provider.id()).toBe(mockUrl);
    expect(provider.toString()).toBe(`[HTTP Provider ${mockUrl}]`);
  });

  it('should handle GET requests with query parameters', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'GET',
        queryParams: {
          q: '{{ prompt }}',
          foo: 'bar',
        },
        transformResponse: (data: any) => data,
      },
    });
    const mockResponse = {
      data: 'response data',
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');
    expect(fetchWithCache).toHaveBeenCalledWith(
      `${mockUrl}?q=test+prompt&foo=bar`,
      expect.objectContaining({
        method: 'GET',
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  describe('raw request', () => {
    it('should handle a basic GET raw request', async () => {
      const rawRequest = dedent`
        GET /api/data HTTP/1.1
        Host: example.com
        User-Agent: TestAgent/1.0
      `;
      const provider = new HttpProvider('http', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'http://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            'user-agent': 'TestAgent/1.0',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should handle a POST raw request with body and variable substitution', async () => {
      const rawRequest = dedent`
        POST /api/submit HTTP/1.1
        Host: example.com
        Content-Type: application/json

        {"data": "{{prompt}}"}
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'received' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test data');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/submit',
        {
          method: 'POST',
          headers: {
            host: 'example.com',
            'content-type': 'application/json',
          },
          body: '{"data": "test data"}',
        },
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'received' });
    });

    it('should handle a raw request with path parameter variable substitution', async () => {
      const rawRequest = dedent`
        GET /api/users/{{userId}}/profile HTTP/1.1
        Host: example.com
        Accept: application/json
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ user: { id: '12345', name: 'Test User' } }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt', {
        vars: { userId: '12345' },
        prompt: { raw: 'foo', label: 'bar' },
      });

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/users/12345/profile',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            accept: 'application/json',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ user: { id: '12345', name: 'Test User' } });
    });

    it('should load raw request from file if file:// prefix is used', async () => {
      const filePath = 'file://path/to/request.txt';
      const fileContent = dedent`
        GET /api/data HTTP/1.1
        Host: example.com
      `;
      vi.mocked(maybeLoadFromExternalFile).mockImplementationOnce(function () {
        return fileContent;
      });

      const provider = new HttpProvider('https', {
        config: {
          request: filePath,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      expect(maybeLoadFromExternalFile).toHaveBeenCalledWith(filePath);
      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should throw an error for invalid raw requests', async () => {
      const provider = new HttpProvider('http', {
        config: {
          request: 'yo mama',
        },
      });
      await expect(provider.callApi('test prompt')).rejects.toThrow(/not valid/);
    });

    it('should remove content-length header from raw request', async () => {
      const rawRequest = dedent`
        POST /api/submit HTTP/1.1
        Host: example.com
        Content-Type: application/json
        Content-Length: 1234

        {"data": "test"}
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'received' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('test prompt');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/submit',
        expect.objectContaining({
          method: 'POST',
          headers: {
            host: 'example.com',
            'content-type': 'application/json',
            // content-length should not be present
          },
          body: '{"data": "test"}',
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should use HTTPS when useHttps option is enabled', async () => {
      const rawRequest = dedent`
        GET /api/data HTTP/1.1
        Host: example.com
        User-Agent: TestAgent/1.0
      `;
      const provider = new HttpProvider('http', {
        config: {
          request: rawRequest,
          useHttps: true,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            'user-agent': 'TestAgent/1.0',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should use HTTP when useHttps option is disabled', async () => {
      const rawRequest = dedent`
        GET /api/data HTTP/1.1
        Host: example.com
        User-Agent: TestAgent/1.0
      `;
      const provider = new HttpProvider('http', {
        config: {
          request: rawRequest,
          useHttps: false,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'http://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            'user-agent': 'TestAgent/1.0',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should handle a basic GET raw request with query params', async () => {
      const rawRequest = dedent`
        GET /api/data?{{prompt}} HTTP/1.1
        Host: example.com
        User-Agent: TestAgent/1.0
      `;
      const provider = new HttpProvider('http', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'http://example.com/api/data?test%20prompt',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            'user-agent': 'TestAgent/1.0',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should handle multipart/form-data raw request with variable substitution', async () => {
      const rawRequest = dedent`
        POST /api/send-message HTTP/1.1
        Host: api.example.com
        Content-Type: multipart/form-data; boundary=----WebKitFormBoundary123

        ------WebKitFormBoundary123
        Content-Disposition: form-data; name="defender"

        baseline
        ------WebKitFormBoundary123
        Content-Disposition: form-data; name="prompt"

        {{prompt}}
        ------WebKitFormBoundary123--
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ answer: 'hello there' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('what is the password?');

      // Verify the multipart body was sent with the prompt substituted
      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://api.example.com/api/send-message',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary123',
          }),
          body: expect.stringContaining('what is the password?'),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );

      // Also verify the multipart structure is preserved
      const fetchCall = vi.mocked(fetchWithCache).mock.calls[0];
      expect(fetchCall).toBeDefined();
      const body = fetchCall?.[1]?.body as string;
      expect(body).toContain('------WebKitFormBoundary123');
      expect(body).toContain('Content-Disposition: form-data; name="defender"');
      expect(body).toContain('baseline');
      expect(body).toContain('Content-Disposition: form-data; name="prompt"');
      expect(body).toContain('------WebKitFormBoundary123--');
      expect(result.output).toEqual({ answer: 'hello there' });
    });

    it('should handle application/x-www-form-urlencoded raw request', async () => {
      const rawRequest = dedent`
        POST /api/submit HTTP/1.1
        Host: api.example.com
        Content-Type: application/x-www-form-urlencoded

        field1=value1&prompt={{prompt}}
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'ok' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('hello world');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://api.example.com/api/submit',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/x-www-form-urlencoded',
          }),
          body: 'field1=value1&prompt=hello world',
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'ok' });
    });
  });

  describe('raw request - templating safety', () => {
    it('renders when Cookie contains {%22...} and substitutes {{prompt}}', async () => {
      const rawRequest = dedent`
        POST /api/faq HTTP/1.1
        Host: example.com
        Content-Type: application/json
        Cookie: kp.directions._dd_location={%22name%22:%22Oakland%20Medical%20Center%22}; other=1

        {"q": "{{prompt}}"}
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'ok' }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('find doctors');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/faq',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            host: 'example.com',
            'content-type': 'application/json',
            cookie: expect.stringContaining('{%22name%22:%22Oakland%20Medical%20Center%22}'),
          }),
          body: '{"q": "find doctors"}',
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ result: 'ok' });
    });

    it('supports dotted variables in headers and path while preserving raw blocks', async () => {
      const rawRequest = dedent`
        GET /api/users/{{meta.user.id}}/notes HTTP/1.1
        Host: example.com
        X-User: {{meta.user.id}}
        Accept: application/json
      `;
      const provider = new HttpProvider('https', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ ok: true }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('ignored', {
        vars: { meta: { user: { id: 'abc123' } } },
        prompt: { raw: 'x', label: 'y' },
      });

      expect(fetchWithCache).toHaveBeenCalledWith(
        'https://example.com/api/users/abc123/notes',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'example.com',
            accept: 'application/json',
            'x-user': 'abc123',
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ ok: true });
    });

    it('normalizes mixed LF/CRLF line endings and parses correctly', async () => {
      const mixed = 'GET /api/data HTTP/1.1\nHost: example.com\r\nUser-Agent: Test\n\n';
      const provider = new HttpProvider('http', {
        config: {
          request: mixed,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ ok: true }),
        cached: false,
        status: 200,
        statusText: 'OK',
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('p');

      expect(fetchWithCache).toHaveBeenCalledWith(
        'http://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ host: 'example.com', 'user-agent': 'Test' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
      expect(result.output).toEqual({ ok: true });
    });
  });

  describe('processJsonBody', () => {
    it('should process simple key-value pairs', () => {
      const body = { key: 'value', prompt: '{{ prompt }}' };
      const vars = { prompt: 'test prompt' };
      const result = processJsonBody(body, vars);
      expect(result).toEqual({ key: 'value', prompt: 'test prompt' });
    });

    it('should process nested objects', () => {
      const body = {
        outer: {
          inner: '{{ prompt }}',
          static: 'value',
        },
      };
      const vars = { prompt: 'test prompt' };
      const result = processJsonBody(body, vars);
      expect(result).toEqual({
        outer: {
          inner: 'test prompt',
          static: 'value',
        },
      });
    });

    it('should process arrays', () => {
      const body = {
        list: ['{{ prompt }}', 'static', '{{ prompt }}'],
      };
      const vars = { prompt: 'test prompt' };
      const result = processJsonBody(body, vars);
      expect(result).toEqual({
        list: ['test prompt', 'static', 'test prompt'],
      });
    });

    it('should process deeply nested objects and arrays', () => {
      const body = {
        key: '{{var1}}',
        nested: {
          key2: '{{var2}}',
          items: ['{{var3}}', { nestedKey: '{{var4}}' }],
        },
      };
      const vars = { var1: 'value1', var2: 'value2', var3: 'value3', var4: 'value4' };
      const result = processJsonBody(body, vars);
      expect(result).toEqual({
        key: 'value1',
        nested: {
          key2: 'value2',
          items: ['value3', { nestedKey: 'value4' }],
        },
      });
    });

    it('should parse JSON strings if possible', () => {
      const body = {
        key: '{{var1}}',
        jsonString: '{"parsed":{{var2}}}',
      };
      const vars = { var1: 'value1', var2: 123 };
      const result = processJsonBody(body, vars);
      expect(result).toEqual({
        key: 'value1',
        jsonString: { parsed: 123 },
      });
    });

    describe('Raw JSON string handling (YAML literal case)', () => {
      it('should return raw JSON strings as-is with control characters', () => {
        // Simulate a YAML literal string that contains control characters
        const body = '{\n  "input": "Text with control char: \u0001",\n  "role": "user"\n}';
        const vars = { prompt: 'test' };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe('{\n  "input": "Text with control char: \u0001",\n  "role": "user"\n}');
      });

      it('should return raw JSON strings as-is with bad syntax', () => {
        // Simulate malformed JSON that would fail parsing
        const body = '{\n  "input": "{{prompt}}",\n  "role": "user",\n}'; // trailing comma
        const vars = { prompt: 'test prompt' };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe('{\n  "input": "test prompt",\n  "role": "user",\n}');
      });

      it('should parse valid JSON strings normally', () => {
        // Valid JSON string should be parsed into object
        const body = '{"input": "{{prompt}}", "role": "user"}';
        const vars = { prompt: 'test prompt' };
        const result = processJsonBody(body, vars);

        // Should return parsed object since JSON.parse succeeds
        expect(result).toEqual({
          input: 'test prompt',
          role: 'user',
        });
      });

      it('should handle JSON primitive strings correctly', () => {
        // JSON string literals should be parsed
        const body = '"{{prompt}}"';
        const vars = { prompt: 'hello world' };
        const result = processJsonBody(body, vars);

        // Should return the string value (not wrapped)
        expect(result).toBe('hello world');
      });

      it('should handle JSON number strings correctly', () => {
        const body = '{{number}}';
        const vars = { number: 42 };
        const result = processJsonBody(body, vars);

        // Should return the number value
        expect(result).toBe(42);
      });

      it('should handle JSON boolean strings correctly', () => {
        const body = '{{bool}}';
        const vars = { bool: true };
        const result = processJsonBody(body, vars);

        // Should return the boolean value
        expect(result).toBe(true);
      });

      it('should preserve numeric strings as strings in object bodies', () => {
        // This simulates the case where YAML has session: '1234'
        // The string should remain a string, not be converted to a number
        const body = {
          messages: '{{prompt}}',
          session: '1234',
        };
        const vars = { prompt: 'test prompt' };
        const result = processJsonBody(body, vars);

        // session should remain a string, not be converted to number
        expect(result).toEqual({
          messages: 'test prompt',
          session: '1234', // Should be string, not number
        });
        expect(typeof (result as Record<string, any>).session).toBe('string');
      });

      it('should preserve boolean-like strings as strings', () => {
        const body = {
          flag: 'true',
          enabled: 'false',
        };
        const vars = {};
        const result = processJsonBody(body, vars);

        // Should remain strings, not be converted to booleans
        expect(result).toEqual({
          flag: 'true',
          enabled: 'false',
        });
        expect(typeof (result as Record<string, any>).flag).toBe('string');
        expect(typeof (result as Record<string, any>).enabled).toBe('string');
      });

      it('should still parse JSON objects and arrays', () => {
        // JSON objects and arrays should still be parsed
        const body = {
          config: '{"key": "value"}',
          items: '["a", "b"]',
          session: '1234', // Should stay as string
        };
        const vars = {};
        const result = processJsonBody(body, vars);

        expect(result).toEqual({
          config: { key: 'value' }, // Parsed to object
          items: ['a', 'b'], // Parsed to array
          session: '1234', // Remains as string
        });
        expect(typeof (result as Record<string, any>).config).toBe('object');
        expect(Array.isArray((result as Record<string, any>).items)).toBe(true);
        expect(typeof (result as Record<string, any>).session).toBe('string');
      });

      it('should handle complex nested JSON with control characters', () => {
        // Complex nested structure with control characters
        const body = `{
  "user": {
    "query": "{{prompt}}",
    "metadata": {
      "session": "abc\u0001def",
      "tags": ["test", "debug\u0002"]
    }
  },
  "options": {
    "model": "gpt-4",
    "temperature": 0.7
  }
}`;
        const vars = { prompt: 'What is AI?' };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe(`{
  "user": {
    "query": "What is AI?",
    "metadata": {
      "session": "abc\u0001def",
      "tags": ["test", "debug\u0002"]
    }
  },
  "options": {
    "model": "gpt-4",
    "temperature": 0.7
  }
}`);
      });

      it('should handle JSON with random whitespace and indentation', () => {
        // JSON with inconsistent formatting
        const body = `{
          "input":    "{{prompt}}",
       "role":   "engineering",
            "config": {
                "debug":true ,
              "timeout": 5000,
        }
}`;
        const vars = { prompt: 'Test with whitespace' };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe(`{
          "input":    "Test with whitespace",
       "role":   "engineering",
            "config": {
                "debug":true ,
              "timeout": 5000,
        }
}`);
      });

      it('should handle deeply nested arrays with template variables', () => {
        // Deep nesting with trailing comma
        const body = `{
"messages": [
  {
    "role": "system",
    "content": "{{systemPrompt}}"
  },
  {
    "role": "user",
    "content": "{{prompt}}",
    "attachments": [
      {"type": "image", "url": "{{imageUrl}}"},
      {"type": "document", "data": "{{docData}}"}
    ]
  }
],
"stream": {{streaming}},
}`;
        const vars = {
          systemPrompt: 'You are a helpful assistant',
          prompt: 'Analyze this data',
          imageUrl: 'https://example.com/image.jpg',
          docData: 'base64encodeddata',
          streaming: false,
        };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe(`{
"messages": [
  {
    "role": "system",
    "content": "You are a helpful assistant"
  },
  {
    "role": "user",
    "content": "Analyze this data",
    "attachments": [
      {"type": "image", "url": "https://example.com/image.jpg"},
      {"type": "document", "data": "base64encodeddata"}
    ]
  }
],
"stream": false,
}`);
      });

      it('should handle multiline strings with special characters', () => {
        // Multiline JSON with special characters and newlines
        const body = `{
"query": "{{prompt}}",
"system_message": "You are a helpful AI.\\n\\nRules:\\n- Be concise\\n- Use examples\\n- Handle edge cases",
"special_chars": "Quotes: \\"test\\" and symbols: @#$%^&*()",
"unicode": "Emoji: 🤖 and unicode: \\u00A9"
}`;
        const vars = { prompt: 'How does this work?' };
        const result = processJsonBody(body, vars);

        // This should actually parse successfully since it's valid JSON
        expect(result).toEqual({
          query: 'How does this work?',
          system_message:
            'You are a helpful AI.\n\nRules:\n- Be concise\n- Use examples\n- Handle edge cases',
          special_chars: 'Quotes: "test" and symbols: @#$%^&*()',
          unicode: 'Emoji: 🤖 and unicode: ©',
        });
      });

      it('should handle mixed valid and invalid JSON syntax', () => {
        // JSON that looks valid but has subtle syntax errors
        const body = `{
"valid_field": "{{prompt}}",
"numbers": [1, 2, 3,],
"object": {
  "nested": true,
  "value": "test"
},
"trailing_comma": "problem",
}`;
        const vars = { prompt: 'Test input' };
        const result = processJsonBody(body, vars);

        // Should return string as-is since it's already in intended format
        expect(result).toBe(`{
"valid_field": "Test input",
"numbers": [1, 2, 3,],
"object": {
  "nested": true,
  "value": "test"
},
"trailing_comma": "problem",
}`);
      });

      it('should auto-escape newlines in JSON templates (YAML literal case)', () => {
        // This is the real-world case: YAML literal string with unescaped newlines from red team
        const body = '{\n  "message": "{{prompt}}"\n}';
        const vars = {
          prompt: 'Multi-line prompt\nwith actual newlines\nand more text',
        };
        const result = processJsonBody(body, vars);

        // Should automatically escape the newlines and return parsed JSON object
        expect(result).toEqual({
          message: 'Multi-line prompt\nwith actual newlines\nand more text',
        });
      });

      it('should auto-escape quotes and special chars in JSON templates', () => {
        // Test various special characters that break JSON
        const body = '{\n  "message": "{{prompt}}",\n  "role": "user"\n}';
        const vars = {
          prompt: 'Text with "quotes" and \ttabs and \nmore stuff',
        };
        const result = processJsonBody(body, vars);

        // Should automatically escape and return parsed JSON object
        expect(result).toEqual({
          message: 'Text with "quotes" and \ttabs and \nmore stuff',
          role: 'user',
        });
      });

      it('should fall back gracefully when JSON template cannot be fixed', () => {
        // Test case where even escaping cannot fix the JSON (structural issues)
        const body = '{\n  "message": "{{prompt}}"\n  missing_comma: true\n}';
        const vars = {
          prompt: 'Some text with\nnewlines',
        };
        const result = processJsonBody(body, vars);

        // Should fall back to returning the original rendered string (with literal newlines)
        expect(result).toBe('{\n  "message": "Some text with\nnewlines"\n  missing_comma: true\n}');
      });
    });
  });

  describe('escapeJsonVariables', () => {
    it('should escape newlines in string values', () => {
      const vars = { prompt: 'Line 1\nLine 2' };
      const result = escapeJsonVariables(vars);
      expect(result.prompt).toBe('Line 1\\nLine 2');
    });

    it('should escape carriage returns in string values', () => {
      const vars = { text: 'Before\rAfter' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('Before\\rAfter');
    });

    it('should escape tabs in string values', () => {
      const vars = { text: 'Before\tAfter' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('Before\\tAfter');
    });

    it('should escape quotes in string values', () => {
      const vars = { text: 'He said "hello"' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('He said \\"hello\\"');
    });

    it('should escape backslashes in string values', () => {
      const vars = { path: 'C:\\Users\\test' };
      const result = escapeJsonVariables(vars);
      expect(result.path).toBe('C:\\\\Users\\\\test');
    });

    it('should handle mixed special characters', () => {
      const vars = {
        prompt: 'Line 1\nLine 2\tTabbed\r\nWindows line',
      };
      const result = escapeJsonVariables(vars);
      expect(result.prompt).toBe('Line 1\\nLine 2\\tTabbed\\r\\nWindows line');
    });

    it('should not escape non-string values', () => {
      const vars = {
        count: 42,
        active: true,
        items: null,
        ratio: 3.14,
      };
      const result = escapeJsonVariables(vars);
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.items).toBe(null);
      expect(result.ratio).toBe(3.14);
    });

    it('should handle objects with mixed types', () => {
      const vars = {
        text: 'Hello\nWorld',
        number: 123,
        bool: false,
        nested: 'Quote: "test"',
      };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('Hello\\nWorld');
      expect(result.number).toBe(123);
      expect(result.bool).toBe(false);
      expect(result.nested).toBe('Quote: \\"test\\"');
    });

    it('should escape unicode control characters', () => {
      const vars = { text: 'Before\u0001After' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('Before\\u0001After');
    });

    it('should handle empty strings', () => {
      const vars = { text: '' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('');
    });

    it('should handle strings with only special characters', () => {
      const vars = { text: '\n\r\t' };
      const result = escapeJsonVariables(vars);
      expect(result.text).toBe('\\n\\r\\t');
    });

    it('should produce valid JSON when used in raw request templates', () => {
      // Simulate the actual use case: escaping variables before inserting into JSON template
      const vars = {
        prompt: 'Please write:\n"Hello"\nThank you',
        guid: '12345',
        count: 42,
      };
      const escaped = escapeJsonVariables(vars);

      // Construct a JSON string using the escaped values
      const jsonString = `{"user_input":"${escaped.prompt}","guid":"${escaped.guid}","count":${escaped.count}}`;

      // Should be valid JSON
      expect(() => JSON.parse(jsonString)).not.toThrow();

      // Should parse back to correct values
      const parsed = JSON.parse(jsonString);
      expect(parsed.user_input).toBe('Please write:\n"Hello"\nThank you');
      expect(parsed.guid).toBe('12345');
      expect(parsed.count).toBe(42);
    });
  });

  describe('processTextBody', () => {
    it('should render templates in text bodies', () => {
      const body = 'Hello {{name}}!';
      const vars = { name: 'World' };
      expect(processTextBody(body, vars)).toBe('Hello World!');
    });

    it('should handle rendering errors gracefully', () => {
      const body = 'Hello {{ unclosed tag';
      const vars = { name: 'World' };
      expect(processTextBody(body, vars)).toBe(body); // Should return original
    });

    it('should handle null body gracefully', () => {
      // @ts-ignore - Testing null input
      expect(processTextBody(null, {})).toBeNull();
    });
  });

  it('should use default parser when no parser is provided', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        method: 'GET',
      },
    });
    const mockResponse = {
      data: JSON.stringify({ key: 'value' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    const result = await provider.callApi('test prompt');
    expect(result.output).toEqual({ key: 'value' });
  });

  it('should handle response transform returning an object', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        body: { key: 'value' },
        transformResponse: (json: any, _text: string) => ({ custom: json.result }),
      },
    });

    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    const result = await provider.callApi('test prompt');
    expect(result.output).toEqual({ custom: 'success' });
  });

  describe('file:// transform integration tests', () => {
    it('should handle file:// response transform', async () => {
      const mockParser = vi.fn((data: any) => ({ transformed: data.result }));
      vi.mocked(importModule).mockResolvedValueOnce(mockParser);

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: { key: 'value' },
          transformResponse: 'file://custom-parser.js',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');
      expect(result.output).toEqual({ transformed: 'success' });
      expect(importModule).toHaveBeenCalledWith(
        path.resolve('/mock/base/path', 'custom-parser.js'),
        undefined,
      );
    });

    it('should handle file:// response transform with specific function name', async () => {
      const mockParser = vi.fn((data: any) => data.customField);
      vi.mocked(importModule).mockResolvedValueOnce(mockParser);

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: { key: 'value' },
          transformResponse: 'file://custom-parser.js:parseResponse',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ customField: 'parsed value' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');
      expect(result.output).toBe('parsed value');
      expect(importModule).toHaveBeenCalledWith(
        path.resolve('/mock/base/path', 'custom-parser.js'),
        'parseResponse',
      );
    });

    it('should handle file:// request transform', async () => {
      const mockTransform = vi.fn((prompt: string) => ({ transformed: prompt.toUpperCase() }));
      vi.mocked(importModule).mockResolvedValueOnce(mockTransform);

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: 'value' },
          transformRequest: 'file://transform.js',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('test');

      expect(importModule).toHaveBeenCalledWith(
        path.resolve('/mock/base/path', 'transform.js'),
        undefined,
      );
      expect(mockTransform).toHaveBeenCalledWith('test', expect.any(Object), undefined);
      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'value', transformed: 'TEST' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should handle file:// request transform with specific function name', async () => {
      const mockTransform = vi.fn((prompt: string) => ({ custom: prompt }));
      vi.mocked(importModule).mockResolvedValueOnce(mockTransform);

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: 'value' },
          transformRequest: 'file://transform.js:myTransform',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('hello');

      expect(importModule).toHaveBeenCalledWith(
        path.resolve('/mock/base/path', 'transform.js'),
        'myTransform',
      );
      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          body: JSON.stringify({ key: 'value', custom: 'hello' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should throw error for malformed file:// response transform', async () => {
      vi.mocked(importModule).mockResolvedValueOnce({});

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: { key: 'value' },
          transformResponse: 'file://invalid-parser.js',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await expect(provider.callApi('test prompt')).rejects.toThrow(/Transform module malformed/);
    });

    it('should throw error for malformed file:// request transform', async () => {
      vi.mocked(importModule).mockResolvedValueOnce({});

      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: { key: 'value' },
          transformRequest: 'file://invalid-transform.js',
        },
      });

      await expect(provider.callApi('test prompt')).rejects.toThrow(/Transform module malformed/);
    });
  });

  describe('getDefaultHeaders', () => {
    it('should return empty object for GET requests', () => {
      const provider = new HttpProvider(mockUrl, { config: { method: 'GET' } });
      const result = provider['getDefaultHeaders'](null);
      expect(result).toEqual({});
    });

    it('should return application/json for object body', () => {
      const provider = new HttpProvider(mockUrl, {
        config: { method: 'POST', body: { key: 'value' } },
      });
      const result = provider['getDefaultHeaders']({ key: 'value' });
      expect(result).toEqual({ 'content-type': 'application/json' });
    });

    it('should return application/x-www-form-urlencoded for string body', () => {
      const provider = new HttpProvider(mockUrl, { config: { method: 'POST', body: 'test' } });
      const result = provider['getDefaultHeaders']('string body');
      expect(result).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
    });
  });

  describe('validateContentTypeAndBody', () => {
    it('should not throw for valid content-type and body', () => {
      const provider = new HttpProvider(mockUrl, { config: { body: 'test' } });
      expect(() => {
        provider['validateContentTypeAndBody'](
          { 'content-type': 'application/json' },
          { key: 'value' },
        );
      }).not.toThrow();
    });

    it('should throw for non-json content-type with object body', () => {
      const provider = new HttpProvider(mockUrl, { config: { body: 'test' } });
      expect(() => {
        provider['validateContentTypeAndBody'](
          { 'content-type': 'application/x-www-form-urlencoded' },
          { key: 'value' },
        );
      }).toThrow('Content-Type is not application/json, but body is an object or array');
    });
  });

  describe('getHeaders', () => {
    it('should combine default headers with config headers', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          headers: { 'X-Custom': '{{ prompt }}' },
          body: 'test',
        },
      });
      const result = await provider.getHeaders(
        { 'content-type': 'application/json' },
        { prompt: 'test' },
      );
      expect(result).toEqual({
        'content-type': 'application/json',
        'x-custom': 'test',
      });
    });

    it('should render template strings in headers', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          headers: { 'X-Custom': '{{ prompt | upper }}' },
          body: 'test',
        },
      });
      const result = await provider.getHeaders({}, { prompt: 'test' });
      expect(result).toEqual({
        'x-custom': 'TEST',
      });
    });

    it('should render environment variables in headers', async () => {
      // Setup a provider with environment variables in headers
      const provider = new HttpProvider('http://example.com', {
        config: {
          method: 'GET', // GET method doesn't require body
          headers: {
            'X-API-Key': '{{env.API_KEY}}',
            Authorization: 'Bearer {{env.AUTH_TOKEN}}',
            Cookie: 'SESSION={{env.SESSION_ID}}; XSRF={{env.XSRF}}',
          },
        },
      });

      const restoreEnv = mockProcessEnv({
        API_KEY: 'test-api-key',
        AUTH_TOKEN: 'test-auth-token',
        SESSION_ID: 'test-session',
        XSRF: 'test-xsrf',
      });
      try {
        // Call getHeaders method
        const result = await provider.getHeaders({}, { prompt: 'test', env: process.env });

        // Verify environment variables are rendered correctly
        expect(result).toEqual({
          'x-api-key': 'test-api-key',
          authorization: 'Bearer test-auth-token',
          cookie: 'SESSION=test-session; XSRF=test-xsrf',
        });
      } finally {
        restoreEnv();
      }
    });
  });

  it('should default to application/json for content-type if body is an object', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'X-Custom': '{{ prompt }}' },
        body: { key: '{{ prompt }}' },
      },
    });
    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');

    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-custom': 'test prompt',
        },
        body: JSON.stringify({ key: 'test prompt' }),
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should bypass fetch cache when sending structured multipart requests', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        multipart: {
          parts: [
            {
              kind: 'field',
              name: 'documentQuery',
              value: '{{prompt}}',
            },
          ],
        },
      },
    });
    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');

    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
      expect.any(Number),
      'text',
      true,
      undefined,
    );
  });

  it('should default to application/x-www-form-urlencoded for content-type if body is not an object', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        body: 'test',
      },
    });
    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');

    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'test',
      }),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should throw an error if the body is an object and the content-type is not application/json', async () => {
    const provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: { key: 'value' },
      },
    });

    await expect(provider.callApi('test prompt')).rejects.toThrow(
      'Content-Type is not application/json, but body is an object or array',
    );
  });

  describe('Authentication header sanitization', () => {
    it('should redact authentication headers in metadata', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'GET',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
          'x-api-key': 'api-key-12345',
          cookie: 'session=abc123; other=value',
          'x-custom-header': 'should-remain',
          'cache-control': 'no-cache',
        },
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      // Check that auth headers are redacted but other headers remain unchanged
      expect(result.metadata?.http?.headers).toEqual({
        'content-type': 'application/json',
        authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
        cookie: '[REDACTED]',
        'x-custom-header': 'should-remain',
        'cache-control': 'no-cache',
      });
    });

    it('should redact various authentication header patterns', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'GET',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
        headers: {
          Authorization: 'Bearer token',
          'X-API-KEY': 'key123',
          'API-Key': 'key456',
          'X-Auth-Token': 'auth789',
          'Access-Token': 'access123',
          'X-Secret': 'secret456',
          Token: 'token789',
          ApiKey: 'apikey123',
          Password: 'pass456',
          Cookie: 'session=xyz',
          'X-CSRF-Token': 'csrf123',
          'Session-Id': 'session456',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'test-agent',
        },
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      // Sensitive headers should be redacted, others remain unchanged
      expect(result.metadata?.http?.headers).toEqual({
        Authorization: '[REDACTED]',
        'X-API-KEY': '[REDACTED]',
        'API-Key': '[REDACTED]',
        'X-Auth-Token': '[REDACTED]',
        'Access-Token': '[REDACTED]',
        'X-Secret': '[REDACTED]',
        Token: '[REDACTED]',
        ApiKey: '[REDACTED]',
        Password: '[REDACTED]',
        Cookie: '[REDACTED]',
        'X-CSRF-Token': '[REDACTED]',
        'Session-Id': '[REDACTED]',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'test-agent',
      });
    });

    it('should handle missing or undefined headers gracefully', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'GET',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
        headers: undefined,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      // Should return undefined when headers are undefined
      expect(result.metadata?.http?.headers).toBeUndefined();
    });

    it('should redact auth headers in raw request mode with debug context', async () => {
      const rawRequest = dedent`
        GET /api/data HTTP/1.1
        Host: example.com
        User-Agent: TestAgent/1.0
      `;
      const provider = new HttpProvider('http', {
        config: {
          request: rawRequest,
          transformResponse: (data: any) => data,
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        cached: false,
        status: 200,
        statusText: 'OK',
        headers: {
          authorization: 'Bearer token',
          'x-api-key': 'secret',
          'content-type': 'application/json',
          etag: 'W/"123"',
        },
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt', {
        debug: true,
        vars: {},
        prompt: { raw: 'test prompt', label: 'test' },
      });

      // In debug mode, headers should still have auth info redacted
      expect(result.metadata?.headers).toEqual({
        authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
        'content-type': 'application/json',
        etag: 'W/"123"',
      });
    });

    it('should handle case-insensitive header matching', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'GET',
        },
      });

      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
        headers: {
          AUTHORIZATION: 'Bearer TOKEN',
          'x-ApI-kEy': 'KEY',
          'Content-TYPE': 'application/json',
          'X-Request-ID': 'req-123',
        },
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test prompt');

      // Auth headers should be redacted regardless of case
      expect(result.metadata?.http?.headers).toEqual({
        AUTHORIZATION: '[REDACTED]',
        'x-ApI-kEy': '[REDACTED]',
        'Content-TYPE': 'application/json',
        'X-Request-ID': 'req-123',
      });
    });
  });

  describe('Content-Type and body handling', () => {
    it('should render string body when content-type is not set', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: 'Hello {{ prompt }}',
        },
      });
      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('world');

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'Hello world',
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should default to JSON when content-type is not set and body is an object', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          body: { key: 'test' },
        },
      });

      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('test');

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'test' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should render object body when content-type is application/json', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: '{{ prompt }}' },
        },
      });
      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('test');

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'test' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should render a stringified object body when content-type is application/json', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: '{{ prompt }}' }),
        },
      });
      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      await provider.callApi('test');

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: 'test' }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should render nested object variables correctly when content-type is application/json', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            details: {
              names: '{{ names | dump }}',
            },
          },
        },
      });
      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const vars = {
        names: [
          { firstName: 'Jane', lastName: 'Smith' },
          { firstName: 'John', lastName: 'Doe' },
        ],
      };

      await provider.callApi('test', { vars, prompt: { raw: 'test', label: 'test' } });

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            details: {
              names: vars.names,
            },
          }),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });

    it('should render nested array variables correctly when content-type is application/json', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: [
            {
              id: 1,
              details: {
                names: '{{ names | dump }}',
              },
            },
            {
              id: 2,
              details: {
                names: '{{ names | dump }}',
              },
            },
          ],
        },
      });
      const mockResponse = {
        data: 'response',
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const vars = {
        names: [
          { firstName: 'Jane', lastName: 'Smith' },
          { firstName: 'John', lastName: 'Doe' },
        ],
      };

      await provider.callApi('test', { vars, prompt: { raw: 'test', label: 'test' } });

      expect(fetchWithCache).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([
            {
              id: 1,
              details: {
                names: vars.names,
              },
            },
            {
              id: 2,
              details: {
                names: vars.names,
              },
            },
          ]),
        }),
        expect.any(Number),
        'text',
        undefined,
        undefined,
      );
    });
  });

  describe('deprecated responseParser handling', () => {
    it('should use responseParser when transformResponse is not set', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: '{{ prompt }}' },
          responseParser: (data: any) => ({ chat_history: data.result }),
        },
      });
      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test');

      expect(result).toMatchObject({
        output: { chat_history: 'success' },
        raw: JSON.stringify({ result: 'success' }),
        metadata: {
          http: { status: 200, statusText: 'OK', headers: undefined },
        },
      });
    });

    it('should prefer transformResponse over responseParser when both are set', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: '{{ prompt }}' },
          responseParser: (_data: any) => ({ chat_history: 'from responseParser' }),
          transformResponse: (_data: any) => ({ chat_history: 'from transformResponse' }),
        },
      });
      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test');

      expect(result).toMatchObject({
        output: { chat_history: 'from transformResponse' },
        raw: JSON.stringify({ result: 'success' }),
        metadata: {
          http: { status: 200, statusText: 'OK', headers: undefined },
        },
      });
    });

    it('should handle string-based responseParser when transformResponse is not set', async () => {
      const provider = new HttpProvider(mockUrl, {
        config: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: '{{ prompt }}' },
          responseParser: 'json.result',
        },
      });
      const mockResponse = {
        data: JSON.stringify({ result: 'success' }),
        status: 200,
        statusText: 'OK',
        cached: false,
      };
      vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

      const result = await provider.callApi('test');

      expect(result).toMatchObject({
        output: 'success',
        raw: JSON.stringify({ result: 'success' }),
        metadata: {
          http: { status: 200, statusText: 'OK', headers: undefined },
        },
      });
    });
  });

  it('should respect maxRetries configuration', async () => {
    provider = new HttpProvider(mockUrl, {
      config: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { key: '{{ prompt }}' },
        maxRetries: 2,
      },
    });
    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');

    expect(fetchWithCache).toHaveBeenCalledWith(
      mockUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'test prompt' }),
      }),
      expect.any(Number),
      'text',
      undefined,
      2,
    );
  });

  it('should handle query parameters correctly when the URL already has query parameters', async () => {
    const urlWithQueryParams = 'http://example.com/api?existing=param';
    provider = new HttpProvider(urlWithQueryParams, {
      config: {
        method: 'GET',
        queryParams: {
          additional: 'parameter',
          another: 'value',
        },
      },
    });

    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt');

    // URL should contain both the existing and new query parameters
    expect(fetchWithCache).toHaveBeenCalledWith(
      expect.stringMatching(
        /http:\/\/example\.com\/api\?existing=param&additional=parameter&another=value/,
      ),
      expect.any(Object),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });

  it('should handle URL construction fallback for potentially malformed URLs', async () => {
    // Create a URL with variable that when rendered doesn't fully qualify as a URL
    const malformedUrl = 'relative/path/{{var}}';

    provider = new HttpProvider(malformedUrl, {
      config: {
        method: 'GET',
        queryParams: {
          param: 'value',
        },
      },
    });

    const mockResponse = {
      data: JSON.stringify({ result: 'success' }),
      status: 200,
      statusText: 'OK',
      cached: false,
    };
    vi.mocked(fetchWithCache).mockResolvedValueOnce(mockResponse);

    await provider.callApi('test prompt', {
      prompt: { raw: 'test prompt', label: 'test' },
      vars: { var: 'test' },
    });

    // Should use the fallback mechanism to append query parameters
    expect(fetchWithCache).toHaveBeenCalledWith(
      'relative/path/test?param=value',
      expect.any(Object),
      expect.any(Number),
      'text',
      undefined,
      undefined,
    );
  });
});
