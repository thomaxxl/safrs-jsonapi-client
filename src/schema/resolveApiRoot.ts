import { ResolveApiRootOptions, Schema } from '../types';

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function hasPlaceholder(value: string): boolean {
  return /\{[^}]+\}/.test(value);
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizePort(port?: string): string {
  if (!port || port === '80' || port === '443') {
    return '';
  }
  return port;
}

function resolvePlaceholders(
  apiRoot: string,
  options?: ResolveApiRootOptions
): string | undefined {
  const protocol = options?.location?.protocol?.replace(':', '');
  const hostname = options?.location?.hostname;

  if (!protocol || !hostname) {
    return undefined;
  }

  const port = normalizePort(options?.location?.port);
  const apiPath = (options?.apiPathFallback ?? '/api/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const replacementMap: Record<string, string> = {
    '{http_type}': protocol,
    '{swagger_host}': hostname,
    '{port}': port,
    '{api}': apiPath
  };

  let resolved = apiRoot;
  resolved = resolved.replace(
    ':{port}',
    port ? `:${port}` : ''
  );
  for (const [placeholder, replacement] of Object.entries(replacementMap)) {
    resolved = resolved.split(placeholder).join(replacement);
  }

  return resolved;
}

function resolveRelativePathApiRoot(
  pathApiRoot: string,
  options?: ResolveApiRootOptions
): string | undefined {
  const origin = options?.location?.origin;
  if (!origin) {
    return undefined;
  }

  const normalizedOrigin = trimSlash(origin);
  const normalizedPath = pathApiRoot.replace(/^\/+/, '');
  return ensureTrailingSlash(`${normalizedOrigin}/${normalizedPath}`);
}

function browserFallback(options?: ResolveApiRootOptions): string | undefined {
  const origin = options?.location?.origin;
  if (!origin) {
    return undefined;
  }

  const apiPath = (options?.apiPathFallback ?? '/api/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  return ensureTrailingSlash(`${trimSlash(origin)}/${apiPath}`);
}

export function resolveApiRoot(
  schemaOrRawYaml: Schema | { api_root?: string } | undefined,
  options?: ResolveApiRootOptions
): string {
  if (options?.apiRoot) {
    return ensureTrailingSlash(options.apiRoot);
  }

  const candidate = (schemaOrRawYaml as Schema | undefined)?.apiRoot
    ?? (schemaOrRawYaml as { api_root?: string } | undefined)?.api_root;

  if (candidate) {
    if (isAbsoluteUrl(candidate) && !hasPlaceholder(candidate)) {
      return ensureTrailingSlash(candidate);
    }

    if (hasPlaceholder(candidate)) {
      const resolved = resolvePlaceholders(candidate, options);
      if (resolved && isAbsoluteUrl(resolved)) {
        return ensureTrailingSlash(resolved);
      }
    }

    const fromRelativePath = resolveRelativePathApiRoot(candidate, options);
    if (fromRelativePath) {
      return fromRelativePath;
    }
  }

  if (options?.cliDefaultApiRoot) {
    return ensureTrailingSlash(options.cliDefaultApiRoot);
  }

  const fallback = browserFallback(options);
  if (fallback) {
    return fallback;
  }

  throw new Error(
    'Unable to resolve api_root. Provide --api-url/--api-root (CLI) or options.apiRoot (runtime).'
  );
}
