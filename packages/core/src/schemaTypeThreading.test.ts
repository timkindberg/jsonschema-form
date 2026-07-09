// Type-level tests for the schema type `S` threading (bd wo8, ADR 033 §4).
//
// These are TYPE tests: they assert nothing at runtime (the `it` bodies are empty
// once type-erased). They are enforced by the gate's `tsc --noEmit -p
// tsconfig.test.json` pass — a wrong assertion is a compile error, so they cost
// zero runtime yet fail the build if `S` ever regresses.
//
// What wo8 guarantees, and what it deliberately does NOT:
//
//   * GUARANTEE — `S` is PRESERVED (not erased to `unknown`) across `walk` and the
//     continuation engine. A consumer that pins `S` (e.g. the JSON Schema
//     front-end pins `JSONSchemaObject`) reads a typed `facts.origin.schema` on
//     every handler/resolver node instead of `unknown`.
//   * NON-GOAL — per-node NARROWING. `S` is UNIFORM: every node in the tree — root,
//     nested group, deep leaf — carries the SAME `S`. A leaf does NOT get its own
//     specific subschema type. That is structurally impossible via `walk`
//     (homogeneous recursion over `AnyNode<S>[]` has one element type) and would
//     require a separate path-literal-indexed accessor over the whole schema
//     literal (the `FieldPath`/`InferData` family) — an opt-in front-end feature,
//     not a Core-walk one. The "uniform, not narrowed" tests below pin that line.

import { describe, it, expectTypeOf } from 'vitest'
import type {
  AnyNode,
  ArrayItemNode,
  ArrayNode,
  FieldNode,
  GroupNode,
  WalkHandlers,
  ENode,
  EField,
  EGroup,
  EArray,
  Resolver,
  Continuation,
  AnyGroupNode,
  AnyTreeNode,
  AnySchemaResolver,
} from './index'

// A branded stand-in for a front-end's origin schema. Core is schema-agnostic, so
// the tests never import a real schema type — an opaque brand proves threading
// without coupling Core to JSON Schema or Zod.
interface FakeSchema {
  readonly brand: 'fake-schema'
}
type R = string // an arbitrary render-result type for the continuation

// Convenience extractors for a handler's positional param types.
type WalkParam<K extends keyof WalkHandlers<R, FakeSchema>, S> = Parameters<
  NonNullable<WalkHandlers<R, S>[K]>
>[0]

describe('walk threads S (bd wo8)', () => {
  it('each handler receives its node kind carrying the SAME S', () => {
    expectTypeOf<WalkParam<'field', FakeSchema>>().toEqualTypeOf<
      FieldNode<FakeSchema>
    >()
    expectTypeOf<WalkParam<'group', FakeSchema>>().toEqualTypeOf<
      GroupNode<FakeSchema>
    >()
    expectTypeOf<WalkParam<'array', FakeSchema>>().toEqualTypeOf<
      ArrayNode<FakeSchema>
    >()
    expectTypeOf<WalkParam<'arrayItem', FakeSchema>>().toEqualTypeOf<
      ArrayItemNode<FakeSchema>
    >()
  })

  it('the handler node exposes a TYPED origin.schema (not unknown)', () => {
    expectTypeOf<
      WalkParam<'field', FakeSchema>['facts']['origin']['schema']
    >().toEqualTypeOf<FakeSchema>()
  })

  it('the second handler arg is WalkHandlers<R, S> (S propagates to re-entry)', () => {
    expectTypeOf<
      Parameters<NonNullable<WalkHandlers<R, FakeSchema>['field']>>[1]
    >().toEqualTypeOf<WalkHandlers<R, FakeSchema>>()
  })

  it('S defaults to unknown when unspecified (back-compat with untyped callers)', () => {
    expectTypeOf<WalkHandlers<R>>().toEqualTypeOf<WalkHandlers<R, unknown>>()
    expectTypeOf<
      WalkParam<'field', unknown>['facts']['origin']['schema']
    >().toEqualTypeOf<unknown>()
  })

  it('walk() on a specialized tree narrows the callback node to <S>', () => {
    const group = {} as GroupNode<FakeSchema>
    const out = group.walk<R>({
      field: (node) => {
        expectTypeOf(node).toEqualTypeOf<FieldNode<FakeSchema>>()
        expectTypeOf(node.facts.origin.schema).toEqualTypeOf<FakeSchema>()
        return ''
      },
    })
    expectTypeOf(out).toEqualTypeOf<R[]>()
  })
})

describe('query methods thread S', () => {
  const group = {} as GroupNode<FakeSchema>
  const array = {} as ArrayNode<FakeSchema>

  it('getField / getAllFields return FieldNode<S>', () => {
    expectTypeOf(group.getField('x')).toEqualTypeOf<
      FieldNode<FakeSchema> | undefined
    >()
    expectTypeOf(group.getAllFields()).toEqualTypeOf<FieldNode<FakeSchema>[]>()
  })

  it('getItem returns ArrayItemNode<S>', () => {
    expectTypeOf(array.getItem(0)).toEqualTypeOf<ArrayItemNode<FakeSchema>>()
  })
})

describe('S is UNIFORM, not narrowed per node (the wo8 boundary)', () => {
  // The direct answer to "does a nested leaf get its own subschema type?": no.
  // Every accessor at every depth yields the SAME `S`. Per-node narrowing would
  // need a path-literal accessor (`getField<'a.b.c'>()` → subschema-at-path), a
  // separate front-end feature layered on FieldPath/InferData — not wo8.
  const group = {} as GroupNode<FakeSchema>

  it('children carry the same S as the root', () => {
    expectTypeOf<GroupNode<FakeSchema>['children'][number]>().toEqualTypeOf<
      AnyNode<FakeSchema>
    >()
  })

  it('a deep getField still yields FieldNode<FakeSchema>, not a subschema', () => {
    // `getField` takes a runtime `string`, so it CANNOT index a literal path into
    // the schema — it returns the uniform node type by construction.
    expectTypeOf(group.getField('user.address.zip')).toEqualTypeOf<
      FieldNode<FakeSchema> | undefined
    >()
  })
})

describe('continuation engine threads S (bd wo8)', () => {
  it('Resolver<R, S> receives ENode<R, S>', () => {
    expectTypeOf<Parameters<Resolver<R, FakeSchema>>[0]>().toEqualTypeOf<
      ENode<R, FakeSchema>
    >()
  })

  it('an enriched field exposes a typed origin.schema', () => {
    expectTypeOf<
      EField<R, FakeSchema>['facts']['origin']['schema']
    >().toEqualTypeOf<FakeSchema>()
  })

  it('enriched container children and child() carry <S>', () => {
    expectTypeOf<EGroup<R, FakeSchema>['children'][string]>().toEqualTypeOf<
      ENode<R, FakeSchema>
    >()
    expectTypeOf<ReturnType<EGroup<R, FakeSchema>['child']>>().toEqualTypeOf<
      ENode<R, FakeSchema> | undefined
    >()
  })

  it('EArray.renderItem accepts ArrayItemNode<S>', () => {
    expectTypeOf<
      Parameters<EArray<R, FakeSchema>['renderItem']>[0]
    >().toEqualTypeOf<ArrayItemNode<FakeSchema>>()
  })

  it('ENode / Resolver default S to unknown', () => {
    expectTypeOf<ENode<R>>().toEqualTypeOf<ENode<R, unknown>>()
    expectTypeOf<Resolver<R>>().toEqualTypeOf<Resolver<R, unknown>>()
    expectTypeOf<
      EField<R>['facts']['origin']['schema']
    >().toEqualTypeOf<unknown>()
  })

  it('enrich/resolve preserve S from the node + resolver', () => {
    const cont = {} as Continuation<R>
    const node = {} as AnyNode<FakeSchema>
    const resolver = (() => '') as Resolver<R, FakeSchema>
    expectTypeOf(cont.enrich(node, resolver)).toEqualTypeOf<
      ENode<R, FakeSchema>
    >()
    expectTypeOf(cont.resolve(node, resolver)).toEqualTypeOf<R>()
  })
})

// --- Variance + the boundary aliases (why AnyGroupNode/AnyTreeNode exist) --------
//
// Direct assignment tests (unambiguous, unlike expect-type's `.toExtend` on
// unions). A `@ts-expect-error` that stops erroring is itself a build failure, so
// these pin the variance exactly.

declare const specializedField: FieldNode<FakeSchema>
declare const specializedGroup: GroupNode<FakeSchema>
declare const specializedArray: ArrayNode<FakeSchema>
declare const specializedNode: AnyNode<FakeSchema>

// FieldNode is COVARIANT in S (S only appears in the covariant `facts.origin.schema`
// position) — a specialized field widens to the unknown-typed one.
const _widenedField: FieldNode<unknown> = specializedField

// GroupNode / ArrayNode / AnyNode are INVARIANT in S: `S` sits in a covariant
// return (`getField(): FieldNode<S>`) AND a contravariant param
// (`walk(WalkHandlers<R, S>)`), so a specialized tree is NOT assignable to the
// unknown-typed one. This is exactly the friction the boundary aliases resolve.
// @ts-expect-error -- GroupNode is invariant in S
const _widenedGroup: GroupNode<unknown> = specializedGroup
// @ts-expect-error -- ArrayNode is invariant in S
const _widenedArray: ArrayNode<unknown> = specializedArray
// @ts-expect-error -- AnyNode is invariant in S
const _widenedNode: AnyNode<unknown> = specializedNode

// The boundary aliases (GroupNode<any> / AnyNode<any>) accept a front-end-
// specialized tree, so a schema-agnostic renderer can take one parameter type.
const _viaGroupAlias: AnyGroupNode = specializedGroup
const _viaTreeAlias: AnyTreeNode = specializedNode

// AnySchemaResolver<R> = Resolver<R, any> bridges the boundary both ways (a
// resolver that ignores origin.schema is usable at any S).
declare const anyResolver: AnySchemaResolver<R>
const _asSpecializedResolver: Resolver<R, FakeSchema> = anyResolver
const _asUnknownResolver: Resolver<R> = anyResolver

describe('variance + boundary aliases', () => {
  it('references the assignment probes so the module is a live spec', () => {
    // Touch the bindings so they are not dead code; the real assertions are the
    // (non-)errors above, checked by tsc.
    expectTypeOf(_widenedField).toEqualTypeOf<FieldNode<unknown>>()
    expectTypeOf(_widenedGroup).toEqualTypeOf<GroupNode<unknown>>()
    expectTypeOf(_widenedArray).toEqualTypeOf<ArrayNode<unknown>>()
    expectTypeOf(_widenedNode).toEqualTypeOf<AnyNode<unknown>>()
    expectTypeOf(_viaGroupAlias).toEqualTypeOf<AnyGroupNode>()
    expectTypeOf(_viaTreeAlias).toEqualTypeOf<AnyTreeNode>()
    expectTypeOf(_asSpecializedResolver).toEqualTypeOf<
      Resolver<R, FakeSchema>
    >()
    expectTypeOf(_asUnknownResolver).toEqualTypeOf<Resolver<R>>()
  })
})
