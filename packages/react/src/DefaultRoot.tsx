import React from 'react'
import type { GroupNode } from '@jsonschema-form/core'

export interface DefaultRootProps {
  node: GroupNode
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
}

/**
 * Default root renderer for the form wrapper
 * Renders a <form> element with children and submit button
 */
export function DefaultRoot({ node, onSubmit }: DefaultRootProps) {
  return (
    <form onSubmit={onSubmit}>
      {node.walk()}
      <button type="submit">Submit</button>
    </form>
  )
}

