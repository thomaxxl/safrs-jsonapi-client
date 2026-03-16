import {
  CreateHttpClientOptions,
  HttpDecodedResponse,
  HttpRequestOptions,
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

function parseJsonPayload(
  text: string,
  url: string,
  logger?: CreateHttpClientOptions['logger']
): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    logger?.warn?.('request: failed to parse response JSON', { url, error });
    return text;
  }
}

export function createHttpClient(options: CreateHttpClientOptions) {
  const logger = options.logger;

  async function request<T = unknown>(
    url: string,
    init: HttpRequestOptions = {}
  ): Promise<HttpDecodedResponse<T>> {
    const authHeaders = (await options.getAuthHeaders?.()) ?? {};
    const {
      responseType = 'json',
      accept,
      contentType,
      ...fetchInit
    } = init;
    const baseHeaders: Record<string, string> = {
      Accept: accept ?? 'application/vnd.api+json',
      ...authHeaders
    };

    const hasBody = fetchInit.body !== undefined && fetchInit.body !== null;
    if (hasBody && contentType) {
      baseHeaders['Content-Type'] = contentType;
    }

    const response = await options.fetch(url, {
      ...fetchInit,
      headers: {
        ...baseHeaders,
        ...(fetchInit.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = parseJsonPayload(text, url, logger);

      if (hasJsonApiErrors(payload)) {
        const msg = pickErrorMessage(response.status, response.statusText, payload.errors);
        throw new JsonApiHttpError(msg, response.status, payload, payload.errors);
      }

      const fallback =
        typeof payload === 'object' && payload && 'message' in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).message)
          : typeof payload === 'string' && payload.trim().length > 0
            ? payload
            : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

      throw new JsonApiHttpError(fallback, response.status, payload);
    }

    let data: unknown;
    if (responseType === 'text') {
      data = await response.text();
    } else if (responseType === 'blob') {
      data = await response.blob();
    } else {
      const text = await response.text();
      data = parseJsonPayload(text, url, logger);
      if (hasJsonApiErrors(data)) {
        const msg = pickErrorMessage(response.status, response.statusText, data.errors);
        throw new JsonApiHttpError(msg, response.status, data, data.errors);
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      data: data as T
    };
  }

  async function requestJson<T = JsonApiDocument>(
    url: string,
    init?: RequestInit
  ): Promise<HttpResponse<T>> {
    const hasBody = init?.body !== undefined && init.body !== null;
    const response = await request<T>(url, {
      ...init,
      responseType: 'json',
      accept: 'application/vnd.api+json',
      contentType: hasBody ? 'application/vnd.api+json' : undefined
    });

    return {
      status: response.status,
      headers: response.headers,
      json: response.data
    };
  }

  return {
    request,
    requestJson
  };
}
