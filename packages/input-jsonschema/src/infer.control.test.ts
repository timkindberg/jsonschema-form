// Paired type-level + runtime conformance for path-narrowed controls (ADR 047 §4,
// bd y3t + the schema-matrix half of vg1). The control TYPE at a path
// (`ControlAt<S,P>` → routed through `DefaultWidgetAt` (Stage A) →
// `WidgetToControlKind` (Stage B, Core)) must match the control the RUNTIME
// `present()` pipeline actually produces at that path. Each case below asserts
// BOTH: `expectTypeOf<ControlKindAt<S,P>>` AND the runtime
// `jsonSchemaToTree(S).getField(P).parts.control.kind`. Any divergence between
// the Stage A type mirror and the runtime default rule turns this suite red.

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { FieldControl, WidgetName } from '@formframe/core'
import {
  defaultPresentation,
  layered,
  overrideWidgets,
  present,
} from '@formframe/core'
import { jsonSchemaToTree } from './jsonSchemaToTree'
import type {
  ArrayPaths,
  ControlAt,
  ControlKindAt,
  DefaultWidgetAt,
  FieldPaths,
  GroupPaths,
  HasDescription,
  ValueAt,
} from './infer'

const matrix = {
  type: 'object',
  properties: {
    // plain string → input
    name: { type: 'string', title: 'Name' },
    // number → input
    age: { type: 'number', title: 'Age' },
    // enum of 3 (≤5) → radio → choicegroup
    plan: {
      type: 'string',
      title: 'Plan',
      enum: ['free', 'pro', 'enterprise'],
    },
    // enum of 6 (>5) → select
    color: {
      type: 'string',
      title: 'Color',
      enum: ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow'],
    },
    address: {
      type: 'object',
      title: 'Address',
      properties: { street: { type: 'string', title: 'Street' } },
      required: ['street'],
    },
    // scalar-choice array of ≤5 → collapses to ONE checkboxes leaf → choicegroup.
    // A FIELD path (bd bh7.9), NOT an array — Core folds it to a single control.
    roles: {
      type: 'array',
      title: 'Roles',
      items: { enum: ['admin', 'editor', 'viewer'] },
    },
    // scalar-choice array of >5 → collapses to ONE multiselect leaf → select.
    regions: {
      type: 'array',
      title: 'Regions',
      items: { enum: ['na', 'eu', 'apac', 'latam', 'mea', 'anz'] },
    },
    // open-ended array (no item choices) → stays a genuine array path.
    notes: { type: 'array', title: 'Notes', items: { type: 'string' } },
    // a non-empty description → runtime renders a description part → present.
    bio: {
      type: 'string',
      title: 'Bio',
      description: 'Tell us about yourself',
    },
    // an empty-string description → runtime `commonParts` guard drops it → absent.
    empty: { type: 'string', title: 'Empty', description: '' },
  },
  required: ['name'],
} as const

type S = typeof matrix

type KindOfControl<K extends FieldControl['kind']> = K

describe('ControlAt — Stage A type mirror ↔ runtime present() (ADR 047 §4)', () => {
  const tree = jsonSchemaToTree(matrix)

  const cases: {
    path:
      | 'name'
      | 'age'
      | 'plan'
      | 'color'
      | 'address.street'
      | 'roles'
      | 'regions'
    kind: FieldControl['kind']
  }[] = [
    { path: 'name', kind: 'input' },
    { path: 'age', kind: 'input' },
    { path: 'plan', kind: 'choicegroup' },
    { path: 'color', kind: 'select' },
    { path: 'address.street', kind: 'input' },
    // scalar-choice arrays collapse to a single leaf control at runtime (bd bh7.9).
    { path: 'roles', kind: 'choicegroup' },
    { path: 'regions', kind: 'select' },
  ]

  it('runtime control kinds match the default rule', () => {
    for (const { path, kind } of cases) {
      expect(tree.getField(path)?.parts.control.kind).toBe(kind)
    }
  })

  it('type-level ControlKindAt matches the runtime kinds (paired)', () => {
    expectTypeOf<ControlKindAt<S, 'name'>>().toEqualTypeOf<
      KindOfControl<'input'>
    >()
    expectTypeOf<ControlKindAt<S, 'age'>>().toEqualTypeOf<
      KindOfControl<'input'>
    >()
    // The fix the seam exists for: an enum of ≤5 is a radio → choicegroup, NOT a
    // select (the old spike hardcoded enum→select — ADR 047 §4).
    expectTypeOf<ControlKindAt<S, 'plan'>>().toEqualTypeOf<
      KindOfControl<'choicegroup'>
    >()
    expectTypeOf<ControlKindAt<S, 'color'>>().toEqualTypeOf<
      KindOfControl<'select'>
    >()
    expectTypeOf<ControlKindAt<S, 'address.street'>>().toEqualTypeOf<
      KindOfControl<'input'>
    >()
    // Scalar-choice arrays collapse to a leaf: ≤5 → checkboxes → choicegroup,
    // >5 → multiselect → select. Kind and widget stay in lockstep (bd bh7.9).
    expectTypeOf<ControlKindAt<S, 'roles'>>().toEqualTypeOf<
      KindOfControl<'choicegroup'>
    >()
    expectTypeOf<ControlKindAt<S, 'regions'>>().toEqualTypeOf<
      KindOfControl<'select'>
    >()
  })

  it('scalar-choice arrays are field paths, open-ended arrays stay array paths (bd bh7.9)', () => {
    // A collapsed scalar-choice array is a FIELD (Core renders one control).
    expectTypeOf<'roles'>().toExtend<FieldPaths<S>>()
    expectTypeOf<'regions'>().toExtend<FieldPaths<S>>()
    expectTypeOf<'roles'>().not.toExtend<ArrayPaths<S>>()
    // An open-ended array is still an ARRAY (add/remove items), never a field.
    expectTypeOf<'notes'>().toExtend<ArrayPaths<S>>()
    expectTypeOf<'notes'>().not.toExtend<FieldPaths<S>>()
    // No phantom indexed item path for the collapsed array, but the open-ended
    // one still descends to `notes.${number}`.
    expectTypeOf<`roles.${number}`>().not.toExtend<FieldPaths<S>>()
    expectTypeOf<`notes.${number}`>().toExtend<FieldPaths<S>>()
    // The default widget names match the collapsed controls.
    expectTypeOf<DefaultWidgetAt<S, 'roles'>>().toEqualTypeOf<'checkboxes'>()
    expectTypeOf<DefaultWidgetAt<S, 'regions'>>().toEqualTypeOf<'multiselect'>()
  })

  it('ControlAt pre-narrows the FieldControl union member', () => {
    expectTypeOf<ControlAt<S, 'plan'>>().toEqualTypeOf<
      Extract<FieldControl, { kind: 'choicegroup' }>
    >()
    expectTypeOf<ControlAt<S, 'color'>>().toEqualTypeOf<
      Extract<FieldControl, { kind: 'select' }>
    >()
    // A default-widget input path: `control.attrs` is the input attrs, no guard.
    expectTypeOf<ControlAt<S, 'name'>>().toEqualTypeOf<
      Extract<FieldControl, { kind: 'input' }>
    >()
  })

  it('DefaultWidgetAt mirrors the widget names', () => {
    expectTypeOf<DefaultWidgetAt<S, 'plan'>>().toEqualTypeOf<'radio'>()
    expectTypeOf<DefaultWidgetAt<S, 'color'>>().toEqualTypeOf<'select'>()
    expectTypeOf<DefaultWidgetAt<S, 'name'>>().toEqualTypeOf<'input'>()
  })
})

describe('HasDescription tracks the runtime commonParts guard (bd bh7.9)', () => {
  const tree = jsonSchemaToTree(matrix)
  it('runtime renders a description part iff the schema carries a non-empty one', () => {
    // Paired with the type assertions below: `bio` has a real description,
    // `empty` has `''` (falsy → no part), `name` has none.
    expect(tree.getField('bio')?.parts.description).toBeDefined()
    expect(tree.getField('empty')?.parts.description).toBeUndefined()
    expect(tree.getField('name')?.parts.description).toBeUndefined()
  })

  it('type: present for a non-empty literal, absent for missing OR empty-string', () => {
    expectTypeOf<HasDescription<S, 'bio'>>().toEqualTypeOf<true>()
    // Empty string → runtime renders no description part → absent.
    expectTypeOf<HasDescription<S, 'empty'>>().toEqualTypeOf<false>()
    expectTypeOf<HasDescription<S, 'name'>>().toEqualTypeOf<false>()
    // Robust to a widened/branded/union string, not just a literal (bd bh7.9).
    expectTypeOf<
      HasDescription<{ properties: { a: { description: string } } }, 'a'>
    >().toEqualTypeOf<true>()
    expectTypeOf<
      HasDescription<
        { properties: { a: { description: string | undefined } } },
        'a'
      >
    >().toEqualTypeOf<true>()
    // A bare empty-string literal is the one string value that reads as absent.
    expectTypeOf<
      HasDescription<{ properties: { a: { description: '' } } }, 'a'>
    >().toEqualTypeOf<false>()
  })
})

describe('path/kind/value narrowing (ADR 047 §4)', () => {
  it('FieldPaths accepts only leaf paths; GroupPaths only object paths', () => {
    expectTypeOf<'name'>().toExtend<FieldPaths<S>>()
    expectTypeOf<'plan'>().toExtend<FieldPaths<S>>()
    expectTypeOf<'address.street'>().toExtend<FieldPaths<S>>()
    // 'address' is a group, not a field.
    expectTypeOf<'address'>().not.toExtend<FieldPaths<S>>()
    expectTypeOf<'address'>().toExtend<GroupPaths<S>>()
  })

  it('ValueAt reads the schema value type at a path', () => {
    expectTypeOf<ValueAt<S, 'name'>>().toEqualTypeOf<string>()
    expectTypeOf<ValueAt<S, 'age'>>().toEqualTypeOf<number>()
    expectTypeOf<ValueAt<S, 'plan'>>().toEqualTypeOf<
      'free' | 'pro' | 'enterprise'
    >()
  })
})

describe('typed per-path Overrides seam (ADR 047 §4, bd 4bv)', () => {
  // ONE `const` map drives BOTH the runtime resolver and the control TYPE.
  const overrides = {
    name: 'textarea',
    // Re-narrow the >5 enum from a select to a radio (choicegroup).
    color: 'radio',
  } as const satisfies Record<string, WidgetName>

  it('runtime: overrideWidgets re-presents the mapped paths', () => {
    const tree = present(
      jsonSchemaToTree(matrix),
      layered(defaultPresentation, overrideWidgets(overrides))
    )
    // name: input → textarea; color: select → choicegroup; unmapped stays default.
    expect(tree.getField('name')?.parts.control.kind).toBe('textarea')
    expect(tree.getField('color')?.parts.control.kind).toBe('choicegroup')
    expect(tree.getField('age')?.parts.control.kind).toBe('input')
  })

  it('type: ControlKindAt re-narrows with the SAME map (paired)', () => {
    type O = typeof overrides
    expectTypeOf<ControlKindAt<S, 'name', O>>().toEqualTypeOf<
      KindOfControl<'textarea'>
    >()
    expectTypeOf<ControlKindAt<S, 'color', O>>().toEqualTypeOf<
      KindOfControl<'choicegroup'>
    >()
    // An unmapped path still falls to the default rule.
    expectTypeOf<ControlKindAt<S, 'age', O>>().toEqualTypeOf<
      KindOfControl<'input'>
    >()
    // And the pre-narrowed member follows: `name` is now a textarea control.
    expectTypeOf<ControlAt<S, 'name', O>>().toEqualTypeOf<
      Extract<FieldControl, { kind: 'textarea' }>
    >()
  })
})

// Compile-time guardrails: a wrong-kind path is rejected by the split unions.
// @ts-expect-error — 'address' is a group path, not a field path
const _rejectGroupAsField: FieldPaths<S> = 'address'
// @ts-expect-error — 'name' is a field path, not a group path
const _rejectFieldAsGroup: GroupPaths<S> = 'name'
void _rejectGroupAsField
void _rejectFieldAsGroup
