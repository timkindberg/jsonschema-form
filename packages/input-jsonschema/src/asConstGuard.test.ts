// The `as const` compile guard (bd bh7.10, ADR 049). `jsonSchemaToTree` narrows
// paths/values/widgets off the schema LITERAL; a schema that reached it typed as the
// wide `JSONSchema` interface (a fetched value, an annotated variable, or a hoisted
// one missing `as const`) would collapse every narrowing to `never`. Rather than
// degrade silently, the parameter is guarded so the wide case is a legible compile
// error ON THE ARGUMENT — and `jsonSchemaToRuntimeTree` is the explicit door for the
// genuinely-dynamic case. This suite pins BOTH edges of that fork. Enforced by the
// gate's tsc pass; the `@ts-expect-error` line is itself the assertion.

import { describe, expectTypeOf, it } from 'vitest'
import type { FormShape, TreeShapeOf } from '@formframe/core'
import { jsonSchemaToTree, jsonSchemaToRuntimeTree } from './jsonSchemaToTree'
import type { JSONSchema } from './types'

const wideSchema: JSONSchema = {
  type: 'object',
  properties: { name: { type: 'string', title: 'Name' } },
}

const literalSchema = {
  type: 'object',
  properties: { name: { type: 'string', title: 'Name' } },
} as const

describe('as const guard (bh7.10)', () => {
  it('narrows off an inline literal — the shape is NOT the neutral base', () => {
    const _tree = jsonSchemaToTree({
      type: 'object',
      properties: { name: { type: 'string', title: 'Name' } },
    })
    expectTypeOf<TreeShapeOf<typeof _tree>>().not.toEqualTypeOf<FormShape>()
  })

  it('narrows off a hoisted `as const` schema', () => {
    const _tree = jsonSchemaToTree(literalSchema)
    expectTypeOf<TreeShapeOf<typeof _tree>>().not.toEqualTypeOf<FormShape>()
  })

  it('REJECTS a schema typed as the wide `JSONSchema` interface', () => {
    // @ts-expect-error bh7.10: a wide-typed schema would collapse paths to `never`;
    // the guard turns that silent degrade into a legible compile error naming both
    // fixes. Use `jsonSchemaToRuntimeTree` instead (asserted below).
    jsonSchemaToTree(wideSchema)
  })

  it('REJECTS a hoisted schema that forgot `as const` (widened `type`)', () => {
    // No `as const` and no annotation: `type` widens to `string`, so narrowing would
    // silently degrade. bh7.10's guard catches this too — exactly the case its
    // message names ("Add `as const` …"), not just the bare-interface case.
    const forgotAsConst = {
      type: 'object',
      properties: { name: { type: 'string', title: 'Name' } },
    }
    // @ts-expect-error bh7.10: hoisted-without-`as const` lost its literal `type`.
    jsonSchemaToTree(forgotAsConst)
  })

  it('accepts the same wide schema through the runtime door (base brand)', () => {
    const _tree = jsonSchemaToRuntimeTree(wideSchema)
    expectTypeOf<TreeShapeOf<typeof _tree>>().toEqualTypeOf<FormShape>()
  })
})
