import { describe, it, expect } from 'vitest'
import { jsonSchemaToTree } from './jsonSchemaToTree'
import type { JSONSchema } from './types'
import { inputCtl } from './controlTestUtils'
import { assertField, assertGroupNode } from './nodeTestUtils'

/**
 * Pins current compiler behavior for keywords/shapes documented in
 * `SUPPORT_CATALOG.md`. Add cases here when catalog claims need evidence;
 * do not change product behavior via these tests.
 */
describe('support catalog — combinator and keyword behavior', () => {
  it('anyOf is ignored — field compiles as untyped string input', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        mode: {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('mode')

    expect(field?.widget).toBe('input')
    expect(field?.facts.primitive).toBe('string')
    expect(field?.facts.choices).toBeUndefined()
    expect(inputCtl(field).attrs.type).toBe('text')
  })

  it('allOf is ignored — constraints on branches are not merged', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        label: {
          allOf: [{ type: 'string', minLength: 2 }, { maxLength: 10 }],
        },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('label')

    expect(field?.widget).toBe('input')
    expect(field?.facts.constraints.minLength).toBeUndefined()
    expect(field?.facts.constraints.maxLength).toBeUndefined()
  })

  it('oneOf without const branches yields radio with zero options', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('value')

    expect(field?.widget).toBe('radio')
    expect(field?.facts.choices).toEqual([])
  })

  it('const keyword alone is ignored — untyped string input', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        fixed: { const: 'always' },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('fixed')

    expect(field?.widget).toBe('input')
    expect(field?.facts.choices).toBeUndefined()
    expect(inputCtl(field).attrs.type).toBe('text')
  })

  it('enum without type still produces choices', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        color: { enum: ['red', 'green', 'blue'] },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('color')

    expect(field?.widget).toBe('radio')
    expect(field?.facts.choices).toHaveLength(3)
  })

  it('array-valued type unions are ignored and fall back to string', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        amount: { type: ['number', 'null'] },
      },
    }

    const form = jsonSchemaToTree(schema)
    const field = form.getField('amount')

    expect(field?.widget).toBe('input')
    expect(field?.facts.primitive).toBe('string')
    expect(inputCtl(field).attrs.type).toBe('text')
  })

  it('object without properties compiles as a leaf field, not a group', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        meta: { type: 'object', title: 'Meta' },
      },
    }

    const form = jsonSchemaToTree(schema)
    const meta = form.children.find((c) => c.path === 'meta')
    assertField(meta)

    expect(meta.widget).toBe('input')
    expect(meta.facts.valueShape).toBe('scalar')
  })

  it('additionalProperties is ignored at compile time', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { type: 'string' },
      properties: {
        name: { type: 'string' },
      },
    }

    const form = jsonSchemaToTree(schema)

    expect(form.children).toHaveLength(1)
    expect(form.getField('name')?.widget).toBe('input')
  })

  it('tuple-style items array throws', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          items: [{ type: 'string' }, { type: 'number' }],
        },
      },
    }

    expect(() => jsonSchemaToTree(schema)).toThrow(/tuple-style 'items'/)
  })

  it('array without items throws', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array' },
      },
    }

    expect(() => jsonSchemaToTree(schema)).toThrow(/must have 'items'/)
  })

  it('boolean items throws', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: true },
      },
    }

    expect(() => jsonSchemaToTree(schema)).toThrow(/boolean 'items'/)
  })

  it('root with properties but no type compiles as a group', () => {
    const schema = {
      properties: {
        name: { type: 'string' },
      },
    } as JSONSchema

    const form = jsonSchemaToTree(schema)
    assertGroupNode(form)
    expect(form.getField('name')?.widget).toBe('input')
  })
})
