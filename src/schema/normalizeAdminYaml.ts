import {
  Schema,
  SchemaAttribute,
  SchemaRelationship,
  SchemaResource
} from '../types';

interface RawResource {
  type?: string;
  user_key?: string;
  composite_delimiter?: string;
  compositeDelimiter?: string;
  sort?: string;
  search_cols?: Array<{ name: string; op?: string; val?: string }>;
  attributes?: Array<{
    name?: string;
    type?: string;
    search?: boolean;
    required?: boolean;
    hide_edit?: boolean;
    hideEdit?: boolean;
  } | string>;
  tab_groups?: unknown;
}

interface RawAdminYaml {
  api_root?: string;
  resources?: Record<string, RawResource>;
}

function normalizeTabGroups(tabGroups: unknown): SchemaRelationship[] {
  if (!tabGroups) {
    return [];
  }

  const entries = Array.isArray(tabGroups)
    ? tabGroups
    : typeof tabGroups === 'object'
      ? Object.values(tabGroups as Record<string, unknown>)
      : [];

  return entries
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const raw = item as {
        name?: unknown;
        direction?: unknown;
        resource?: unknown;
        fks?: unknown;
        disable_autoload?: unknown;
        disableAutoload?: unknown;
        hide_list?: unknown;
        hideList?: unknown;
        hide_show?: unknown;
        hideShow?: unknown;
        composite_delimiter?: unknown;
        compositeDelimiter?: unknown;
      };

      if (typeof raw.name !== 'string' || typeof raw.resource !== 'string') {
        return null;
      }

      const direction = raw.direction === 'tomany' ? 'tomany' : 'toone';
      const fks = Array.isArray(raw.fks)
        ? raw.fks.filter((fk): fk is string => typeof fk === 'string')
        : [];

      const normalized: SchemaRelationship = {
        name: raw.name,
        direction,
        targetResource: raw.resource,
        fks,
        disableAutoload:
          typeof raw.disable_autoload === 'boolean'
            ? raw.disable_autoload
            : typeof raw.disableAutoload === 'boolean'
              ? raw.disableAutoload
              : undefined,
        hideList:
          typeof raw.hide_list === 'boolean'
            ? raw.hide_list
            : typeof raw.hideList === 'boolean'
              ? raw.hideList
              : undefined,
        hideShow:
          typeof raw.hide_show === 'boolean'
            ? raw.hide_show
            : typeof raw.hideShow === 'boolean'
              ? raw.hideShow
              : undefined,
        compositeDelimiter:
          typeof raw.composite_delimiter === 'string'
            ? raw.composite_delimiter
            : typeof raw.compositeDelimiter === 'string'
              ? raw.compositeDelimiter
              : undefined
      };

      return normalized;
    })
    .filter((rel): rel is SchemaRelationship => rel !== null);
}

function normalizeAttributes(
  attributesInput: RawResource['attributes']
): SchemaAttribute[] {
  const normalized: SchemaAttribute[] = [];

  for (const attr of attributesInput ?? []) {
    if (typeof attr === 'string') {
      normalized.push({ name: attr });
      continue;
    }

    if (!attr || typeof attr.name !== 'string') {
      continue;
    }

    normalized.push({
      name: attr.name,
      type: attr.type,
      search: attr.search,
      required: attr.required,
      hideEdit:
        typeof attr.hide_edit === 'boolean'
          ? attr.hide_edit
          : typeof attr.hideEdit === 'boolean'
            ? attr.hideEdit
            : undefined
    });
  }

  return normalized;
}

export function normalizeAdminYaml(
  rawYaml: unknown,
  options?: { delimiter?: string }
): Schema {
  const delimiter = options?.delimiter ?? '_';
  const raw = (rawYaml ?? {}) as RawAdminYaml;
  const resourcesInput = raw.resources ?? {};

  const resources: Record<string, SchemaResource> = {};
  const resourceByType: Record<string, string> = {};
  const attributeNameSet: Record<string, Set<string>> = {};
  const readonlyAttributeSet: Record<string, Set<string>> = {};
  const relationshipsByName: Record<string, Record<string, SchemaRelationship>> = {};
  const compositeTargets: Record<string, Map<string, string[]>> = {};
  const fkToRelationship: Record<string, Record<string, SchemaRelationship>> = {};

  for (const [endpoint, resourceInput] of Object.entries(resourcesInput)) {
    const type = resourceInput.type ?? endpoint;
    const attributeConfigs = normalizeAttributes(resourceInput.attributes);
    const attributes = attributeConfigs.map((attr) => attr.name);
    const readonlyAttributes = new Set(
      attributeConfigs
        .filter((attr) => attr.hideEdit === true)
        .map((attr) => attr.name)
    );

    const relationships = normalizeTabGroups(resourceInput.tab_groups);
    let searchCols = (resourceInput.search_cols ?? []).filter(
      (col): col is { name: string; op?: string; val?: string } =>
        !!col && typeof col.name === 'string'
    );
    if (searchCols.length === 0) {
      searchCols = attributeConfigs
        .filter((attr) => attr.search === true)
        .map((attr) => ({ name: attr.name }));
    }

    const schemaResource: SchemaResource = {
      endpoint,
      type,
      userKey: resourceInput.user_key,
      compositeDelimiter:
        resourceInput.composite_delimiter
        ?? resourceInput.compositeDelimiter,
      sort: resourceInput.sort,
      attributes,
      attributeConfigs,
      relationships,
      searchCols
    };

    resources[endpoint] = schemaResource;
    resourceByType[type] = endpoint;
    attributeNameSet[endpoint] = new Set(attributes);
    readonlyAttributeSet[endpoint] = readonlyAttributes;

    relationshipsByName[endpoint] = {};
    fkToRelationship[endpoint] = {};
    compositeTargets[endpoint] = new Map();

    for (const relationship of relationships) {
      relationshipsByName[endpoint][relationship.name] = relationship;
      for (const fk of relationship.fks) {
        fkToRelationship[endpoint][fk] = relationship;
      }
      if (relationship.fks.length > 1) {
        const compositeName = relationship.fks.join(delimiter);
        compositeTargets[endpoint].set(compositeName, relationship.fks);
      }
    }
  }

  return {
    delimiter,
    apiRoot: raw.api_root,
    resources,
    resourceByType,
    attributeNameSet,
    readonlyAttributeSet,
    relationshipsByName,
    compositeTargets,
    fkToRelationship,
    raw: rawYaml
  };
}
