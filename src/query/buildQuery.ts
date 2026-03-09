import {
  BuildQueryOptions,
  DataProviderListParams,
  DataProviderManyParams,
  DataProviderManyReferenceParams,
  DataProviderOneParams,
  Schema,
  SchemaRelationship
} from '../types';

type QueryValue = string | number | boolean;
export type QueryObject = Record<string, QueryValue>;

function toStringValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function addSort(
  query: QueryObject,
  defaultSort: string | undefined,
  sort?: { field?: string; order?: string }
): void {
  if (sort?.field) {
    const prefix = sort.order?.toUpperCase() === 'DESC' ? '-' : '';
    query.sort = `${prefix}${sort.field}`;
    return;
  }

  if (defaultSort) {
    query.sort = defaultSort;
  }
}

function addFilters(
  query: QueryObject,
  filter: Record<string, unknown> | undefined,
  knownAttributes: string[],
  options?: BuildQueryOptions
): void {
  if (!filter) {
    return;
  }

  const knownKeysLower = new Set(knownAttributes.map((name) => name.toLowerCase()));
  const search = filter.q;
  if (typeof search === 'string' && search.trim()) {
    options?.logger?.warn?.(
      'buildQuery: filter.q is not implemented in the base milestone; ignoring q.'
    );
  }

  for (const [key, value] of Object.entries(filter)) {
    if (key === 'q' || value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      options?.logger?.warn?.(
        `buildQuery: filter key '${key}' has non-scalar value; skipping.`
      );
      continue;
    }

    if (!knownKeysLower.has(key.toLowerCase())) {
      options?.logger?.warn?.(
        `buildQuery: unknown filter key '${key}' for this resource; passing through as-is.`
      );
    }

    query[`filter[${key}]`] = toStringValue(value);
  }
}

function normalizeRequestedIncludes(meta: Record<string, unknown> | undefined): string[] {
  const include = meta?.include;
  if (!include) {
    return [];
  }

  if (typeof include === 'string') {
    return include
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (Array.isArray(include)) {
    return include
      .flatMap((item) =>
        typeof item === 'string'
          ? item.split(',').map((part) => part.trim())
          : []
      )
      .filter(Boolean);
  }

  return [];
}

function findRelationship(
  relationships: SchemaRelationship[],
  name: string
): SchemaRelationship | undefined {
  return relationships.find((rel) => rel.name === name);
}

function buildIncludes(
  mode: 'list' | 'one' | 'many' | 'manyReference',
  relationships: SchemaRelationship[],
  meta: Record<string, unknown> | undefined,
  options?: BuildQueryOptions
): string[] {
  const includeSet = new Set<string>();

  if (mode === 'list' || mode === 'one' || mode === 'manyReference') {
    relationships
      .filter((rel) => rel.direction === 'toone' && rel.disableAutoload !== true)
      .forEach((rel) => includeSet.add(rel.name));
  }

  const requestedIncludes = normalizeRequestedIncludes(meta);
  for (const includeName of requestedIncludes) {
    if (includeName === '+all') {
      for (const rel of relationships) {
        if (
          rel.direction === 'tomany'
          && !options?.include?.allowTomanyFromPlusAll
        ) {
          continue;
        }
        includeSet.add(rel.name);
      }
      continue;
    }

    const relationship = findRelationship(relationships, includeName);
    if (!relationship) {
      options?.logger?.warn?.(
        `buildQuery: unknown include '${includeName}' requested; passing through as-is.`
      );
      includeSet.add(includeName);
      continue;
    }

    includeSet.add(relationship.name);
  }

  return Array.from(includeSet);
}

function addFields(
  query: QueryObject,
  resourceType: string,
  meta: Record<string, unknown> | undefined
): void {
  const fields = meta?.fields;
  if (!fields) {
    return;
  }

  if (Array.isArray(fields)) {
    const normalized = fields.filter((field): field is string => typeof field === 'string');
    if (normalized.length > 0) {
      query[`fields[${resourceType}]`] = normalized.join(',');
    }
    return;
  }

  if (typeof fields === 'string') {
    query[`fields[${resourceType}]`] = fields;
    return;
  }

  if (typeof fields === 'object') {
    const dict = fields as Record<string, unknown>;
    for (const [type, value] of Object.entries(dict)) {
      if (typeof value === 'string') {
        query[`fields[${type}]`] = value;
      } else if (Array.isArray(value)) {
        const normalized = value.filter((item): item is string => typeof item === 'string');
        if (normalized.length > 0) {
          query[`fields[${type}]`] = normalized.join(',');
        }
      }
    }
  }
}

export function queryToSearchParams(query: QueryObject): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  return params;
}

export function buildListQuery(
  resource: string,
  raParams: DataProviderListParams | undefined,
  schema: Schema,
  options?: BuildQueryOptions
): QueryObject {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  const page = raParams?.pagination?.page ?? 1;
  const perPage = raParams?.pagination?.perPage ?? options?.defaultPerPage ?? 10;

  const query: QueryObject = {
    'page[offset]': Math.max((page - 1) * perPage, 0),
    'page[limit]': perPage
  };

  addFilters(query, raParams?.filter, resourceSchema.attributes, options);
  addSort(query, resourceSchema.sort, raParams?.sort);

  const includes = buildIncludes('list', resourceSchema.relationships, raParams?.meta, options);
  if (includes.length > 0) {
    query.include = includes.join(',');
  }

  addFields(query, resourceSchema.type, raParams?.meta);
  return query;
}

export function buildOneQuery(
  resource: string,
  raParams: DataProviderOneParams | undefined,
  schema: Schema,
  options?: BuildQueryOptions
): QueryObject {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  const query: QueryObject = {};
  const includes = buildIncludes('one', resourceSchema.relationships, raParams?.meta, options);
  if (includes.length > 0) {
    query.include = includes.join(',');
  }
  addFields(query, resourceSchema.type, raParams?.meta);

  return query;
}

export function buildManyQuery(
  resource: string,
  raParams: DataProviderManyParams,
  schema: Schema,
  options?: BuildQueryOptions
): QueryObject {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  const query: QueryObject = {
    'filter[id]': raParams.ids.map((id) => String(id)).join(',')
  };

  const includes = buildIncludes('many', resourceSchema.relationships, raParams.meta, options);
  if (includes.length > 0) {
    query.include = includes.join(',');
  }

  return query;
}

function getResourceAttributeValue(
  attrs: Record<string, unknown>,
  key: string
): unknown {
  if (key in attrs) {
    return attrs[key];
  }

  const lowered = key.toLowerCase();
  const hit = Object.keys(attrs).find((name) => name.toLowerCase() === lowered);
  return hit ? attrs[hit] : undefined;
}

export function buildManyReferenceQuery(
  resource: string,
  raParams: DataProviderManyReferenceParams,
  schema: Schema,
  options?: BuildQueryOptions
): QueryObject {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  const delimiter = options?.delimiter ?? schema.delimiter;
  const target = raParams.target;
  const attributes = schema.attributeNameSet[resource] ?? new Set<string>();
  const compositeMap = schema.compositeTargets[resource] ?? new Map<string, string[]>();

  let fks: string[];
  if (attributes.has(target)) {
    fks = [target];
  } else if (compositeMap.has(target)) {
    fks = compositeMap.get(target) ?? [target];
  } else {
    options?.logger?.warn?.(
      `buildManyReferenceQuery: target '${target}' was not found in attributes/composites for resource '${resource}'. Treating as single FK.`
    );
    fks = [target];
  }

  const page = raParams.pagination?.page ?? 1;
  const perPage = raParams.pagination?.perPage ?? options?.defaultPerPage ?? 10;

  const query: QueryObject = {
    'page[offset]': Math.max((page - 1) * perPage, 0),
    'page[limit]': perPage
  };

  const parentId = String(raParams.id);
  const idParts = fks.length > 1 ? parentId.split(delimiter) : [parentId];

  if (fks.length > 1 && idParts.length !== fks.length) {
    options?.logger?.warn?.(
      `buildManyReferenceQuery: composite id '${parentId}' does not match FK count ${fks.length}. Falling back to single filter.`
    );
    query[`filter[${target}]`] = parentId;
  } else {
    fks.forEach((fk, index) => {
      query[`filter[${fk}]`] = idParts[index] ?? '';
    });
  }

  addFilters(query, raParams.filter, resourceSchema.attributes, options);
  addSort(query, resourceSchema.sort, raParams.sort);

  const includes = buildIncludes('manyReference', resourceSchema.relationships, raParams.meta, options);
  if (includes.length > 0) {
    query.include = includes.join(',');
  }

  return query;
}

export function resolveRecordAttribute(
  attrs: Record<string, unknown>,
  key: string
): string | undefined {
  const value = getResourceAttributeValue(attrs, key);
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}
