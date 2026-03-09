# Compatibility Contract (Base Milestone)

Data provider records returned by this package must preserve this shape:

- `id` (string)
- `ja_type` (JSON:API type)
- `attributes` (raw JSON:API attributes object)
- `relationships` (raw JSON:API relationships object; empty object when absent)
- flattened attributes at top-level (`record.<attr>`)
- optional inlined relationships at `record.<relationshipName>`

Relationship inlining policy:

- to-one relationships are included by default for list/getOne/getManyReference unless disabled by schema `disable_autoload`
- to-many relationships are explicit-only via `meta.include`

Collision behavior:

- if an attribute key collides with an inlined relationship key, keep the attribute
- inline relationship under `rel_<relationshipName>`
- if that alias exists, use deterministic suffixes (`rel_<name>_1`, `_2`, ...)
- emit a warning
