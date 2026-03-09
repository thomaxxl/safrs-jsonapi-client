import { LoggerLike, RecordData, Schema } from '../types';

const UI_FIELDS_TO_DROP = new Set([
  'id',
  'type',
  'ja_type',
  'attributes',
  'relationships',
  'validUntil'
]);

function flattenInputData(data: Record<string, unknown>): Record<string, unknown> {
  if (
    data.current
    && typeof data.current === 'object'
    && (data.current as Record<string, unknown>).data
    && typeof (data.current as Record<string, unknown>).data === 'object'
  ) {
    return (data.current as { data: Record<string, unknown> }).data;
  }

  return data;
}

export interface SanitizeResult {
  payload: {
    data: {
      type: string;
      id?: string | number;
      attributes: Record<string, unknown>;
    };
  };
  droppedKeys: string[];
}

export function sanitizeAttributes(
  resource: string,
  data: Record<string, unknown>,
  schema: Schema,
  logger?: LoggerLike,
  id?: string | number,
  mode: 'create' | 'update' = 'create'
): SanitizeResult {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  const input = flattenInputData(data);
  const allowed = new Set(resourceSchema.attributes);
  const readonlySet = schema.readonlyAttributeSet[resource] ?? new Set<string>();
  const sanitized: Record<string, unknown> = {};
  const dropped = new Set<string>();
  const readonlyDropped = new Set<string>();

  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) {
      if (mode === 'update' && readonlySet.has(key)) {
        readonlyDropped.add(key);
        dropped.add(key);
        continue;
      }
      sanitized[key] = value;
      continue;
    }

    if (UI_FIELDS_TO_DROP.has(key)) {
      dropped.add(key);
      continue;
    }

    if (value && typeof value === 'object') {
      dropped.add(key);
      continue;
    }

    dropped.add(key);
  }

  if (dropped.size > 0) {
    logger?.warn?.(
      `sanitizeAttributes(${resource}) dropped non-attribute keys: ${Array.from(dropped).join(', ')}`
    );
  }

  if (readonlyDropped.size > 0) {
    logger?.warn?.(
      `sanitizeAttributes(${resource}) dropped readonly update attributes: ${Array.from(readonlyDropped).join(', ')}`
    );
  }

  const payload: SanitizeResult['payload'] = {
    data: {
      type: resourceSchema.type,
      attributes: sanitized
    }
  };

  if (id !== undefined) {
    payload.data.id = id;
  }

  return {
    payload,
    droppedKeys: Array.from(dropped)
  };
}

export function mergeForUpdate(
  incoming: Record<string, unknown>,
  previousData?: RecordData
): Record<string, unknown> {
  if (!previousData) {
    return { ...incoming };
  }

  const merged: Record<string, unknown> = { ...previousData, ...incoming };
  delete merged.id;
  return merged;
}
