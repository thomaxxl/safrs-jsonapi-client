#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import fetch from 'cross-fetch';

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    resource: 'Order',
    id: '',
    include: 'Customer,Employee',
    outDir: 'fixtures/responses'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--baseUrl' && next) {
      args.baseUrl = next;
      i += 1;
      continue;
    }
    if (token === '--resource' && next) {
      args.resource = next;
      i += 1;
      continue;
    }
    if (token === '--id' && next) {
      args.id = next;
      i += 1;
      continue;
    }
    if (token === '--include' && next) {
      args.include = next;
      i += 1;
      continue;
    }
    if (token === '--outDir' && next) {
      args.outDir = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/vnd.api+json'
    }
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
  }

  return await resp.json();
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    throw new Error('Missing --baseUrl (example: http://localhost:8000/api/)');
  }

  const baseUrl = ensureTrailingSlash(args.baseUrl);
  const outDir = resolve(args.outDir);
  const resource = args.resource;

  const listUrl = `${baseUrl}${resource}?page[offset]=0&page[limit]=1`;
  const listJson = await fetchJson(listUrl);
  await writeJson(resolve(outDir, `${resource.toLowerCase()}.json`), listJson);

  const includeUrl = `${baseUrl}${resource}?page[offset]=0&page[limit]=1&include=${encodeURIComponent(args.include)}`;
  const includeJson = await fetchJson(includeUrl);
  await writeJson(resolve(outDir, `${resource.toLowerCase()}.flask.01.json`), includeJson);
  await writeJson(resolve(outDir, `${resource.toLowerCase()}.fastapi.01.json`), includeJson);

  const plusAllUrl = `${baseUrl}${resource}?page[offset]=0&page[limit]=1&include=${encodeURIComponent('+all')}`;
  try {
    const plusAllJson = await fetchJson(plusAllUrl);
    await writeJson(resolve(outDir, `${resource.toLowerCase()}.all.json`), plusAllJson);
  } catch (error) {
    console.warn('Skipping include=+all fixture:', error instanceof Error ? error.message : error);
  }

  if (args.id) {
    const oneUrl = `${baseUrl}${resource}/${encodeURIComponent(args.id)}?include=${encodeURIComponent(args.include)}`;
    const oneJson = await fetchJson(oneUrl);
    await writeJson(resolve(outDir, `${resource.toLowerCase()}.one.json`), oneJson);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
