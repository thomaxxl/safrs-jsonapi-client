import { createDataProvider } from '../../src';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

interface ExecuteCaseConfig {
  resource: string;
  action: string;
  id?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  mode?: 'rpc' | 'raw';
  args?: Record<string, unknown>;
  query?: Record<string, unknown>;
  validJsonapi?: boolean;
}

function parseJsonEnv(
  value: string | undefined,
  label: string
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${String(error)}`);
  }
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

function loadExecuteCase(prefix: string): ExecuteCaseConfig | null {
  const resource = process.env[`${prefix}_RESOURCE`];
  const action = process.env[`${prefix}_ACTION`];

  if (!resource || !action) {
    return null;
  }

  return {
    resource,
    action,
    id: process.env[`${prefix}_ID`],
    method: process.env[`${prefix}_METHOD`] as ExecuteCaseConfig['method'] | undefined,
    mode: process.env[`${prefix}_MODE`] as ExecuteCaseConfig['mode'] | undefined,
    args: parseJsonEnv(process.env[`${prefix}_ARGS_JSON`], `${prefix}_ARGS_JSON`),
    query: parseJsonEnv(process.env[`${prefix}_QUERY_JSON`], `${prefix}_QUERY_JSON`),
    validJsonapi: parseBooleanEnv(process.env[`${prefix}_VALID_JSONAPI`])
  };
}

describeIntegration('data provider execute integration (real API)', () => {
  jest.setTimeout(60000);

  const apiUrl = process.env.API_URL;
  const adminYamlUrl = process.env.ADMIN_YAML_URL;

  if (!apiUrl || !adminYamlUrl) {
    it('requires API_URL and ADMIN_YAML_URL', () => {
      throw new Error('Set RUN_INTEGRATION=1 with API_URL and ADMIN_YAML_URL');
    });
    return;
  }

  it('executes a scalar-style RPC endpoint when configured', async () => {
    const scalarCase = loadExecuteCase('API_EXECUTE_SCALAR');

    if (!scalarCase) {
      return;
    }

    const provider = await createDataProvider({
      apiRoot: apiUrl,
      adminYamlUrl
    });

    const result = await provider.execute(scalarCase.resource, scalarCase);
    expect(result.data).not.toBeUndefined();
    expect(Array.isArray(result.data)).toBe(false);
  });

  it('executes a resource-returning RPC endpoint when configured', async () => {
    const resourceCase = loadExecuteCase('API_EXECUTE_RESOURCE');

    if (!resourceCase) {
      return;
    }

    const provider = await createDataProvider({
      apiRoot: apiUrl,
      adminYamlUrl
    });

    const result = await provider.execute(resourceCase.resource, resourceCase);
    const data = result.data as unknown;

    if (Array.isArray(data)) {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toMatchObject({
        id: expect.anything(),
        ja_type: expect.any(String)
      });
      return;
    }

    expect(data).toMatchObject({
      id: expect.anything(),
      ja_type: expect.any(String)
    });
  });
});
