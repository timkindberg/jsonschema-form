import { createFieldNode } from './fieldNode'
import { createGroupNode } from './groupNode'
import { presentDefaultItem } from '../present/present'
import {
  buildValidation,
  type JSONSchemaObject,
  serializeNode,
  walkNode,
} from './utils'
import type {
  AnyNode,
  ArrayNode,
  ArrayParts,
  ArrayItemNode,
  ArrayItemParts,
  ContainerFacts,
  FieldNode,
  ItemDescriptor,
  SelectOption,
  WalkHandlers,
} from './nodeTypes'

/**
 * Transcribe an array schema into an {@link ArrayNode} (ADR 033 §2). The front-end
 * is a pure STRUCTURAL transcriber: it always emits an add/remove ArrayNode and
 * records the neutral facts — a finite `choices` set for a scalar-choice array
 * (enum/oneOf items), or an open-ended `item` descriptor otherwise (choices XOR
 * item). It does NOT collapse: `present()`'s default rule folds a scalar-choice
 * array into one multiselect/checkboxes leaf (ADR 030 §3), so the *lowering*
 * decision lives in one place and every front-end inherits it.
 */
export function createArrayNode(
  path: string,
  schema: JSONSchemaObject,
  required: boolean
): ArrayNode {
  const itemsSchema = schema.items

  // items must be a single schema object (not an array or boolean)
  if (!itemsSchema) {
    throw new Error(`Array schema at ${path} must have 'items' property`)
  }

  if (Array.isArray(itemsSchema)) {
    throw new Error(
      `Array schema at ${path} has tuple-style 'items' (array), which is not yet supported. Use a single schema object.`
    )
  }

  if (typeof itemsSchema === 'boolean') {
    throw new Error(
      `Array schema at ${path} has boolean 'items', which is not supported`
    )
  }

  // Now we know items is a JSONSchemaObject
  const itemSchemaObject = itemsSchema as JSONSchemaObject

  const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0

  // Create initial children based on minItems
  const children: AnyNode[] = []
  for (let i = 0; i < minItems; i++) {
    children.push(createArrayItemNode(path, i, itemSchemaObject, required))
  }

  const parts = {
    container: {
      key: path,
    },
    itemsContainer: {
      key: `${path}-items`,
    },
    addButton: {
      attrs: {
        type: 'button' as const,
      },
      label: schema.title ? `Add ${schema.title}` : 'Add Item',
    },
    ...(schema.title && {
      label: {
        text: schema.title,
      },
    }),
    ...(schema.description && {
      description: {
        text: schema.description,
      },
    }),
  }

  const constraints = buildValidation(schema, required)
  if (typeof schema.minItems === 'number')
    constraints.minItems = schema.minItems
  if (typeof schema.maxItems === 'number')
    constraints.maxItems = schema.maxItems

  // Container facts (ADR 030 §1): a subtree array submits an array value. A finite
  // scalar-choice set (enum/oneOf items) self-identifies as `choices`, which
  // present()'s default rule collapses into one multiselect/checkboxes leaf; an
  // open-ended element source carries an `item` descriptor instead and stays
  // add/remove (a resolver may collapse it, supplying the source via `args` —
  // ADR 030 §4/§5). Choices XOR item.
  const choices = buildArrayChoices(itemSchemaObject)
  const facts: ContainerFacts = {
    path,
    label: schema.title || path || 'root',
    required,
    valueShape: 'array',
    constraints,
    attrs: { id: path, name: path },
    origin: { source: 'jsonschema', schema },
    ...(choices
      ? { choices }
      : { item: buildItemDescriptor(itemSchemaObject) }),
  }
  if (schema.description) facts.description = schema.description

  const arrayNode: ArrayNode = {
    nodeType: 'array',
    path,
    schema,
    widget: 'array',
    facts,
    itemSchema: itemSchemaObject,
    children,

    // Computed properties
    isRoot: path === '',
    depth: path ? path.split('.').length : 0,

    // Parts API
    parts,

    // Factory method for creating items dynamically. The item is presented under
    // the default rule so its nested scalar-choice arrays collapse exactly like
    // the static tree (ADR 030 §3) — the front-end factory emits raw structure,
    // present() does the lowering, here too.
    getItem(index: number) {
      return presentDefaultItem(
        createArrayItemNode(path, index, itemSchemaObject, required)
      )
    },

    // `targetPath` is relative to this array; its leading segment is an item
    // index (ADR 032), e.g. '0.name' or '2'. Resolve to the instantiated item at
    // that index and delegate the remainder. Reads `this.children` (not the
    // closure) so a present()-rebuilt node (ADR 029) queries its own children.
    getField(targetPath: string): FieldNode | undefined {
      if (targetPath === '') return undefined // the array itself is not a field
      const dot = targetPath.indexOf('.')
      const indexSeg = dot === -1 ? targetPath : targetPath.slice(0, dot)
      const rest = dot === -1 ? '' : targetPath.slice(dot + 1)

      const index = Number(indexSeg)
      if (!Number.isInteger(index) || index < 0) return undefined

      const itemPath = `${this.path}.${index}`
      for (const child of this.children) {
        if (child.nodeType === 'arrayItem' && child.path === itemPath) {
          return child.getField(rest)
        }
      }
      return undefined
    },

    getAllFields(): FieldNode[] {
      const fields: FieldNode[] = []
      for (const child of this.children) {
        if (child.nodeType === 'arrayItem') {
          fields.push(...child.getAllFields())
        }
      }
      return fields
    },

    walk<R>(handlers?: WalkHandlers<R>): R[] {
      return walkNode(this, handlers)
    },

    isField: false,
    isGroup: false,
    isArray: true,
    isArrayItem: false,

    toJSON() {
      return serializeNode(this)
    },
  }

  return arrayNode
}

export type { ArrayNode, ArrayParts }

/**
 * Creates an ArrayItemNode that wraps a single array item
 */
export function createArrayItemNode(
  arrayPath: string,
  index: number,
  itemSchema: JSONSchemaObject,
  required: boolean
): ArrayItemNode {
  const itemPath = `${arrayPath}.${index}`

  // Create the child node based on item schema type
  let child: AnyNode

  if (itemSchema.type === 'object' && itemSchema.properties) {
    child = createGroupNode(itemPath, itemSchema, required)
  } else if (itemSchema.type === 'array') {
    // A nested array is just another ArrayNode; if its items are a scalar-choice
    // set, present() collapses that inner array into a multiselect leaf like any
    // other (the front-end no longer special-cases it).
    child = createArrayNode(itemPath, itemSchema, required)
  } else {
    child = createFieldNode(itemPath, itemSchema, required)
  }

  const parts = {
    container: {
      key: itemPath,
    },
    removeButton: {
      attrs: {
        type: 'button' as const,
      },
      label: 'Remove',
    },
  }

  const itemNode: ArrayItemNode = {
    nodeType: 'arrayItem',
    path: itemPath,
    schema: itemSchema,
    widget: 'arrayItem',
    children: [child],

    // Computed properties
    isRoot: false,
    depth: itemPath.split('.').length,

    // Parts API
    parts,

    // `targetPath` is relative to this item (ADR 032). For a primitive-array
    // item the item *is* the leaf, so the empty remainder selects it; for an
    // object/array item, delegate the remainder to the wrapped child.
    getField(targetPath: string): FieldNode | undefined {
      const c = this.children[0]
      if (c.nodeType === 'field') {
        return targetPath === '' ? c : undefined
      } else if (c.nodeType === 'group' || c.nodeType === 'array') {
        return c.getField(targetPath)
      }
      return undefined
    },

    getAllFields(): FieldNode[] {
      const c = this.children[0]
      if (c.nodeType === 'field') {
        return [c]
      } else if (c.nodeType === 'group' || c.nodeType === 'array') {
        return c.getAllFields()
      }
      return []
    },

    walk<R>(handlers?: WalkHandlers<R>): R[] {
      return walkNode(this, handlers)
    },

    isField: false,
    isGroup: false,
    isArray: false,
    isArrayItem: true,

    toJSON() {
      return serializeNode(this)
    },
  }

  return itemNode
}

export type { ArrayItemNode, ArrayItemParts }

/**
 * The neutral {@link ItemDescriptor} for one array element (ADR 030 §1) — thin by
 * design. Object items expose their member `keys` so a resolver can name
 * value/label identity without reading `origin.schema`.
 */
function buildItemDescriptor(itemSchema: JSONSchemaObject): ItemDescriptor {
  if (itemSchema.type === 'object' && itemSchema.properties) {
    return { valueShape: 'object', keys: Object.keys(itemSchema.properties) }
  }
  if (itemSchema.type === 'array') {
    return { valueShape: 'array' }
  }
  return { valueShape: 'scalar' }
}

/**
 * The finite option set of a scalar-choice array (enum/oneOf items), as neutral
 * {@link SelectOption}s, or `undefined` for an open-ended element source. This is
 * what makes present()'s default rule collapse the array into one multiselect (an
 * empty `[]` — e.g. a structural `oneOf` with no `const` branches, bd aml — is
 * still a choice set and still collapses, preserving prior behavior).
 */
function buildArrayChoices(
  itemsSchema: JSONSchemaObject
): SelectOption[] | undefined {
  if (itemsSchema.enum) {
    return (itemsSchema.enum as Array<string | number>).map((value) => ({
      value,
      label: String(value),
    }))
  }
  if (itemsSchema.oneOf) {
    return (
      itemsSchema.oneOf as Array<{ const: string | number; title?: string }>
    )
      .filter((item) => item && typeof item === 'object' && 'const' in item)
      .map((item) => ({
        value: item.const,
        label: item.title || String(item.const),
      }))
  }
  return undefined
}
