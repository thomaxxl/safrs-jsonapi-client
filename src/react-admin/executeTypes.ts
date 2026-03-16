import type { DataProvider } from '../types';

export type ExecuteMode = 'rpc' | 'raw';
export type ExecuteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type ExecuteResponseType = 'json' | 'text' | 'blob';
export type ExecuteIdentifier = string | number;

export interface ExecuteParams {
  action: string;
  id?: ExecuteIdentifier;
  method?: ExecuteMethod;
  mode?: ExecuteMode;
  args?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  validJsonapi?: boolean;
  responseType?: ExecuteResponseType;
}

export interface ExecuteResult<T = unknown> {
  data: T;
  meta?: unknown;
  raw?: unknown;
}

export interface SafrsDataProvider extends DataProvider {
  execute: <T = unknown>(resource: string, params: ExecuteParams) => Promise<ExecuteResult<T>>;
}
