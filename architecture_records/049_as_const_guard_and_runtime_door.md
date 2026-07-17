# ADR 049: The `as const` narrowing guard, with `jsonSchemaToRuntimeTree` as the runtime door

- **Status:** Accepted
- **Date:** 2026-07-16
- **Builds on:** ADR 048 (front-ends brand the tree with a resolved `FormShape`;
  the `<const S>` capture narrows off the schema literal), ADR 033 (Core is
  schema-agnostic; front-ends compile in), ADR 009 (verification-gated autonomy —
  the guard is enforced by the gate's `tsc` pass).
- **bd:** `jsonschema-form-bh7.10` (epic `jsonschema-form-bh7`)

## Context

`jsonSchemaToTree<const S extends JSONSchema>(schema: S)` (ADR 048 §3) narrows
paths/values/widgets off the schema **literal**. The `<const S>` capture pins an
inline object literal and a hoisted `as const` schema — both keep their literal
type, so `FieldPaths<S>` etc. resolve.

But a schema that reaches the call typed as the **wide `JSONSchema` interface** —
a value fetched over the wire, a variable annotated `: JSONSchema`, or a hoisted
schema missing `as const` — has no literal information left. `FieldPaths<S>` then
collapses to `never`, and the narrowing **silently degrades**: `r.field('name')`
stops type-checking with the inscrutable `Argument of type '"name"' is not
assignable to parameter of type 'never'`, pointing at the call site of a *different*
function than the one that lost the type. The failure is real but illegible, and —
worse — nothing tells the author that `as const` would have fixed it.

Two forces pull apart here:

1. **Static schemas want to fail loud, early, and legibly.** The overwhelmingly
   common case is a literal/`as const` schema; when narrowing is silently lost, the
   author should be told exactly why and how to fix it, at the schema, not deep in a
   downstream `renderNodeRules` call.
2. **Runtime schemas are a first-class mission.** FormFrame explicitly supports
   schemas that are fetched or generated at runtime (the wide-`JSONSchema` case is
   legitimate, not a mistake). Those genuinely *cannot* narrow — there is no literal
   type to narrow off — and must still compile and run.

A single signature cannot serve both: whatever it does for the wide case is either
a silent degrade (bad for #1) or a hard error (bad for #2).

## Decision

**Fork the two intents into two functions, and turn the silent degrade into a
legible compile error on the argument.**

### 1. `jsonSchemaToTree` guards its parameter

```ts
type SchemaNeedsAsConst =
  "jsonSchemaToTree: this schema has no literal type info, so field paths would collapse to `never`. Add `as const` to the schema (or pass an inline literal). For a fetched/dynamic runtime schema, call `jsonSchemaToRuntimeTree(schema)` instead."

type LacksLiteralType<S> = S extends { readonly type: infer T extends string }
  ? string extends T
    ? true // widened to `string` → hoisted without `as const`
    : false // a literal like `'object'` → genuinely narrowed
  : true // no required literal `type` → the wide interface

type GuardSchema<S> = LacksLiteralType<S> extends true ? SchemaNeedsAsConst : S

function jsonSchemaToTree<const S extends JSONSchema>(
  schema: GuardSchema<S>
): TypedTree<FormShapeOf<S>, JSONSchemaObject>
```

The guard keys on **the literal-ness of the root `type`**, which is the single
signal that distinguishes a narrowed schema from a degraded one, and catches *both*
ways literal info is lost:

- a hoisted schema **missing `as const`** widens `type` to `string`
  (`string extends T`), and
- the wide `JSONSchema`/`JSONSchemaObject` interface (a fetched or `: JSONSchema`
  annotated value) has an **optional** `type`, so it never matches the
  required-literal pattern → the `true` fall-through.

In either case the parameter type *becomes the error string*, so the mismatch lands
**on the argument** with an actionable message that names both fixes. For a genuinely
narrowed schema (inline literal captured by `<const S>`, or a hoisted `as const`) the
root `type` is a literal like `'object'`, so the guard is the naked `S` and
`<const S>` inference plus all downstream narrowing are **unchanged** (inert on the
happy path).

Keying on `type` — rather than the tempting `FieldPaths<S> extends never` — is
deliberate: a validly-narrowed but field-less schema (`{ type: 'object' } as const`,
or one that is all groups/arrays) keeps its literal `type` and must NOT be flagged,
even though its `FieldPaths` is `never`.

### 2. `jsonSchemaToRuntimeTree` is the explicit runtime door

```ts
function jsonSchemaToRuntimeTree(
  schema: JSONSchema
): TypedTree<FormShape, JSONSchemaObject>
```

Same runtime behavior (in fact `jsonSchemaToTree` delegates to it), but it accepts
the wide interface and brands the tree with the neutral **base `FormShape`** — paths
are plain `string`, values are `unknown`, no per-path narrowing (which is impossible
without a literal). The returned tree still works with `useFormTree` /
`useRenderNodeRules`; you simply author against string paths. Choosing this function
is the author *saying* "this schema is dynamic," which is exactly the signal the
guard wants — the escape hatch is named, not a cast.

## Consequences

- **The silent narrowing cliff is gone — for both loss modes.** A wide `: JSONSchema`
  value *and* a hoisted schema that forgot `as const` are each a compile error at the
  schema, with a message that names `as const` and the runtime door — instead of a
  `never` (or silently-degraded) error surfacing later in `renderNodeRules`. This
  caught a real latent case in the examples (`App_12`, a hoisted schema without
  `as const`) that the earlier `[JSONSchemaObject] extends [S]` form had missed.
- **Residual (narrow):** the guard proves narrowing off the root `type` only. A
  hand-crafted structural type that keeps a literal `type: 'object'` but has widened
  *field* values would pass the guard yet narrow imperfectly. This is exotic (it
  requires deliberately half-widening a schema type) and out of scope; the common
  loss modes — `: JSONSchema` and missing `as const` — are both closed.
- **The happy path is untouched.** Inline literals and `as const` schemas narrow
  exactly as before (ADR 048); the guard adds zero friction and no new annotations.
- **Runtime schemas keep a first-class, honest path.** `jsonSchemaToRuntimeTree`
  serves the fetched/generated case without pretending to narrow.
- **Call sites split by intent.** Existing runtime-style tests, the Core-level
  examples, and the wide-`JSONSchema` fixtures moved to `jsonSchemaToRuntimeTree`;
  the typed-binding showcases (App17 et al.) stay on `jsonSchemaToTree` with
  `as const`. This makes the intent legible in the code itself.
- **JSON-Schema-specific.** The Zod front-end (`zodToTree`) needs no equivalent: a
  Zod schema variable carries its type inherently (there is no "wide interface"
  collapse), so its narrowing never silently degrades.
- **Cost is a phantom.** `GuardSchema` and the guard are type-only; at runtime
  `jsonSchemaToTree` just delegates to `jsonSchemaToRuntimeTree`, so there is no
  runtime overhead and the brand cast stays honest (ADR 048 §3).
