import { describe, expectTypeOf, it } from 'vitest'
import type { FieldPath, InferData } from './infer'

const _flatSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
  },
  required: ['name'],
} as const

const _nestedSchema = {
  type: 'object',
  properties: {
    address: {
      type: 'object',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['street'],
    },
  },
} as const

const _arraySchema = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
} as const

const _literalSchema = {
  type: 'object',
  properties: {
    status: { enum: ['active', 'inactive'] as const },
    version: { const: 1 as const },
    note: { type: 'null' },
  },
  required: ['status'],
} as const

type FlatData = InferData<typeof _flatSchema>
type NestedData = InferData<typeof _nestedSchema>
type ArrayData = InferData<typeof _arraySchema>
type LiteralData = InferData<typeof _literalSchema>

type FlatPaths = FieldPath<typeof _flatSchema>
type NestedPaths = FieldPath<typeof _nestedSchema>
type ArrayPaths = FieldPath<typeof _arraySchema>

describe('InferData', () => {
  it('infers a flat object with mixed required and optional keys', () => {
    expectTypeOf<FlatData>().toMatchObjectType<{
      name: string
      age?: number
    }>()
    expectTypeOf<FlatData>().not.toMatchObjectType<{
      name?: string
    }>()
  })

  it('infers nested object shapes with required nested keys', () => {
    type Expected = {
      address?: {
        street: string
        city?: string
      }
    }
    expectTypeOf<NestedData>().toExtend<Expected>()
    expectTypeOf<Expected>().toExtend<NestedData>()
  })

  it('infers arrays of objects', () => {
    type Expected = {
      users?: ReadonlyArray<{
        name: string
      }>
    }
    expectTypeOf<ArrayData>().toExtend<Expected>()
    expectTypeOf<Expected>().toExtend<ArrayData>()
  })

  it('infers enum, const, and null', () => {
    expectTypeOf<LiteralData>().toMatchObjectType<{
      status: 'active' | 'inactive'
      version?: 1
      note?: null
    }>()
    expectTypeOf<LiteralData>().not.toMatchObjectType<{
      status?: 'active' | 'inactive'
    }>()
  })
})

describe('FieldPath', () => {
  it('lists top-level field paths', () => {
    expectTypeOf<FlatPaths>().toEqualTypeOf<'name' | 'age'>()
  })

  it('lists nested dot-paths', () => {
    expectTypeOf<NestedPaths>().toEqualTypeOf<
      'address' | 'address.street' | 'address.city'
    >()
  })

  it('lists array item field paths under the array prefix', () => {
    expectTypeOf<ArrayPaths>().toEqualTypeOf<'users' | 'users.name'>()
  })
})

type _InvalidFlatPath = FieldPath<typeof _flatSchema>
// @ts-expect-error -- path does not exist on schema
const _rejectUnknownTopLevel: _InvalidFlatPath = 'missing'
// @ts-expect-error -- nested segment does not exist
const _rejectUnknownNested: FieldPath<typeof _nestedSchema> = 'address.zip'
