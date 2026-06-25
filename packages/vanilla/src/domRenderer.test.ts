// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { jsonSchemaToTree } from '@jsonschema-form/core'
import type { JSONSchema } from '@jsonschema-form/core'
import { renderToString } from './renderToString'
import {
  renderToDom,
  createDomRenderer,
  defaultDomAdapter,
  serializeDomToOracleHtml,
} from './domRenderer'

const representativeSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    email: { type: 'string', format: 'email', title: 'Email' },
    color: { type: 'string', title: 'Color', enum: ['red', 'green'] },
    address: {
      type: 'object',
      title: 'Address',
      properties: {
        street: { type: 'string', title: 'Street' },
      },
    },
  },
  required: ['name'],
}

const paritySchemas: Record<string, JSONSchema> = {
  representative: representativeSchema,
  'flat fields + select': {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name' },
      color: { type: 'string', title: 'Color', enum: ['red', 'green'] },
    },
    required: ['name'],
  },
  'every input widget + validation attrs': {
    type: 'object',
    properties: {
      handle: { type: 'string', title: 'Handle', minLength: 3, maxLength: 20 },
      email: { type: 'string', format: 'email', title: 'Email' },
      age: { type: 'number', title: 'Age', minimum: 0, maximum: 120 },
      count: { type: 'integer', title: 'Count' },
      agree: { type: 'boolean', title: 'Agree' },
    },
    required: ['handle', 'email'],
  },
  'nested group': {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email', title: 'Email' },
      address: {
        type: 'object',
        title: 'Address',
        description: 'Where you live',
        properties: {
          street: { type: 'string', title: 'Street' },
          zip: { type: 'string', title: 'Zip' },
        },
      },
    },
    required: ['email'],
  },
  'array of objects (minItems renders an item)': {
    type: 'object',
    properties: {
      contacts: {
        type: 'array',
        title: 'Contacts',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Contact name' },
          },
        },
      },
    },
  },
}

describe('renderToDom — DOM ≡ string oracle parity', () => {
  for (const [name, schema] of Object.entries(paritySchemas)) {
    it(`matches renderToString for "${name}"`, () => {
      const form = jsonSchemaToTree(schema)
      const expected = renderToString(form)
      const actual = serializeDomToOracleHtml(renderToDom(form))
      expect(actual).toBe(expected)
    })
  }
})

describe('renderToDom — real DOM nodes', () => {
  it('returns a DocumentFragment of field elements for the default schema', () => {
    const form = jsonSchemaToTree(representativeSchema)
    const root = renderToDom(form)
    expect(root.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE)
    expect(root.childNodes.length).toBeGreaterThan(0)
    const first = root.firstChild as HTMLElement
    expect(first.tagName).toBe('DIV')
    expect(first.className).toBe('jsf-field')
  })

  it('createDomRenderer(defaultDomAdapter) matches batteries renderToDom', () => {
    const form = jsonSchemaToTree(representativeSchema)
    const render = createDomRenderer(defaultDomAdapter)
    expect(serializeDomToOracleHtml(render(form))).toBe(
      serializeDomToOracleHtml(renderToDom(form))
    )
  })
})
