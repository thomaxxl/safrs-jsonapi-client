#!/usr/bin/env node
import { getDefaultFetch } from '../config/runtime';
import { normalizeAdminYaml } from '../schema/normalizeAdminYaml';
import { loadAdminYamlFromFile, loadAdminYamlFromUrl } from '../schema/loadAdminYaml';
import { resolveApiRoot } from '../schema/resolveApiRoot';
import { buildListQuery, buildOneQuery, queryToSearchParams } from '../query/buildQuery';
import { createHttpClient } from '../transport/http';
import { JsonApiDocument } from '../types';
import { getTotal } from '../normalize/getTotal';

interface CliArgs {
  adminYamlUrl?: string;
  adminYamlFile?: string;
  adminYaml?: string;
  apiRoot?: string;
  apiUrl?: string;
  resource?: string;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: 1
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--admin-yaml-url' && next) {
      args.adminYamlUrl = next;
      i += 1;
      continue;
    }

    if (token === '--admin-yaml-file' && next) {
      args.adminYamlFile = next;
      i += 1;
      continue;
    }

    if (token === '--admin-yaml' && next) {
      args.adminYaml = next;
      i += 1;
      continue;
    }

    if (token === '--api-root' && next) {
      args.apiRoot = next;
      i += 1;
      continue;
    }

    if (token === '--api-url' && next) {
      args.apiUrl = next;
      i += 1;
      continue;
    }

    if (token === '--resource' && next) {
      args.resource = next;
      i += 1;
      continue;
    }

    if (token === '--limit' && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
  }

  return args;
}

function printUsage(): void {
  // Keep usage short for CI logs.
  console.log(
    'Usage: safrs-jsonapi-smoke --admin-yaml <path-or-url> | --admin-yaml-url <url> | --admin-yaml-file <path> [--api-url <url> | --api-root <url>] [--resource <ResourceName>] [--limit 1]'
  );
}

function resolveRequestUrl(url: string, base: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return new URL(url, base).toString();
  }
}

function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.adminYaml && !args.adminYamlUrl && !args.adminYamlFile) {
    printUsage();
    throw new Error('Missing admin.yaml input. Provide --admin-yaml (path-or-url), --admin-yaml-url, or --admin-yaml-file.');
  }

  const fetchImpl = getDefaultFetch();

  let rawYaml: unknown;
  if (args.adminYamlFile) {
    rawYaml = await loadAdminYamlFromFile(args.adminYamlFile);
  } else if (args.adminYamlUrl) {
    rawYaml = await loadAdminYamlFromUrl(args.adminYamlUrl, fetchImpl);
  } else if (args.adminYaml) {
    if (/^https?:\/\//i.test(args.adminYaml)) {
      rawYaml = await loadAdminYamlFromUrl(args.adminYaml, fetchImpl);
    } else {
      rawYaml = await loadAdminYamlFromFile(args.adminYaml);
    }
  } else {
    throw new Error('Missing admin.yaml input.');
  }

  const schema = normalizeAdminYaml(rawYaml);
  const explicitApiRoot = args.apiUrl ?? args.apiRoot;
  const apiRoot = resolveApiRoot(schema, {
    apiRoot: explicitApiRoot,
    cliDefaultApiRoot: explicitApiRoot
  });
  if (!isAbsoluteHttpUrl(apiRoot)) {
    throw new Error(
      `Resolved apiRoot '${apiRoot}' is not absolute. Pass --api-url explicitly in CLI mode.`
    );
  }

  const resource =
    args.resource
    ?? Object.keys(schema.resources)[0];

  if (!resource) {
    throw new Error('No resources found in admin.yaml');
  }

  if (!schema.resources[resource]) {
    throw new Error(`Unknown resource '${resource}' in admin.yaml`);
  }

  const http = createHttpClient({ fetch: fetchImpl, logger: console });

  const listQuery = buildListQuery(
    resource,
    {
      pagination: { page: 1, perPage: args.limit }
    },
    schema,
    {
      defaultPerPage: args.limit
    }
  );

  const listUrl = `${apiRoot}${resource}?${queryToSearchParams(listQuery).toString()}`;
  const listResp = await http.requestJson<JsonApiDocument>(listUrl);
  const listData = Array.isArray(listResp.json.data)
    ? listResp.json.data
    : listResp.json.data
      ? [listResp.json.data]
      : [];

  console.log(`PASS list resource=${resource} items=${listData.length} total=${getTotal(listResp.json)}`);

  const first = listData[0];
  if (!first) {
    console.log('PASS getOne skipped (no rows returned)');
    console.log('PASS relationship skipped (no rows returned)');
    return;
  }

  const oneQuery = buildOneQuery(
    resource,
    {
      id: first.id
    },
    schema
  );

  const oneUrl = `${apiRoot}${resource}/${encodeURIComponent(String(first.id))}?${queryToSearchParams(oneQuery).toString()}`;
  const oneResp = await http.requestJson<JsonApiDocument>(oneUrl);
  const oneData = Array.isArray(oneResp.json.data) ? oneResp.json.data[0] : oneResp.json.data;

  console.log(`PASS getOne id=${oneData?.id ?? first.id}`);

  const schemaRelationships = schema.resources[resource]?.relationships ?? [];
  if (schemaRelationships.length === 0) {
    console.log('PASS relationship skipped (resource has no relationships in schema)');
    return;
  }

  const preferred = schemaRelationships.find((rel) => rel.direction === 'toone') ?? schemaRelationships[0];
  const relationshipName = preferred.name;
  const relationshipValue =
    (oneData?.relationships as Record<string, unknown> | undefined)?.[relationshipName];
  const relObj = (relationshipValue ?? {}) as { links?: { related?: string; self?: string } };
  const fallbackEndpoint = `${apiRoot}${resource}/${encodeURIComponent(String(first.id))}/${encodeURIComponent(relationshipName)}`;
  const relationshipUrl = relObj.links?.related ?? relObj.links?.self ?? fallbackEndpoint;

  const resolvedRelationshipUrl = resolveRequestUrl(relationshipUrl, fallbackEndpoint);
  const relResp = await http.requestJson<JsonApiDocument>(resolvedRelationshipUrl);
  const relData = Array.isArray(relResp.json.data)
    ? relResp.json.data.length
    : relResp.json.data
      ? 1
      : 0;

  console.log(`PASS relationship ${relationshipName} items=${relData}`);
}

main().catch((error) => {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) {
      console.error('Smoke runner failed:', error.message, 'cause:', cause);
    } else {
      console.error('Smoke runner failed:', error.message);
    }
  } else {
    console.error('Smoke runner failed:', error);
  }
  process.exitCode = 1;
});
