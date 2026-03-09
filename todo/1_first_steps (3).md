# safrs-jsonapi-client — first steps (make base production-ready)

This is a concrete “what to do next” checklist to turn the current scaffold into something you can depend on.

Assumption: **new package**, no compatibility constraints with the old `rav4-jsonapi-client` output.

---

## 1) Lock the base milestone scope

Keep the base milestone small:

- ✅ schema load/normalize from `admin.yaml`
- ✅ apiRoot resolution rules
- ✅ query builders (paging/sort/filter pass-through/include)
- ✅ JSON:API transport with error mapping
- ✅ normalization (flatten + inline to-one; to-many only when asked)
- ✅ writes: sanitize + POST/PATCH/DELETE
- ✅ React-admin dataProvider adapter
- ✅ CLI smoke

Explicitly **out of scope for base**:

- `filter.q` semantics (keep as backlog / experimental)
- relationship writes
- JSON:API discovery

---

## 2) Create a reproducible “real API” test target

You said you will run a SAFrs/ApiLogicServer instance for testing. Make it deterministic.

### 2.1 Minimum recommended setup

- A docker-compose (or makefile) that starts:
  - the API
  - any DB dependencies
- An exposed API base URL like `http://localhost:8000/api/`
- A stable `admin.yaml` endpoint at `/ui/admin/admin.yaml`

### 2.2 One command to validate the running stack

The CLI smoke runner should be the single “is the stack alive?” check:

```bash
safrs-jsonapi-smoke \
  --admin-yaml http://localhost:8000/ui/admin/admin.yaml \
  --api-url http://localhost:8000/api/ \
  --resource Order \
  --limit 1
```

Expected output:

- list: resource=Order items=1 total=<number>
- getOne: id=<id>
- relationship: <name> ok items=<n>

If any request fails or returns non-JSON, smoke exits with code 1.

---

## 3) Integrate into `safrs-react-admin` (replace the embedded client)

Right now `safrs-react-admin` carries an embedded `rav4-jsonapi-client` copy.

### 3.1 Replace strategy

- Add the new package as a dependency (or workspace link):
  - `safrs-jsonapi-client`
- Delete (or stop importing) the embedded `src/rav4-jsonapi-client/*`.

### 3.2 DataProvider wiring

In RA v5 entrypoint:

- Create the provider once at startup:

```ts
import { createDataProvider } from 'safrs-jsonapi-client';

export const dataProviderPromise = createDataProvider({
  adminYamlUrl: '/ui/admin/admin.yaml',
  // apiRoot optional in browser; but set it explicitly if you want to avoid relying on api_root placeholders
  // apiRoot: 'http://localhost:8000/api/',
  defaultPerPage: 10,
  delimiter: '_',
  // later: integrate RA authProvider here by plugging getAuthHeaders
  getAuthHeaders: () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
});
```

Then pass it to `<Admin dataProvider={...} />`.

### 3.3 Quick compatibility check

The new records include:

- `id`
- flattened attributes
- `attributes` object
- `relationships` object
- inlined **to-one** relationships as objects

So most existing UI code that used `record.<Attr>` or `record.Customer.<Attr>` should continue to work.

Anything that relied on to-many being auto-inlined will need to explicitly request includes (see next).

---

## 4) Establish the include policy in the UI

Base rule:

- list/getOne: include to-one by default
- to-many: only when explicitly requested

### 4.1 How the UI requests includes

In RA calls that support meta:

- `meta: { include: ['OrderDetailList'] }` to inline to-many
- `meta: { include: ['+all'] }` allowed but discouraged

### 4.2 Do not rely on `include=+all`

Keep `+all` as an escape hatch only.
If a view needs N relationships, list them explicitly.

---

## 5) Fill the remaining “base” gaps in the scaffold

The scaffold is strong, but two base-level gaps should be closed early:

### 5.1 Implement bulk methods (React-admin)

React-admin will call these for bulk actions:

- `updateMany`
- `deleteMany`

Implement them as `Promise.all` over per-id PATCH/DELETE.
If you don’t implement them, document that bulk actions are unsupported and disable bulk buttons in RA.

### 5.2 Decide on `filter.q`

You asked to keep filtering on backlog.

So for base:

- Implement only `filter[field]=value` pass-through.
- Treat `filter.q` as either:
  - **ignored** (preferred for clarity)
  - or “experimental” behind an explicit flag.

Reason: the semantics (operator set, wildcard rules, AND/OR) are not pinned down yet.

---

## 6) Add integration tests against the real server

Unit tests are good for query/normalize edge cases, but you need contract coverage.

### 6.1 Minimal integration test suite

Run against the dockerized API:

- `getList(Order, perPage=3)` returns:
  - `data.length <= 3`
  - `total` extracted from `meta.count` (fallback to `meta.total`)
- `getOne(Order, first.id)` returns record with:
  - `id`
  - at least one to-one relationship inlined (Customer/Employee)
- `getMany(Order, ids=[...])` returns those ids
- `getManyReference(OrderDetail, target=<fk>, id=<parentId>)` returns filtered rows
- write round-trip (only if the API allows it): create + update + delete on a safe resource

### 6.2 Where fixtures should live

Avoid “copied attachments” in tests.

Instead:

- keep only tiny fixture YAMLs for unit tests
- for integration tests, hit the real API endpoints and assert behavior

---

## 7) Hardening pass (still base milestone)

These are common failure points in real deployments:

1) **Trailing slash tolerance**
- Some SAFrs deployments return links with trailing `/`.
- Ensure the client works regardless (follow redirects, and/or allow a `resourceTrailingSlash` option later).

2) **Relationship link semantics**
- SAFrs often provides only `relationships.<rel>.links.self`.
- Treat it as “related” when implementing relationship fetch helpers.

3) **Strict content-type**
- Always send/accept `application/vnd.api+json`.

4) **Log warnings, don’t silently guess**
- Unknown include names
- Unknown filter keys
- Dropped write attributes

---

## 8) Next milestone: lightweight ORM-like helpers (after base)

Once base is stable and tested, add a small convenience layer:

- `client.get(resource, id, { include })`
- `client.list(resource, { page, perPage, include })`
- `client.related(record, relationshipName)`
  - uses `links.related` else `links.self`
  - caches by (type:id)

Keep it small:

- identity map + cache
- relationship walking
- no unit-of-work

---

## 9) Open questions to park (not needed to proceed)

- Should search columns be inferred from `admin.yaml` attribute flags (e.g. `search: true`) when you later implement `filter.q`?
- Do you need per-resource delimiter overrides (beyond global `_`) for composite ids?
- Do you want default sparse fieldsets from schema to reduce payloads, or keep “full attributes” for simplicity?
