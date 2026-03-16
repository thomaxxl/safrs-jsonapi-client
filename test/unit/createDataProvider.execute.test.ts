import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { normalizeAdminYaml } from '../../src/schema/normalizeAdminYaml';
import { createDataProviderSync } from '../../src/react-admin/createDataProvider';
import { JsonApiHttpError } from '../../src/transport/http';

function createResponse(
  body: BodyInit | null,
  init: ResponseInit = {}
): Response {
  return new Response(body, init);
}

function createJsonResponse(
  payload: unknown,
  status = 200,
  contentType = 'application/vnd.api+json'
): Response {
  return createResponse(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': contentType
    }
  });
}

describe('createDataProvider execute', () => {
  const schema = normalizeAdminYaml(
    parse(readFileSync('test/fixtures/admin.yaml', 'utf8'))
  );

  it('exposes execute() and rpc-wraps args by default', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://api.example.test/api/Order/10248/send_mail');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({
        meta: {
          args: {
            email: 'x@y.test'
          }
        }
      }));

      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toContain('application/vnd.api+json');
      expect(headers.get('content-type')).toBe('application/vnd.api+json');

      return createJsonResponse({
        meta: {
          result: 'queued',
          jobId: 'abc123'
        }
      });
    });

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    expect(dp.supportAbortSignal).toBe(true);

    const result = await dp.execute('Order', {
      id: '10248',
      action: 'send_mail',
      args: {
        email: 'x@y.test'
      }
    });

    expect(result).toEqual({
      data: 'queued',
      meta: {
        result: 'queued',
        jobId: 'abc123'
      }
    });
  });

  it('supports rpc calls with validJsonapi=false', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify({
        status: 'closed'
      }));

      const headers = new Headers(init?.headers);
      expect(headers.get('content-type')).toBe('application/json');

      return createJsonResponse({
        meta: {
          result: true
        }
      });
    });

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    const result = await dp.execute('Order', {
      id: '10248',
      action: 'close',
      method: 'PATCH',
      args: {
        status: 'closed'
      },
      validJsonapi: false
    });

    expect(result).toEqual({
      data: true,
      meta: {
        result: true
      }
    });
  });

  it('normalizes JSON:API resource responses returned from execute()', async () => {
    const fetchMock = jest.fn(async () =>
      createJsonResponse({
        data: {
          id: '10248',
          type: 'Order',
          attributes: {
            ShipName: 'Vins order',
            CustomerId: 'VINET'
          }
        },
        meta: {
          source: 'rpc'
        }
      })
    );

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    const result = await dp.execute('Order', {
      id: '10248',
      action: 'preview',
      method: 'POST'
    });

    expect(result).toEqual({
      data: expect.objectContaining({
        id: '10248',
        ja_type: 'Order',
        ShipName: 'Vins order',
        CustomerId: 'VINET'
      }),
      meta: {
        source: 'rpc'
      }
    });
  });

  it('returns raw mode responses unchanged', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({
        ping: 'pong'
      }));

      const headers = new Headers(init?.headers);
      expect(headers.get('content-type')).toBe('application/json');

      return createJsonResponse(
        {
          ok: true,
          meta: {
            result: 'leave untouched'
          }
        },
        200,
        'application/json'
      );
    });

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    const result = await dp.execute('Order', {
      action: 'raw_echo',
      mode: 'raw',
      body: {
        ping: 'pong'
      }
    });

    expect(result).toEqual({
      data: {
        ok: true,
        meta: {
          result: 'leave untouched'
        }
      }
    });
  });

  it('supports text responses', async () => {
    const fetchMock = jest.fn(async () =>
      createResponse('pong', {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    );

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    const result = await dp.execute('Order', {
      action: 'ping',
      mode: 'raw',
      responseType: 'text'
    });

    expect(result).toEqual({
      data: 'pong'
    });
  });

  it('throws mapped JSON:API errors for execute()', async () => {
    const fetchMock = jest.fn(async () =>
      createJsonResponse(
        {
          errors: [
            {
              title: 'Invalid request'
            }
          ]
        },
        422
      )
    );

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    await expect(
      dp.execute('Order', {
        action: 'broken'
      })
    ).rejects.toBeInstanceOf(JsonApiHttpError);

    await expect(
      dp.execute('Order', {
        action: 'broken'
      })
    ).rejects.toMatchObject({
      message: 'Invalid request',
      status: 422
    });
  });

  it('passes AbortSignal through execute()', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        expect(signal).toBe(controller.signal);

        const rejectAbort = () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        };

        if (signal?.aborted) {
          rejectAbort();
          return;
        }

        signal?.addEventListener('abort', rejectAbort, { once: true });
      })
    );

    const dp = createDataProviderSync({
      schema,
      apiRoot: 'http://api.example.test/api/',
      fetch: fetchMock,
      logger: { warn: jest.fn() }
    });

    const pending = dp.execute('Order', {
      action: 'slow_call',
      signal: controller.signal
    });

    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError'
    });
  });
});
