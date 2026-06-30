import type { JSONSchema, GroupNode } from '../types'
import { createGroupNode, isObjectSchema } from './groupNode'
import { mergeAllOf } from './mergeAllOf'
import { resolveLocalRefs } from './resolveRefs'

export function jsonSchemaToTree(schema: JSONSchema): GroupNode {
  if (!isObjectSchema(schema)) {
    throw new Error('Boolean schemas are not yet supported')
  }

  const resolvedSchema = resolveLocalRefs(schema)
  const mergedSchema = mergeAllOf(resolvedSchema)

  // Root is just a GroupNode with empty path
  return createGroupNode('', mergedSchema, false)
}
