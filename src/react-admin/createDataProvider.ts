import {
  CreateDataProviderOptions,
  DataProviderListParams,
  JsonApiDocument,
  RecordData,
  Schema
} from '../types';
import {
  buildListQuery,
  buildManyQuery,
  buildManyReferenceQuery,
  buildOneQuery,
  queryToSearchParams
} from '../query/buildQuery';
import { buildExecuteUrl } from '../query/buildExecuteUrl';
import { getDefaultFetch, getBrowserLocation } from '../config/runtime';
import { createHttpClient } from '../transport/http';
import { normalizeAdminYaml } from '../schema/normalizeAdminYaml';
import { loadAdminYamlFromUrl } from '../schema/loadAdminYaml';
import { resolveApiRoot } from '../schema/resolveApiRoot';
import { normalizeDocument } from '../normalize/normalizeDocument';
import { getTotal } from '../normalize/getTotal';
import { synthesizeCompositeKeys } from '../normalize/synthesizeCompositeKeys';
import { mergeForUpdate, sanitizeAttributes } from '../write/sanitize';
import { ExecuteParams, ExecuteResult, SafrsDataProvider } from './executeTypes';

function appendQuery(url: string, query: Record<string, string | number | boolean>): string {
  const params = queryToSearchParams(query);
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function normalizeIncludeInput(meta: Record<string, unknown> | undefined): string[] {
  const include = meta?.include;
  if (!include) {
    return [];
  }

  if (typeof include === 'string') {
    return include.split(',').map((part) => part.trim()).filter(Boolean);
  }

  if (Array.isArray(include)) {
    return include
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
}

function metaIncludeExplicitlyEmpty(meta: Record<string, unknown> | undefined): boolean {
  return Array.isArray(meta?.include) && meta?.include.length === 0;
}

function buildEffectiveIncludes(
  schema: Schema,
  resource: string,
  op: 'list' | 'one' | 'manyReference',
  meta: Record<string, unknown> | undefined,
  allowTomanyFromPlusAll: boolean | undefined
): Set<string> {
  if (metaIncludeExplicitlyEmpty(meta)) {
    return new Set<string>();
  }

  const relationships = schema.resources[resource]?.relationships ?? [];
  const includes = new Set<string>();

  if (op === 'list' || op === 'one' || op === 'manyReference') {
    for (const rel of relationships) {
      if (rel.direction === 'toone' && rel.disableAutoload !== true) {
        includes.add(rel.name);
      }
    }
  }

  const requested = normalizeIncludeInput(meta);
  for (const includeName of requested) {
    if (includeName === '+all') {
      for (const rel of relationships) {
        if (rel.direction === 'tomany' && !allowTomanyFromPlusAll) {
          continue;
        }
        includes.add(rel.name);
      }
      continue;
    }
    includes.add(includeName);
  }

  return includes;
}

function shouldHydrateTomany(
  schema: Schema,
  resource: string,
  meta: Record<string, unknown> | undefined,
  allowTomanyFromPlusAll: boolean | undefined
): boolean {
  const includes = Array.from(
    buildEffectiveIncludes(
      schema,
      resource,
      'list',
      meta,
      allowTomanyFromPlusAll
    )
  );
  const relationships = schema.resources[resource]?.relationships ?? [];
  const tomanyNames = new Set(
    relationships
      .filter((rel) => rel.direction === 'tomany')
      .map((rel) => rel.name)
  );

  return includes.some((name) => tomanyNames.has(name));
}

function ensureSchema(options: CreateDataProviderOptions): Schema {
  if (!options.schema) {
    throw new Error('createDataProviderSync requires options.schema. Use createDataProvider() for URL-based loading.');
  }
  return options.schema;
}

async function loadSchemaIfNeeded(options: CreateDataProviderOptions): Promise<Schema> {
  if (options.schema) {
    return options.schema;
  }

  const fetchImpl = options.fetch ?? getDefaultFetch();
  const adminYamlUrl = options.adminYamlUrl ?? '/ui/admin/admin.yaml';
  const rawYaml = await loadAdminYamlFromUrl(adminYamlUrl, fetchImpl);
  return normalizeAdminYaml(rawYaml, { delimiter: options.delimiter });
}

function normalizeWriteResponse(
  doc: JsonApiDocument,
  schema: Schema,
  resource: string,
  delimiter: string,
  includeTomany: boolean,
  logger: CreateDataProviderOptions['logger']
): RecordData {
  const normalized = normalizeDocument(doc, {
    schema,
    resourceEndpoint: resource,
    includeTomany,
    delimiter,
    logger
  });

  const record = normalized.records[0];
  if (!record) {
    return { id: (doc.data as { id?: string })?.id ?? '' };
  }

  return synthesizeCompositeKeys(record, resource, schema, delimiter);
}

function hasPrimaryData(
  value: JsonApiDocument | Record<string, unknown> | null
): value is JsonApiDocument {
  return !!value && typeof value === 'object' && 'data' in value;
}

function hasJsonApiDocumentShape(
  value: unknown
): value is { data?: unknown; errors?: unknown; meta?: Record<string, unknown> } {
  return !!value && typeof value === 'object' && ('data' in value || 'errors' in value);
}

function hasMetaResult(
  value: unknown
): value is { meta: Record<string, unknown> & { result: unknown } } {
  return (
    !!value
    && typeof value === 'object'
    && 'meta' in value
    && !!(value as { meta?: unknown }).meta
    && typeof (value as { meta: unknown }).meta === 'object'
    && 'result' in ((value as { meta: Record<string, unknown> }).meta)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeRawBody(
  payload: unknown
): { body?: BodyInit; contentType?: string } {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (
    typeof payload === 'string'
    || payload instanceof Blob
    || payload instanceof FormData
    || payload instanceof URLSearchParams
    || payload instanceof ArrayBuffer
    || ArrayBuffer.isView(payload)
  ) {
    return {
      body: payload as BodyInit,
      contentType:
        payload instanceof Blob && payload.type
          ? payload.type
          : payload instanceof FormData
            ? undefined
            : 'application/json'
    };
  }

  if (isPlainObject(payload) || Array.isArray(payload) || typeof payload !== 'object') {
    return {
      body: JSON.stringify(payload),
      contentType: 'application/json'
    };
  }

  return {
    body: payload as BodyInit
  };
}

function createAdapter(
  schema: Schema,
  options: CreateDataProviderOptions
): SafrsDataProvider {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const logger = options.logger ?? console;
  const delimiter = options.delimiter ?? schema.delimiter;
  const totalKeys = options.totalKeys ?? ['count', 'total'];

  const location = getBrowserLocation();
  const apiRoot = resolveApiRoot(schema, {
    apiRoot: options.apiRoot,
    location
  });

  const http = createHttpClient({
    fetch: fetchImpl,
    getAuthHeaders: options.getAuthHeaders,
    logger
  });

  async function normalizeCollection(
    resource: string,
    doc: JsonApiDocument,
    params?: DataProviderListParams
  ): Promise<{ data: RecordData[]; total: number }> {
    const includeTomany = shouldHydrateTomany(
      schema,
      resource,
      params?.meta,
      options.include?.allowTomanyFromPlusAll
    );

    const normalized = normalizeDocument(doc, {
      schema,
      resourceEndpoint: resource,
      includeTomany,
      delimiter,
      logger
    });

    const data = normalized.records.map((record) =>
      synthesizeCompositeKeys(record, resource, schema, delimiter)
    );

    const withAutoload = await autoloadToOneRelationships(
      resource,
      data,
      'list',
      params?.meta,
      params?.signal
    );

    return {
      data: withAutoload,
      total: getTotal(doc, { keys: totalKeys })
    };
  }

  function inlineWithAlias(
    record: RecordData,
    relationshipName: string,
    value: RecordData
  ): void {
    if (!Object.prototype.hasOwnProperty.call(record, relationshipName)) {
      record[relationshipName] = value;
      return;
    }

    const base = `rel_${relationshipName}`;
    if (!Object.prototype.hasOwnProperty.call(record, base)) {
      logger.warn?.(
        `Relationship '${relationshipName}' collides with an existing field; inlined under '${base}'.`
      );
      record[base] = value;
      return;
    }

    let index = 1;
    while (Object.prototype.hasOwnProperty.call(record, `${base}_${index}`)) {
      index += 1;
    }
    const alias = `${base}_${index}`;
    logger.warn?.(
      `Relationship '${relationshipName}' collides with an existing field; inlined under '${alias}'.`
    );
    record[alias] = value;
  }

  function relationAlreadyInlined(record: RecordData, relationshipName: string): boolean {
    if (Object.prototype.hasOwnProperty.call(record, relationshipName)) {
      const value = record[relationshipName];
      return value !== undefined;
    }

    if (Object.prototype.hasOwnProperty.call(record, `rel_${relationshipName}`)) {
      return true;
    }

    return false;
  }

  function resolveDelimiterForRelationship(resource: string, relationshipName: string): string {
    const relationship = schema.relationshipsByName[resource]?.[relationshipName];
    if (relationship?.compositeDelimiter) {
      return relationship.compositeDelimiter;
    }
    const resourceDelimiter = schema.resources[resource]?.compositeDelimiter;
    if (resourceDelimiter) {
      return resourceDelimiter;
    }
    return delimiter;
  }

  function resolveRelatedId(
    record: RecordData,
    resource: string,
    relationshipName: string
  ): string | undefined {
    const relationship = schema.relationshipsByName[resource]?.[relationshipName];
    if (!relationship || relationship.fks.length === 0) {
      return undefined;
    }

    const values = relationship.fks.map((fk) => {
      const direct = record[fk];
      if (direct !== undefined && direct !== null) {
        return String(direct);
      }
      const attributes = record.attributes as Record<string, unknown> | undefined;
      const attrValue = attributes?.[fk];
      if (attrValue !== undefined && attrValue !== null) {
        return String(attrValue);
      }
      return undefined;
    });

    if (values.some((value) => value === undefined)) {
      return undefined;
    }

    if (values.length === 1) {
      return values[0];
    }

    const relationDelimiter = resolveDelimiterForRelationship(resource, relationshipName);
    return (values as string[]).join(relationDelimiter);
  }

  async function autoloadToOneRelationships(
    resource: string,
    records: RecordData[],
    op: 'list' | 'one' | 'manyReference',
    meta: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ): Promise<RecordData[]> {
    if (records.length === 0) {
      return records;
    }

    const includeSet = buildEffectiveIncludes(
      schema,
      resource,
      op,
      meta,
      options.include?.allowTomanyFromPlusAll
    );

    if (includeSet.size === 0) {
      return records;
    }

    const toOneRelationships = (schema.resources[resource]?.relationships ?? [])
      .filter((rel) => rel.direction === 'toone' && includeSet.has(rel.name));

    for (const relationship of toOneRelationships) {
      const missingPairs: Array<{ record: RecordData; relatedId: string }> = [];

      for (const record of records) {
        if (relationAlreadyInlined(record, relationship.name)) {
          continue;
        }

        const relatedId = resolveRelatedId(record, resource, relationship.name);
        if (!relatedId) {
          continue;
        }

        missingPairs.push({ record, relatedId });
      }

      if (missingPairs.length === 0) {
        continue;
      }

      const uniqueIds = Array.from(new Set(missingPairs.map((pair) => pair.relatedId)));
      const targetResource = relationship.targetResource;
      const targetType = schema.resources[targetResource]?.type ?? targetResource;

      if (!schema.resources[targetResource]) {
        logger.warn?.(
          `autoloadToOneRelationships: unknown target resource '${targetResource}' for relationship '${relationship.name}'.`
        );
        for (const pair of missingPairs) {
          inlineWithAlias(pair.record, relationship.name, {
            id: pair.relatedId,
            ja_type: targetType
          });
        }
        continue;
      }

      const query = buildManyQuery(
        targetResource,
        { ids: uniqueIds },
        schema,
        {
          delimiter,
          include: options.include,
          logger
        }
      );
      const url = appendQuery(`${apiRoot}${targetResource}`, query);

      let relatedById: Map<string, RecordData> = new Map();
      try {
        const { json } = await http.requestJson<JsonApiDocument>(url, {
          signal
        });
        const normalized = normalizeDocument(json, {
          schema,
          resourceEndpoint: targetResource,
          includeTomany: false,
          delimiter,
          logger
        });
        relatedById = new Map(
          normalized.records.map((item) => [
            String(item.id),
            synthesizeCompositeKeys(item, targetResource, schema, delimiter)
          ])
        );
      } catch (error) {
        logger.warn?.(
          `autoloadToOneRelationships: failed to fetch '${targetResource}' for relationship '${relationship.name}'. Using stubs.`,
          error
        );
      }

      for (const pair of missingPairs) {
        const found = relatedById.get(pair.relatedId) ?? {
          id: pair.relatedId,
          ja_type: targetType
        };
        inlineWithAlias(pair.record, relationship.name, found);
      }
    }

    return records;
  }

  async function performUpdate(
    resource: string,
    params: {
      id: string | number;
      data: Record<string, unknown>;
      previousData?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      signal?: AbortSignal;
    }
  ): Promise<{ data: RecordData }> {
    const incomingId = params.data.id;
    if (incomingId !== undefined && incomingId !== null && String(incomingId) !== String(params.id)) {
      throw new Error(
        `update(${resource}) id conflict: params.id='${params.id}' does not match params.data.id='${incomingId}'.`
      );
    }

    const merged = mergeForUpdate(params.data, params.previousData);
    const { payload } = sanitizeAttributes(resource, merged, schema, logger, params.id, 'update');
    const id = encodeURIComponent(String(params.id));
    const url = `${apiRoot}${resource}/${id}`;

    const { json } = await http.requestJson<JsonApiDocument>(url, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal: params.signal
    });

    return {
      data: normalizeWriteResponse(
        json,
        schema,
        resource,
        delimiter,
        shouldHydrateTomany(
          schema,
          resource,
          params.meta,
          options.include?.allowTomanyFromPlusAll
        ),
        logger
      )
    };
  }

  async function performDelete(
    resource: string,
    idValue: string | number,
    signal?: AbortSignal
  ): Promise<{ data: RecordData }> {
    const id = encodeURIComponent(String(idValue));
    const url = `${apiRoot}${resource}/${id}`;

    const { json } = await http.requestJson<JsonApiDocument | Record<string, unknown> | null>(url, {
      method: 'DELETE',
      signal
    });
    const deleteResponse = json;

    if (hasPrimaryData(deleteResponse)) {
      return {
        data: normalizeWriteResponse(
          deleteResponse,
          schema,
          resource,
          delimiter,
          false,
          logger
        )
      };
    }

    return {
      data: { id: idValue }
    };
  }

  function normalizeExecuteData(
    decoded: { data?: unknown; meta?: Record<string, unknown> }
  ): RecordData | RecordData[] | null {
    if (!('data' in decoded) || decoded.data === undefined || decoded.data === null) {
      return null;
    }

    const jsonApiDoc = decoded as JsonApiDocument;
    const normalized = normalizeDocument(jsonApiDoc, {
      schema,
      delimiter,
      logger
    });

    const records = normalized.records.map((record) => {
      const resourceType = typeof record.ja_type === 'string' ? record.ja_type : undefined;
      const targetResource = resourceType ? schema.resourceByType[resourceType] : undefined;
      return targetResource
        ? synthesizeCompositeKeys(record, targetResource, schema, delimiter)
        : record;
    });

    if (Array.isArray(decoded.data)) {
      return records;
    }

    return records[0] ?? null;
  }

  return {
    supportAbortSignal: true,
    async getList(resource, params = {}) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      const query = buildListQuery(resource, params, schema, {
        delimiter,
        defaultPerPage: options.defaultPerPage,
        include: options.include,
        logger
      });

      const url = appendQuery(`${apiRoot}${resource}`, query);
      const { json } = await http.requestJson<JsonApiDocument>(url, {
        signal: params.signal
      });
      return normalizeCollection(resource, json, params);
    },

    async getOne(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      const query = buildOneQuery(resource, params, schema, {
        delimiter,
        include: options.include,
        logger
      });

      const id = encodeURIComponent(String(params.id));
      const url = appendQuery(`${apiRoot}${resource}/${id}`, query);
      const { json } = await http.requestJson<JsonApiDocument>(url, {
        signal: params.signal
      });

      const includeTomany = shouldHydrateTomany(
        schema,
        resource,
        params.meta,
        options.include?.allowTomanyFromPlusAll
      );

      const normalized = normalizeDocument(json, {
        schema,
        resourceEndpoint: resource,
        includeTomany,
        delimiter,
        logger
      });

      const record = normalized.records[0];
      if (!record) {
        throw new Error(`Resource '${resource}' with id '${params.id}' not found`);
      }

      const [withAutoload] = await autoloadToOneRelationships(
        resource,
        [record],
        'one',
        params.meta,
        params.signal
      );

      return {
        data: synthesizeCompositeKeys(withAutoload, resource, schema, delimiter)
      };
    },

    async getMany(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      const query = buildManyQuery(resource, params, schema, {
        delimiter,
        include: options.include,
        logger
      });
      const url = appendQuery(`${apiRoot}${resource}`, query);
      const { json } = await http.requestJson<JsonApiDocument>(url, {
        signal: params.signal
      });

      const includeTomany = shouldHydrateTomany(
        schema,
        resource,
        params.meta,
        options.include?.allowTomanyFromPlusAll
      );

      const normalized = normalizeDocument(json, {
        schema,
        resourceEndpoint: resource,
        includeTomany,
        delimiter,
        logger
      });

      return {
        data: normalized.records.map((record) =>
          synthesizeCompositeKeys(record, resource, schema, delimiter)
        )
      };
    },

    async getManyReference(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      const query = buildManyReferenceQuery(resource, params, schema, {
        delimiter,
        defaultPerPage: options.defaultPerPage,
        include: options.include,
        logger
      });
      const url = appendQuery(`${apiRoot}${resource}`, query);
      const { json } = await http.requestJson<JsonApiDocument>(url, {
        signal: params.signal
      });

      const includeTomany = shouldHydrateTomany(
        schema,
        resource,
        params.meta,
        options.include?.allowTomanyFromPlusAll
      );

      const normalized = normalizeDocument(json, {
        schema,
        resourceEndpoint: resource,
        includeTomany,
        delimiter,
        logger
      });

      const withAutoload = await autoloadToOneRelationships(
        resource,
        normalized.records.map((record) =>
          synthesizeCompositeKeys(record, resource, schema, delimiter)
        ),
        'manyReference',
        params.meta,
        params.signal
      );

      return {
        data: withAutoload,
        total: getTotal(json, { keys: totalKeys })
      };
    },

    async create(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      const { payload } = sanitizeAttributes(resource, params.data, schema, logger, undefined, 'create');
      const url = `${apiRoot}${resource}`;
      const { json } = await http.requestJson<JsonApiDocument>(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: params.signal
      });

      return {
        data: normalizeWriteResponse(
          json,
          schema,
          resource,
          delimiter,
          shouldHydrateTomany(
            schema,
            resource,
            params.meta,
            options.include?.allowTomanyFromPlusAll
          ),
          logger
        )
      };
    },

    async update(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      return performUpdate(resource, params);
    },

    async updateMany(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      await Promise.all(
        params.ids.map((id) =>
          performUpdate(resource, {
            id,
            data: params.data,
            meta: params.meta,
            signal: params.signal
          })
        )
      );

      return {
        data: params.ids
      };
    },

    async delete(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      return performDelete(resource, params.id, params.signal);
    },

    async execute<T = unknown>(
      resource: string,
      params: ExecuteParams
    ): Promise<ExecuteResult<T>> {
      const method = (params.method ?? 'POST').toUpperCase() as NonNullable<ExecuteParams['method']>;
      const mode = params.mode ?? 'rpc';
      const responseType = params.responseType ?? 'json';
      const validJsonapi = params.validJsonapi !== false;
      const url = buildExecuteUrl(apiRoot, resource, {
        ...params,
        method
      });

      const requestInit: Parameters<typeof http.request>[1] = {
        method,
        signal: params.signal,
        responseType,
        accept:
          responseType === 'json'
            ? 'application/vnd.api+json, application/json'
            : responseType === 'text'
              ? 'text/plain, */*'
              : '*/*'
      };

      if (method !== 'GET') {
        if (mode === 'raw') {
          const rawBody = encodeRawBody(params.body);
          requestInit.body = rawBody.body;
          requestInit.contentType = rawBody.contentType;
        } else if (validJsonapi) {
          requestInit.body = JSON.stringify({
            meta: {
              args: params.args ?? {}
            }
          });
          requestInit.contentType = 'application/vnd.api+json';
        } else {
          requestInit.body = JSON.stringify(params.args ?? {});
          requestInit.contentType = 'application/json';
        }
      }

      const { data: decoded } = await http.request<unknown>(url, requestInit);

      if (mode === 'raw' || responseType !== 'json') {
        return {
          data: decoded as T
        };
      }

      if (hasJsonApiDocumentShape(decoded)) {
        return {
          data: normalizeExecuteData(decoded) as T,
          meta: decoded.meta
        };
      }

      if (hasMetaResult(decoded)) {
        return {
          data: decoded.meta.result as T,
          meta: decoded.meta
        };
      }

      if (decoded && typeof decoded === 'object' && 'meta' in decoded) {
        return {
          data: decoded as T,
          meta: (decoded as { meta?: unknown }).meta
        };
      }

      return {
        data: decoded as T
      };
    },

    async deleteMany(resource, params) {
      if (!schema.resources[resource]) {
        throw new Error(`Unknown resource: ${resource}`);
      }

      await Promise.all(
        params.ids.map((id) => performDelete(resource, id, params.signal))
      );

      return {
        data: params.ids
      };
    }
  };
}

export async function createDataProvider(
  options: CreateDataProviderOptions = {}
): Promise<SafrsDataProvider> {
  const schema = await loadSchemaIfNeeded(options);
  return createAdapter(schema, options);
}

export function createDataProviderSync(
  options: CreateDataProviderOptions
): SafrsDataProvider {
  const schema = ensureSchema(options);
  return createAdapter(schema, options);
}
