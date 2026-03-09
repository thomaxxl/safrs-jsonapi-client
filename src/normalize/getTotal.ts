import { JsonApiDocument, TotalOptions } from '../types';

export function getTotal(
  doc: JsonApiDocument,
  options?: TotalOptions
): number {
  const keys = options?.keys ?? ['count', 'total'];
  const meta = doc.meta ?? {};

  for (const key of keys) {
    const value = (meta as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  if (Array.isArray(doc.data)) {
    return doc.data.length;
  }

  return doc.data ? 1 : 0;
}
