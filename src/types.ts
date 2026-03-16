export type RelationshipDirection = 'toone' | 'tomany';

export interface SchemaAttribute {
  name: string;
  type?: string;
  search?: boolean;
  required?: boolean;
  hideEdit?: boolean;
}

export interface SchemaRelationship {
  name: string;
  direction: RelationshipDirection;
  targetResource: string;
  fks: string[];
  disableAutoload?: boolean;
  hideList?: boolean;
  hideShow?: boolean;
  compositeDelimiter?: string;
}

export interface SearchCol {
  name: string;
  op?: string;
  val?: string;
}

export interface SchemaResource {
  endpoint: string;
  type: string;
  userKey?: string;
  sort?: string;
  attributes: string[];
  attributeConfigs: SchemaAttribute[];
  relationships: SchemaRelationship[];
  searchCols: SearchCol[];
  compositeDelimiter?: string;
}

export interface Schema {
  delimiter: string;
  apiRoot?: string;
  resources: Record<string, SchemaResource>;
  resourceByType: Record<string, string>;
  attributeNameSet: Record<string, Set<string>>;
  readonlyAttributeSet: Record<string, Set<string>>;
  relationshipsByName: Record<string, Record<string, SchemaRelationship>>;
  compositeTargets: Record<string, Map<string, string[]>>;
  fkToRelationship: Record<string, Record<string, SchemaRelationship>>;
  raw: unknown;
}

export interface JsonApiResourceIdentifier {
  id: string;
  type: string;
}

export interface JsonApiRelationship {
  data?: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null;
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRelationship>;
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface JsonApiDocument {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
  errors?: JsonApiErrorObject[];
}

export interface JsonApiErrorObject {
  id?: string;
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: unknown;
  meta?: unknown;
}

export interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export type RecordData = Record<string, unknown>;

export interface NormalizedResult {
  store: Map<string, JsonApiResource>;
  records: RecordData[];
}

export interface TotalOptions {
  keys?: string[];
}

export interface IncludeBuildOptions {
  allowTomanyFromPlusAll?: boolean;
}

export interface BuildQueryOptions {
  delimiter?: string;
  defaultPerPage?: number;
  include?: IncludeBuildOptions;
  logger?: LoggerLike;
}

export interface ResolveApiRootOptions {
  apiRoot?: string;
  apiPathFallback?: string;
  location?: {
    protocol?: string;
    hostname?: string;
    port?: string;
    origin?: string;
  };
  cliDefaultApiRoot?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  json: T;
}

export type HttpResponseType = 'json' | 'text' | 'blob';

export interface HttpRequestOptions extends RequestInit {
  responseType?: HttpResponseType;
  accept?: string;
  contentType?: string;
}

export interface HttpDecodedResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CreateHttpClientOptions {
  fetch: FetchLike;
  getAuthHeaders?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  logger?: LoggerLike;
}

export interface DataProviderListParams {
  pagination?: { page?: number; perPage?: number };
  sort?: { field?: string; order?: 'ASC' | 'DESC' | string };
  filter?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderOneParams {
  id: string | number;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderManyParams {
  ids: Array<string | number>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderManyReferenceParams {
  target: string;
  id: string | number;
  pagination?: { page?: number; perPage?: number };
  sort?: { field?: string; order?: 'ASC' | 'DESC' | string };
  filter?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderCreateParams {
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderUpdateParams {
  id: string | number;
  data: Record<string, unknown>;
  previousData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderDeleteParams {
  id: string | number;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderUpdateManyParams {
  ids: Array<string | number>;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProviderDeleteManyParams {
  ids: Array<string | number>;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface DataProvider {
  supportAbortSignal?: boolean;
  getList: (
    resource: string,
    params?: DataProviderListParams
  ) => Promise<{ data: RecordData[]; total: number }>;
  getOne: (
    resource: string,
    params: DataProviderOneParams
  ) => Promise<{ data: RecordData }>;
  getMany: (
    resource: string,
    params: DataProviderManyParams
  ) => Promise<{ data: RecordData[] }>;
  getManyReference: (
    resource: string,
    params: DataProviderManyReferenceParams
  ) => Promise<{ data: RecordData[]; total: number }>;
  create: (
    resource: string,
    params: DataProviderCreateParams
  ) => Promise<{ data: RecordData }>;
  update: (
    resource: string,
    params: DataProviderUpdateParams
  ) => Promise<{ data: RecordData }>;
  updateMany: (
    resource: string,
    params: DataProviderUpdateManyParams
  ) => Promise<{ data: Array<string | number> }>;
  delete: (
    resource: string,
    params: DataProviderDeleteParams
  ) => Promise<{ data: RecordData }>;
  deleteMany: (
    resource: string,
    params: DataProviderDeleteManyParams
  ) => Promise<{ data: Array<string | number> }>;
}

export interface CreateDataProviderOptions {
  apiRoot?: string;
  adminYamlUrl?: string;
  schema?: Schema;
  fetch?: FetchLike;
  getAuthHeaders?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  defaultPerPage?: number;
  delimiter?: string;
  totalKeys?: string[];
  include?: IncludeBuildOptions;
  logger?: LoggerLike;
}
