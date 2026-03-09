import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { FetchLike } from '../types';

export async function loadAdminYamlFromUrl(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'text/yaml, text/x-yaml, application/x-yaml, text/plain, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load admin.yaml from URL ${url}: ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  return parse(raw);
}

export async function loadAdminYamlFromFile(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  return parse(raw);
}
