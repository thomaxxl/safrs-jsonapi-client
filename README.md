# safrs-jsonapi-client

Phase-1 scaffold for a SAFrs/ApiLogicServer JSON:API client with a React-admin adapter.

## Status

Initial implementation includes:
- schema normalization from `admin.yaml`
- `api_root` resolution
- pure query builders
- transport with JSON:API error mapping
- document normalization + shallow hydration
- total extraction (`meta.count` -> `meta.total` -> `data.length`)
- write sanitization
- React-admin-style data provider adapter
- `updateMany` / `deleteMany` bulk fallbacks
- CLI smoke runner

Backlog in base milestone:
- `filter.q` semantics (currently ignored with warning)

## Install

```bash
npm install
```

## Consumer install model

This package is intended to be consumed from GitHub without publishing to npm.

Recommended approach:

1. build and pack the library locally
2. attach the generated `.tgz` from `npm pack` to a GitHub release
3. install consumers from that immutable release asset URL

Example consumer dependency:

```json
{
  "dependencies": {
    "safrs-jsonapi-client": "https://github.com/thomaxxl/safrs-jsonapi-client/releases/download/v0.1.0/safrs-jsonapi-client-0.1.0.tgz"
  }
}
```

Do not rely on raw GitHub source archives such as `codeload.github.com/.../tar.gz/<sha>`
for consumers of this package. Those archives are source snapshots, not packed
package artifacts, and they do not guarantee the built `dist/` files exported
by `package.json`.

## Build

```bash
npm run build
```

## Release artifact

Create a GitHub-release install artifact with:

```bash
npm run pack:release
```

This runs the `prepack` hook, rebuilds `dist/`, and produces a tarball such as:

```text
safrs-jsonapi-client-0.1.0.tgz
```

Attach that tarball to the matching GitHub release and use the release asset
URL in downstream apps.

## Test

```bash
npm test
```

Integration tests (real API):

```bash
RUN_INTEGRATION=1 API_URL=http://localhost:8000/api/ ADMIN_YAML_URL=http://localhost:8000/ui/admin/admin.yaml npm run test:integration
```

## Smoke test

```bash
node dist/cli/smoke.js --admin-yaml /path/to/admin.yaml --api-url https://your-api.example.com/api/ --resource YourResource --limit 1
```

`--resource` is optional. If omitted, the smoke runner uses the first resource found in `admin.yaml`.
`--admin-yaml` accepts either a local path or an `http(s)` URL.

Or:

```bash
npm run smoke -- --admin-yaml /path/to/admin.yaml --api-url https://your-api.example.com/api/ --resource YourResource --limit 1
```

## Fixtures

Fetch/update response fixtures from a live API:

```bash
npm run fixtures:fetch -- --baseUrl http://localhost:8000/api/ --resource Order --id 10248 --include Customer,Employee
```

## Usage

```ts
import { createDataProvider } from 'safrs-jsonapi-client';

const dataProvider = await createDataProvider({
  adminYamlUrl: '/ui/admin/admin.yaml',
  apiRoot: 'https://your-api.example.com/api/'
});
```

## Custom Methods: `execute()`

The React-admin adapter exposes a custom `execute()` method for SAFRS RPC-style
endpoints and raw JSON service calls.

```ts
import { useDataProvider } from 'react-admin';
import type { SafrsDataProvider } from 'safrs-jsonapi-client';

const dataProvider = useDataProvider<SafrsDataProvider>();

await dataProvider.execute('People', {
  id: 1,
  action: 'send_mail',
  method: 'POST',
  args: {
    email: 'x@y.test'
  }
});
```

Default behavior is RPC mode:

- request body is wrapped as `{"meta":{"args": ...}}`
- `GET` calls move `args` into the query string
- scalar RPC responses are unwrapped from `meta.result`
- JSON:API resource responses are normalized like the built-in CRUD methods

Use raw mode to send and receive plain JSON:

```ts
await dataProvider.execute('Reports', {
  action: 'run',
  mode: 'raw',
  method: 'POST',
  body: {
    from: '2026-01-01',
    to: '2026-01-31'
  }
});
```

`execute()` shares the same auth header hook, JSON:API error mapping, and
`AbortSignal` wiring as the CRUD methods. For React Query usage, call it through
`useDataProvider()` and invalidate or refresh the relevant query keys after
mutations.
