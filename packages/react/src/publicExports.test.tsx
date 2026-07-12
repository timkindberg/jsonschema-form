// Package-root export surface — drift guard for continuation handles (ADR 017).
// Imports MUST come from '@jsonschema-form/react', never deep paths.

import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { jsonSchemaToTree } from '@jsonschema-form/input-jsonschema'
import type { JSONSchema } from '@jsonschema-form/input-jsonschema'
import {
  Default,
  Children,
  SchemaFields,
  type RenderHelpers,
  type RenderNode,
} from '@jsonschema-form/react'

const schema: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    address: {
      type: 'object',
      properties: { street: { type: 'string', title: 'Street' } },
    },
  },
}

describe('package root exports — continuation handles', () => {
  it('exports Default, Children, and RenderHelpers-related types from the package root', () => {
    expect(typeof Default).toBe('function')
    expect(typeof Children).toBe('function')
    // Compile-time: RenderNode / RenderHelpers are part of the public surface.
    const _renderNode: RenderNode = (node, _helpers: RenderHelpers) => (
      <Default of={node} />
    )
    expect(_renderNode).toBeTypeOf('function')
  })

  it('injected helpers match the package-root Default and Children exports', async () => {
    const form = jsonSchemaToTree(schema)
    const screen = await render(
      <SchemaFields
        form={form}
        renderNode={(node, helpers) => {
          expect(helpers.Default).toBe(Default)
          expect(helpers.Children).toBe(Children)
          return <Default of={node} />
        }}
      />
    )
    await expect
      .element(screen.getByRole('textbox', { name: 'Name' }))
      .toBeInTheDocument()
  })
})
