import {
  CreateHttpClientOptions,
  HttpResponse,
  JsonApiDocument,
  JsonApiErrorObject
} from '../types';

export class JsonApiHttpError extends Error {
  status: number;
  body: unknown;
  errors: JsonApiErrorObject[];

  constructor(message: string, status: number, body: unknown, errors: JsonApiErrorObject[] = []) {
    super(message);
    this.name = 'JsonApiHttpError';
    this.status = status;
    this.body = body;
    this.errors = errors;
  }
}

function hasJsonApiErrors(payload: unknown): payload is { errors: JsonApiErrorObject[] } {
  return (
    !!payload
    && typeof payload === 'object'
    && Array.isArray((payload as { errors?: unknown }).errors)
  );
}

function pickErrorMessage(
  status: number,
  statusText: string,
  errors: JsonApiErrorObject[]
): string {
  const first = errors[0];
  return (
    first?.title
    ?? first?.detail
    ?? `HTTP ${status}${statusText ? ` ${statusText}` : ''}`
  );
}

export function createHttpClient(options: CreateHttpClientOptions) {
  const logger = options.logger;

  async function requestJson<T = JsonApiDocument>(
    url: string,
    init?: RequestInit
  ): Promise<HttpResponse<T>> {
    const authHeaders = (await options.getAuthHeaders?.()) ?? {};
    const baseHeaders: Record<string, string> = {
      Accept: 'application/vnd.api+json',
      ...authHeaders
    };

    const hasBody = Boolean(init?.body);
    if (hasBody) {
      baseHeaders['Content-Type'] = 'application/vnd.api+json';
    }

    const response = await options.fetch(url, {
      ...init,
      headers: {
        ...baseHeaders,
        ...(init?.headers ?? {})
      }
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        logger?.warn?.('requestJson: failed to parse response JSON', { url, error });
        payload = text;
      }
    }

    if (!response.ok) {
      if (hasJsonApiErrors(payload)) {
        const msg = pickErrorMessage(response.status, response.statusText, payload.errors);
        throw new JsonApiHttpError(msg, response.status, payload, payload.errors);
      }

      const fallback =
        typeof payload === 'object' && payload && 'message' in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).message)
          : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

      throw new JsonApiHttpError(fallback, response.status, payload);
    }

    return {
      status: response.status,
      headers: response.headers,
      json: payload as T
    };
  }

  return {
    requestJson
  };
}
