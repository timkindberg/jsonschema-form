import type { FormShape, TypedTree } from '@formframe/core'
import { present, defaultPresentation } from '@formframe/core'
import type { JSONSchema, JSONSchemaObject } from './types'
import type { FormShapeOf } from './infer'
import { compileRoot, isObjectSchema } from './compile'
import { resolveLocalRefs } from './resolveRefs'

/**
 * Compile a JSON Schema into the neutral form tree WITHOUT compile-time narrowing
 * (ADR 049) — the runtime door for a schema whose literal shape is not known to the
 * type-checker: a value fetched over the wire, a schema built dynamically at
 * runtime, or any variable typed as the wide `JSONSchema` interface. The returned
 * tree carries the neutral base {@link FormShape} brand, so it still works with
 * `useFormTree` / `useRenderNodeRules` (paths are plain strings and values are
 * `unknown` — no per-path narrowing, which is impossible without a literal type).
 *
 * Prefer {@link jsonSchemaToTree} for a static/inline schema (`as const`): it pins
 * the literal and narrows paths/values/widgets. This is the deliberate escape hatch
 * for the genuinely-dynamic case (bd bh7.10).
 */
export function jsonSchemaToRuntimeTree(
  schema: JSONSchema
): TypedTree<FormShape, JSONSchemaObject> {
  if (!isObjectSchema(schema)) {
    throw new Error('Boolean schemas are not yet supported')
  }

  const resolvedSchema = resolveLocalRefs(schema)

  // The JSON Schema front-end transcribes the resolved schema into the neutral tree
  // (pure structure — it calls Core's neutral builders, ADR 033 §3), then the
  // shipped default presentation runs over it: scalar-choice array containers
  // collapse into one multiselect/checkboxes leaf (ADR 030 §3) and every leaf gets
  // its widget/parts. All *lowering* lives in present(), never the front-end.
  // `useFormTree` re-runs present() with a consumer resolver layered on top,
  // identity-preservingly. The `FormShape` brand is a compile-time phantom
  // (ADR 048 §3) — the runtime value is an ordinary tree, so the cast is honest.
  return present<JSONSchemaObject>(
    compileRoot(resolvedSchema),
    defaultPresentation
  ) as unknown as TypedTree<FormShape, JSONSchemaObject>
}

/**
 * The branded compile error surfaced when a schema carries NO literal type info
 * (bd bh7.10, ADR 049). A schema typed as the wide `JSONSchema`/`JSONSchemaObject`
 * interface — a fetched value, an annotated variable, or a hoisted schema missing
 * `as const` — collapses `FieldPaths<S>` to `never`, which reads at the call site
 * as the inscrutable `Argument of type '"name"' is not assignable to 'never'`. This
 * replaces that with a message that names both fixes (`as const`, or the runtime
 * door), and lands ON THE ARGUMENT.
 */
type SchemaNeedsAsConst =
  'jsonSchemaToTree: this schema has no literal type info, so field paths would collapse to `never`. Add `as const` to the schema (or pass an inline literal). For a fetched/dynamic runtime schema, call `jsonSchemaToRuntimeTree(schema)` instead.'

/**
 * Did `S` lose its literal type info? A narrowed object schema — an inline literal
 * captured by `<const S>`, or a hoisted `as const` — has a **literal** root `type`
 * (e.g. `'object'`). The two ways literal info is lost both fail that test:
 *   - a hoisted schema **missing `as const`** widens `type` to `string`
 *     (`string extends T`), and
 *   - the wide `JSONSchema`/`JSONSchemaObject` interface (a fetched/annotated value)
 *     has an **optional** `type`, so it doesn't match the required-literal pattern
 *     at all → the `false` fall-through.
 * Testing the root `type` (rather than `FieldPaths<S> extends never`) is deliberate:
 * a validly-narrowed but field-less schema (`{ type: 'object' } as const`) keeps its
 * literal `type` and is correctly NOT flagged.
 */
type LacksLiteralType<S> = S extends {
  readonly type: infer T extends string
}
  ? string extends T
    ? true // widened to `string` → hoisted without `as const`
    : false // a literal like `'object'` → genuinely narrowed
  : true // no required literal `type` → the wide interface

/**
 * Guard the parameter: when `S` {@link LacksLiteralType} (a hoisted schema missing
 * `as const`, or a value typed as the wide `JSONSchema` interface), the parameter
 * type becomes the {@link SchemaNeedsAsConst} message so the error is legible and
 * actionable; otherwise it is the schema itself. Inference of `const S` is
 * unaffected — the false branch is naked `S`, so TS still pins the literal for a
 * narrow schema.
 */
type GuardSchema<S> = LacksLiteralType<S> extends true ? SchemaNeedsAsConst : S

/**
 * Compile a JSON Schema into the neutral form tree, branded with its resolved
 * {@link FormShapeOf} (ADR 048). The `const S` capture pins the exact schema
 * literal so paths/values/widgets narrow off it — replacing the old `defineSchema`
 * step: pass an inline schema and React's `useRenderNodeRules(tree, …)` types
 * itself off the brand, importing no front-end.
 *
 * **The schema MUST carry literal type info** — pass an inline object literal, or
 * add `as const` to a hoisted schema (`const schema = { … } as const`). A schema
 * typed as the wide `JSONSchema` interface (a fetched/annotated value, or a hoisted
 * one missing `as const`) would collapse every narrowing to `never`; that case is
 * rejected at compile time with a legible message (bd bh7.10, ADR 049). For a
 * genuinely dynamic/runtime schema, use {@link jsonSchemaToRuntimeTree} instead.
 */
export function jsonSchemaToTree<const S extends JSONSchema>(
  schema: GuardSchema<S>
): TypedTree<FormShapeOf<S>, JSONSchemaObject> {
  // The guard is type-only; at runtime `schema` is an ordinary JSON Schema. The
  // narrowed `FormShapeOf<S>` brand rides the same tree the runtime door builds.
  return jsonSchemaToRuntimeTree(
    schema as unknown as JSONSchema
  ) as unknown as TypedTree<FormShapeOf<S>, JSONSchemaObject>
}
