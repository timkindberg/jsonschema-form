import type { JSONSchema, GroupNode } from '../types'
import { createGroupNode, isObjectSchema } from './groupNode'
import { resolveLocalRefs } from './resolveRefs'
import { present, defaultPresentation } from '../present/present'

export function jsonSchemaToTree(schema: JSONSchema): GroupNode {
  if (!isObjectSchema(schema)) {
    throw new Error('Boolean schemas are not yet supported')
  }

  const resolvedSchema = resolveLocalRefs(schema)

  // Transcribe the schema into the neutral tree (a pure structural front-end),
  // then run the shipped default presentation over it: scalar-choice array
  // containers collapse into one multiselect/checkboxes leaf (ADR 030 §3) and
  // every leaf gets its widget/parts. All *lowering* lives in present(), never
  // the front-end (ADR 033 §2). `useSchemaForm` re-runs present() with a consumer
  // resolver layered on top, identity-preservingly.
  return present(
    createGroupNode('', resolvedSchema, false),
    defaultPresentation
  )
}
