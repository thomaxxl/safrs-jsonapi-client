import { RecordData, Schema } from '../types';

function getRecordValue(record: RecordData, key: string): string | undefined {
  if (record[key] !== undefined && record[key] !== null) {
    return String(record[key]);
  }

  const attributes = record.attributes as Record<string, unknown> | undefined;
  if (attributes && attributes[key] !== undefined && attributes[key] !== null) {
    return String(attributes[key]);
  }

  const lowered = key.toLowerCase();
  const attrHit = attributes
    ? Object.keys(attributes).find((name) => name.toLowerCase() === lowered)
    : undefined;

  if (attrHit) {
    const value = attributes?.[attrHit];
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  return undefined;
}

export function synthesizeCompositeKeys(
  record: RecordData,
  resource: string,
  schema: Schema,
  delimiter?: string
): RecordData {
  const resourceSchema = schema.resources[resource];
  if (!resourceSchema) {
    return record;
  }

  const separator = delimiter ?? schema.delimiter;
  const next = { ...record };

  for (const relationship of resourceSchema.relationships) {
    if (relationship.fks.length <= 1) {
      continue;
    }

    const compositeField = relationship.fks.join(separator);
    const fkValues = relationship.fks.map((fk) => getRecordValue(next, fk));
    if (fkValues.some((value) => value === undefined)) {
      continue;
    }

    next[compositeField] = (fkValues as string[]).join(separator);
  }

  return next;
}
