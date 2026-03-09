# safrs-jsonapi-client — high-level design (base milestone)

This is the design target for **a new package** (no backward-compat constraints) that provides:

- a **browser-first** JSON:API client + **React-admin v5** dataProvider adapter
- a **Node.js v16+** CLI smoke runner (same codepath)
- schema-driven behavior using **ApiLogicServer `admin.yaml`** (JSON:API discovery later)

The goal is a clean, predictable “base layer” first, then light **ORM-like ergonomics** (relationship navigation + identity map + caching) without turning this into a heavy ORM.

---

## 0) What you already have in the attached implementation

The attached `sjc.01.tgz` scaffold already implements most of the base milestone:

- TypeScript package with dual output (**CJS + ESM**) and types, Node `>=16`.
- Schema loading/normalization from `admin.yaml` (`resources`, `attributes`, `tab_groups`).
- `api_root` resolution (absolute, placeholders, relative path in browser, sane port handling).
- Query builders for RA methods (list/one/many/manyReference) using SAFrs paging (`page[offset]`, `page[limit]`).
- JSON:API transport with error mapping.
- Document normalization + shallow hydration (flatten attributes; inline relationships), including collision-safe aliasing.
- Total extraction with **`meta.count` preferred**, then fallback.
- Write sanitization (attribute allow-list, drop relationship objects, warn).
- React-admin style dataProvider adapter.
- CLI smoke runner `safrs-jsonapi-smoke`.

So the “design” below is largely describing the direction to keep, plus the gaps to close to make it production-ready.

---

## 1) Base milestone objectives

### 1.1 Must-have behaviors

1) **Schema-first mapping**
- Use `admin.yaml` as source of truth for endpoint names, types, attributes, and relationships.
- No OpenAPI ingestion in the base milestone.

2) **Deterministic pagination**
- Use SAFrs paging: `page[offset]` and `page[limit]`.
- Default limit: **10**.
- Global override should be trivial (e.g. 25/50).

3) **Correct totals for React-admin**
- Prefer `meta.count`.
- Fallback to `meta.total`.
- Final fallback to `data.length`.
- Make the key priority configurable.

4) **Relationship policy aligned to performance**
- Inline **to-one** relationships by default for list/getOne (so UI can show user_key without extra clicks).
- Inline **to-many only when explicitly requested** (via `meta.include`), not as a hidden default.
- Support SAFrs `include=+all` as an escape hatch, but **do not recommend it** and default to not expanding to-many.

5) **Predictable record shape**
A normalized record should be:

- `id` (string)
- `ja_type` (JSON:API `type`)
- `attributes` (raw JSON:API attributes object)
- `relationships` (raw JSON:API relationships object)
- attributes also **flattened at top-level** (`record.CustomerId`, …)
- optionally inlined relationship objects under `record.<relationshipName>` (policy-driven)

This keeps RA compatibility while still preserving raw JSON:API material for advanced uses.

6) **Write sanitization**
- For create/update, only send attributes listed in schema.
- Drop everything else (relationships objects, nested objects, UI-only fields), and warn.
- Source of truth for update id: **request params id**.

7) **Auth provisions (not full auth)**
- Transport accepts an injected `getAuthHeaders()` hook.
- React-admin authProvider integration is planned, but can be implemented after the base is stable.

8) **CLI smoke runner**
- Must validate that an API + admin.yaml combination is healthy without needing a browser.

### 1.2 Explicit non-goals (base milestone)

- JSON:API discovery / schema inference
- SSR
- OpenAPI-first workflows
- Advanced filtering dialects
- Full ORM unit-of-work/change tracking

---

## 2) Architecture

### 2.1 Modules

**Schema**
- `loadAdminYaml` (URL or file)
- `normalizeAdminYaml` → `Schema`
- `resolveApiRoot` (browser fallback rules + placeholder expansion)

**Query**
- `buildListQuery`, `buildOneQuery`, `buildManyQuery`, `buildManyReferenceQuery`

**Transport**
- `createHttpClient(fetch, getAuthHeaders)`
- returns typed JSON and maps JSON:API errors to a dedicated error type

**Normalization**
- `normalizeDocument(doc, options)`
  - builds an identity map (type:id → resource)
  - flattens attributes
  - optionally hydrates relationships and inlines them
  - collision-safe aliasing (`rel_<name>`, suffixes)
- `getTotal(doc, options)`
- `synthesizeCompositeKeys(record, resource, schema)`

**Adapter**
- `createDataProvider({ adminYamlUrl, apiRoot, ... })`

**CLI**
- `safrs-jsonapi-smoke`

### 2.2 Why this split

- It keeps the **core client transport + JSON:API logic** reusable outside React-admin.
- It keeps the RA adapter thin and testable.
- The CLI uses the same primitives as RA, which prevents “two implementations” drift.

---

## 3) Schema model (admin.yaml)

### 3.1 Resource naming

- **endpoint name** = the YAML resource key (e.g. `Order`, `Projects`, `People`)
- **type name** = `resources[endpoint].type` (fallback to endpoint)

No capitalization/pluralization heuristics. The API decides, the yaml reflects it.

### 3.2 Attributes

Base milestone uses attributes primarily as an **allow-list** for writes and (optionally) default sparse fieldsets.

- Store `attributes[]` as **names**.
- Keep raw YAML in `schema.raw` so later improvements can use labels/types/flags.

### 3.3 Relationships

Relationships are driven by `tab_groups`:

- `name` (use relationship name consistently; avoid “tab_group” naming in code)
- `direction`: `toone` | `tomany`
- `targetResource` (the related endpoint name)
- `fks` list

Relationship endpoints are SAFrs-style:

- `/{Resource}/{id}/{relationshipName}`

JSON:API spec distinguishes `links.self` vs `links.related` for relationships.
SAFrs frequently provides only `links.self` and uses it as “related”.
So: when implementing relationship walkers, treat `links.related` as preferred, else fall back to `links.self`.

---

## 4) Runtime configuration rules

### 4.1 admin.yaml URL

Default: `/ui/admin/admin.yaml`

Configurable via:

- `createDataProvider({ adminYamlUrl })`
- CLI: `--admin-yaml <path-or-url>` (canonical)

### 4.2 apiRoot resolution

Rules:

1) If caller provides `apiRoot` / `--api-url`, use it.
2) Else try `admin.yaml.api_root`:
   - if absolute and non-placeholder: use it
   - if it contains placeholders like `{swagger_host}`:
     - resolve using browser `window.location` (protocol/hostname/port)
     - strip default ports 80/443
   - if relative: resolve against browser `window.location.origin`
3) Else browser fallback: `window.location.origin + /api/`
4) **CLI**: if apiRoot is not absolute after (1)(2), fail fast.

`apiRoot` must end with `/` after normalization.

---

## 5) Query rules

### 5.1 Pagination

`page[offset] = (page-1) * perPage`
`page[limit] = perPage`

Default perPage = 10.

### 5.2 Sorting

- Use RA `params.sort` when present.
- Else use `admin.yaml.resources[resource].sort` when present.

### 5.3 Filtering

**Base milestone:**

- Pass through `params.filter` as `filter[field]=value` for non-reserved keys.

**Backlog:**

- `filter.q` semantics and SAFrs filter expression dialect.

(Implementation may already contain a draft `filter.q` builder, but the semantics are explicitly not “stable” yet.)

### 5.4 Includes

Default include set (list/getOne/getManyReference):

- include all schema relationships with `direction=toone`

Then merge:

- `params.meta.include` (string or array; comma-separated supported)
- `+all` expands to all relationships, but **to-many expansion is disabled by default**

### 5.5 Sparse fieldsets

- Support `fields[Type]` via `params.meta.fields`.
- Default sparse fieldset behavior (auto fields from schema) is optional and can be added once the base is stable.

---

## 6) Normalization rules

### 6.1 Flattening

From JSON:API resource `{ id, type, attributes, relationships }` produce:

- `record.id = id`
- `record.ja_type = type`
- `record.attributes = attributes || {}`
- `record.relationships = relationships || {}`
- plus `...attributes` at the top level

### 6.2 Relationship hydration + inlining

Primary path:

- If `relationships[rel].data` exists:
  - `null` → inline `null`
  - identifier object → hydrate using `included` identity map when present, else stub `{id, ja_type}`
  - identifier array → hydrate each (only if to-many inlining enabled)

Fallback path (only when `relationships.data` is missing):

- Use schema FK information to match included resources.
- If match not found: return stubs.

Collision handling:

- If a relationship name collides with an attribute name, inline relationship under `rel_<relationshipName>` (with numeric suffix if needed) and log a warning.

### 6.3 Composite ids

- Some relationships use composite keys.
- The client synthesizes composite id fields using a configurable delimiter (default `_`).
- `getManyReference` splits parent ids only when the schema explicitly defines that composite target.

---

## 7) Writes

### 7.1 Create

Send:

```json
{ "data": { "type": "TypeName", "attributes": { ... } } }
```

Only include schema attributes.

### 7.2 Update

Send:

```json
{ "data": { "type": "TypeName", "id": "<params.id>", "attributes": { ... } } }
```

- Always take id from request params.
- Ignore / drop any id in payload data.

### 7.3 Relationships writes

Not in base milestone.

---

## 8) React-admin adapter

`createDataProvider()` should:

- load `admin.yaml` once
- resolve `apiRoot`
- implement RA methods:
  - `getList`, `getOne`, `getMany`, `getManyReference`, `create`, `update`, `delete`
- (Next step) add `updateMany`, `deleteMany` for bulk actions

---

## 9) CLI smoke runner

Canonical interface:

```bash
safrs-jsonapi-smoke \
  --admin-yaml /path/or/url/to/admin.yaml \
  --api-url https://host.example/api/ \
  --resource Order \
  --limit 1
```

Behavior:

1) Load + normalize admin.yaml
2) Resolve apiRoot (CLI requires explicit api url if api_root not absolute)
3) `getList(limit)` and print `items` + `total`
4) `getOne(first.id)` and print id
5) Pick the **first relationship** present; request `links.related` if present else `links.self`.
6) Non-2xx is a failure (exit code 1).

---

## 10) Backlog (after base is stable)

- Filtering dialect (`filter.q`, operators, OR/AND tuning)
- Relationship walker / “ORM-like” layer:
  - `client.related(record, 'OrderDetailList')`
  - caching / identity map across requests
  - optional lazy loading
- Optional default sparse fieldsets derived from schema
- JSON:API discovery as a schema alternative
- OpenAPI support only if needed
