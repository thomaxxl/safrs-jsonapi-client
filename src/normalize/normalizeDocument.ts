import {
  JsonApiDocument,
  JsonApiRelationship,
  JsonApiResource,
  JsonApiResourceIdentifier,
  LoggerLike,
  NormalizedResult,
  RecordData,
  Schema,
  SchemaRelationship
} from '../types';

export interface NormalizeOptions {
  schema?: Schema;
  resourceEndpoint?: string;
  maxDepth?: number;
  includeTomany?: boolean;
  delimiter?: string;
  logger?: LoggerLike;
}

function keyFor(type: string, id: string): string {
  return `${type}:${id}`;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getAttrCaseInsensitive(
  attrs: Record<string, unknown> | undefined,
  field: string
): unknown {
  if (!attrs) {
    return undefined;
  }

  if (field in attrs) {
    return attrs[field];
  }

  const lower = field.toLowerCase();
  const key = Object.keys(attrs).find((candidate) => candidate.toLowerCase() === lower);
  return key ? attrs[key] : undefined;
}

function extractFkValues(
  attrs: Record<string, unknown> | undefined,
  fks: string[]
): Array<string | undefined> {
  return fks.map((fk) => {
    const value = getAttrCaseInsensitive(attrs, fk);
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  });
}

function toStub(identifier: JsonApiResourceIdentifier): RecordData {
  return {
    id: identifier.id,
    ja_type: identifier.type
  };
}

function resolveSchemaRelationship(
  schema: Schema | undefined,
  endpoint: string | undefined,
  relationshipName: string
): SchemaRelationship | undefined {
  if (!schema || !endpoint) {
    return undefined;
  }
  return schema.relationshipsByName[endpoint]?.[relationshipName];
}

function resolveTargetType(schema: Schema | undefined, relationship: SchemaRelationship): string {
  if (!schema) {
    return relationship.targetResource;
  }

  const target = schema.resources[relationship.targetResource];
  return target?.type ?? relationship.targetResource;
}

function flattenResource(
  resource: JsonApiResource,
  store: Map<string, JsonApiResource>,
  options: NormalizeOptions,
  endpoint: string | undefined,
  depth: number,
  visited: Set<string>
): RecordData {
  const attrs = resource.attributes ?? {};
  const record: RecordData = {
    id: resource.id,
    ja_type: resource.type,
    attributes: { ...attrs },
    relationships: { ...(resource.relationships ?? {}) },
    ...attrs
  };

  const relationships = resource.relationships ?? {};
  for (const [relationshipName, relationship] of Object.entries(relationships)) {
    const schemaRelationship = resolveSchemaRelationship(options.schema, endpoint, relationshipName);

    if (schemaRelationship?.direction === 'tomany' && !options.includeTomany) {
      continue;
    }

    const hydrated = hydrateRelationship(
      resource,
      relationship,
      relationshipName,
      schemaRelationship,
      store,
      options,
      depth,
      visited
    );

    if (hydrated !== undefined) {
      inlineRelationship(record, relationshipName, hydrated, options);
    }
  }

  return record;
}

function hasOwnValue(record: RecordData, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nextRelationshipAlias(record: RecordData, relationshipName: string): string {
  const base = `rel_${relationshipName}`;
  if (!hasOwnValue(record, base)) {
    return base;
  }

  let index = 1;
  while (hasOwnValue(record, `${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

function inlineRelationship(
  record: RecordData,
  relationshipName: string,
  value: RecordData | RecordData[] | null,
  options: NormalizeOptions
): void {
  if (!hasOwnValue(record, relationshipName)) {
    record[relationshipName] = value;
    return;
  }

  const alias = nextRelationshipAlias(record, relationshipName);
  options.logger?.warn?.(
    `Relationship '${relationshipName}' collides with an existing field; inlined under '${alias}'.`
  );
  record[alias] = value;
}

function hydrateIdentifier(
  identifier: JsonApiResourceIdentifier,
  store: Map<string, JsonApiResource>,
  options: NormalizeOptions,
  depth: number,
  visited: Set<string>
): RecordData {
  const key = keyFor(identifier.type, identifier.id);
  if (visited.has(key)) {
    return toStub(identifier);
  }

  const resource = store.get(key);
  if (!resource) {
    return toStub(identifier);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(key);

  const endpoint = options.schema?.resourceByType[resource.type];

  if (depth <= 0) {
    return {
      id: resource.id,
      ja_type: resource.type,
      attributes: { ...(resource.attributes ?? {}) },
      ...(resource.attributes ?? {})
    };
  }

  return flattenResource(resource, store, options, endpoint, depth - 1, nextVisited);
}

function fallbackHydrateToOne(
  resource: JsonApiResource,
  schemaRelationship: SchemaRelationship,
  store: Map<string, JsonApiResource>,
  options: NormalizeOptions,
  depth: number,
  visited: Set<string>
): RecordData | null | undefined {
  const attrs = resource.attributes ?? {};
  const fkValues = extractFkValues(attrs, schemaRelationship.fks);
  if (fkValues.some((value) => value === undefined)) {
    return undefined;
  }

  const resolvedFkValues = fkValues as string[];
  const targetType = resolveTargetType(options.schema, schemaRelationship);

  const delimiter = options.delimiter ?? options.schema?.delimiter ?? '_';
  const candidateId =
    resolvedFkValues.length === 1
      ? resolvedFkValues[0]
      : resolvedFkValues.join(delimiter);

  const primaryCandidate = store.get(keyFor(targetType, candidateId));
  if (primaryCandidate) {
    return hydrateIdentifier(
      { type: targetType, id: primaryCandidate.id },
      store,
      options,
      depth,
      visited
    );
  }

  const fallbackCandidate = Array.from(store.values()).find((candidate) => {
    if (candidate.type !== targetType) {
      return false;
    }

    if (String(candidate.id) === candidateId) {
      return true;
    }

    const candidateAttrs = candidate.attributes ?? {};
    return schemaRelationship.fks.every((fk, index) => {
      const actual = getAttrCaseInsensitive(candidateAttrs, fk);
      return actual !== undefined && String(actual) === resolvedFkValues[index];
    });
  });

  if (!fallbackCandidate) {
    return {
      id: candidateId,
      ja_type: targetType
    };
  }

  return hydrateIdentifier(
    { type: targetType, id: fallbackCandidate.id },
    store,
    options,
    depth,
    visited
  );
}

function fallbackHydrateToMany(
  resource: JsonApiResource,
  schemaRelationship: SchemaRelationship,
  store: Map<string, JsonApiResource>,
  options: NormalizeOptions,
  depth: number,
  visited: Set<string>
): RecordData[] | undefined {
  const targetType = resolveTargetType(options.schema, schemaRelationship);
  const parentAttrs = resource.attributes ?? {};

  const fkExpectedValues = schemaRelationship.fks.map((fk) => {
    const fromAttributes = getAttrCaseInsensitive(parentAttrs, fk);
    if (fromAttributes !== undefined && fromAttributes !== null) {
      return String(fromAttributes);
    }

    if (schemaRelationship.fks.length === 1) {
      return String(resource.id);
    }

    return undefined;
  });

  if (fkExpectedValues.some((v) => v === undefined)) {
    return undefined;
  }

  const expected = fkExpectedValues as string[];
  const matches = Array.from(store.values()).filter((candidate) => {
    if (candidate.type !== targetType) {
      return false;
    }

    const candidateAttrs = candidate.attributes ?? {};
    return schemaRelationship.fks.every((fk, index) => {
      const actual = getAttrCaseInsensitive(candidateAttrs, fk);
      return actual !== undefined && String(actual) === expected[index];
    });
  });

  if (matches.length === 0) {
    return [];
  }

  return matches.map((candidate) =>
    hydrateIdentifier(
      { type: candidate.type, id: candidate.id },
      store,
      options,
      depth,
      visited
    )
  );
}

function hydrateRelationship(
  resource: JsonApiResource,
  relationship: JsonApiRelationship,
  relationshipName: string,
  schemaRelationship: SchemaRelationship | undefined,
  store: Map<string, JsonApiResource>,
  options: NormalizeOptions,
  depth: number,
  visited: Set<string>
): RecordData | RecordData[] | null | undefined {
  const hasData = Object.prototype.hasOwnProperty.call(relationship, 'data');

  if (hasData) {
    if (relationship.data === null) {
      return null;
    }

    if (!relationship.data) {
      return undefined;
    }

    if (Array.isArray(relationship.data)) {
      return relationship.data.map((identifier) =>
        hydrateIdentifier(identifier, store, options, depth, visited)
      );
    }

    return hydrateIdentifier(relationship.data, store, options, depth, visited);
  }

  if (!schemaRelationship) {
    return undefined;
  }

  if (schemaRelationship.direction === 'toone') {
    return fallbackHydrateToOne(resource, schemaRelationship, store, options, depth, visited);
  }

  if (!options.includeTomany) {
    return undefined;
  }

  return fallbackHydrateToMany(resource, schemaRelationship, store, options, depth, visited);
}

export function normalizeDocument(
  doc: JsonApiDocument,
  options: NormalizeOptions = {}
): NormalizedResult {
  const store = new Map<string, JsonApiResource>();
  const primaryData = toArray(doc.data);
  const included = toArray(doc.included);

  for (const resource of [...primaryData, ...included]) {
    if (!resource || !resource.type || resource.id === undefined || resource.id === null) {
      continue;
    }
    store.set(keyFor(resource.type, String(resource.id)), {
      ...resource,
      id: String(resource.id)
    });
  }

  const maxDepth = options.maxDepth ?? 1;
  const records = primaryData.map((resource) => {
    const endpoint =
      options.resourceEndpoint
      ?? options.schema?.resourceByType[resource.type];

    return flattenResource(
      { ...resource, id: String(resource.id) },
      store,
      options,
      endpoint,
      maxDepth,
      new Set([keyFor(resource.type, String(resource.id))])
    );
  });

  return {
    store,
    records
  };
}
