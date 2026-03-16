import { ExecuteParams } from '../react-admin/executeTypes';

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: unknown
): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item));

    if (normalized.length > 0) {
      params.set(key, normalized.join(','));
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendQueryValue(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  params.set(key, String(value));
}

export function buildExecuteSearchParams(params: ExecuteParams): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params.query ?? {})) {
    appendQueryValue(searchParams, key, value);
  }

  const method = (params.method ?? 'POST').toUpperCase();
  if (method === 'GET') {
    for (const [key, value] of Object.entries(params.args ?? {})) {
      appendQueryValue(searchParams, key, value);
    }
  }

  return searchParams;
}

export function buildExecuteUrl(
  apiUrl: string,
  resource: string,
  params: ExecuteParams
): string {
  const apiBase = apiUrl.replace(/\/+$/g, '');
  const resourcePath = trimSlashes(resource);
  const action = encodeURIComponent(params.action);
  const idPath =
    params.id === undefined || params.id === null
      ? ''
      : `/${encodeURIComponent(String(params.id))}`;
  const base = `${apiBase}/${resourcePath}`;
  const url = `${base}${idPath}/${action}`;
  const searchParams = buildExecuteSearchParams(params);
  const queryString = searchParams.toString();

  return queryString ? `${url}?${queryString}` : url;
}
