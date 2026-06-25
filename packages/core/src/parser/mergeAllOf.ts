import type { JSONSchemaObject } from './utils'

/**
 * Merge JSON Schema `allOf` object-composition into a single schema before tree
 * compilation. Intended to run after `$ref` resolution so sibling keywords are
 * already inlined; `$ref` entries inside `allOf` arrays are resolved here against
 * the document root because the ref pass does not walk `allOf`.
 *
 * ## Merged keywords
 *
 * - `properties` — union; duplicate keys are merged recursively.
 * - `required` — union, deduplicated (stable order: first seen wins).
 * - `type` — must agree across merged schemas; conflicting types throw.
 *
 * ## Scalar / constraint precedence
 *
 * When the same keyword appears in both schemas being merged:
 *
 * - **Most restrictive** (tightest intersection): `minLength`, `minimum`, `minItems`
 *   take the larger bound; `maxLength`, `maximum`, `maxItems` take the smaller bound.
 * - **Last-wins** (later schema in merge order): `title`, `description`, `format`,
 *   and other presentational keywords.
 * - **`pattern`**: if both sides define a pattern and they differ, throw; otherwise
 *   keep the single defined value.
 * - **`enum`**: if both sides define `enum`, keep values present in both lists; an
 *   empty intersection throws.
 *
 * `$defs` / `definitions` on `allOf` branches are ignored — refs should already be
 * resolved. Top-level `$defs` on the root schema are preserved unchanged.
 *
 * Does not handle `anyOf`, `oneOf`, `if`/`then`/`else`.
 */
export function mergeAllOf(schema: JSONSchemaObject): JSONSchemaObject {
  return mergeAllOfWithRoot(schema, schema)
}

function mergeAllOfWithRoot(
  schema: JSONSchemaObject,
  root: JSONSchemaObject
): JSONSchemaObject {
  const withMergedChildren = mergeAllOfInChildren(schema, root)
  return flattenAllOf(withMergedChildren, root)
}

function mergeAllOfInChildren(
  schema: JSONSchemaObject,
  root: JSONSchemaObject
): JSONSchemaObject {
  let changed = false
  const result: JSONSchemaObject = { ...schema }

  if (schema.allOf) {
    const resolvedAllOf = schema.allOf.map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('allOf entries must be object schemas')
      }
      const resolvedEntry = resolveAllOfEntry(entry as JSONSchemaObject, root)
      return mergeAllOfWithRoot(resolvedEntry, root)
    })
    result.allOf = resolvedAllOf
    changed = true
  }

  if (schema.properties) {
    const properties: NonNullable<JSONSchemaObject['properties']> = {}
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === 'object' && propSchema !== null) {
        const mergedProp = mergeAllOfWithRoot(
          propSchema as JSONSchemaObject,
          root
        )
        properties[key] = mergedProp
        if (mergedProp !== propSchema) {
          changed = true
        }
      } else {
        properties[key] = propSchema
      }
    }
    if (changed) {
      result.properties = properties
    }
  }

  const items = schema.items
  if (
    items &&
    typeof items === 'object' &&
    !Array.isArray(items) &&
    items !== null
  ) {
    const mergedItems = mergeAllOfWithRoot(items as JSONSchemaObject, root)
    if (mergedItems !== items) {
      result.items = mergedItems
      changed = true
    }
  }

  return changed ? result : schema
}

function flattenAllOf(
  schema: JSONSchemaObject,
  root: JSONSchemaObject
): JSONSchemaObject {
  const allOf = schema.allOf
  if (!allOf || allOf.length === 0) {
    return schema
  }

  const { allOf: _allOf, ...rest } = schema
  let merged: JSONSchemaObject = { ...rest }

  for (const entry of allOf) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('allOf entries must be object schemas')
    }
    const resolvedEntry = resolveAllOfEntry(entry as JSONSchemaObject, root)
    merged = mergeSchemas(
      merged,
      flattenAllOf(mergeAllOfWithRoot(resolvedEntry, root), root)
    )
  }

  return merged
}

function resolveAllOfEntry(
  entry: JSONSchemaObject,
  root: JSONSchemaObject
): JSONSchemaObject {
  if (typeof entry.$ref !== 'string') {
    return entry
  }

  const ref = entry.$ref
  if (!ref.startsWith('#')) {
    throw new Error(`External $ref is not supported: ${ref}`)
  }

  const { $ref: _ref, ...siblings } = entry
  const target = resolveJsonPointer(root, ref)
  return Object.keys(siblings).length > 0
    ? ({ ...target, ...siblings } as JSONSchemaObject)
    : target
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolveJsonPointer(
  root: JSONSchemaObject,
  pointer: string
): JSONSchemaObject {
  if (pointer === '#') {
    return root
  }

  if (!pointer.startsWith('#/')) {
    throw new Error(`Invalid local JSON Pointer $ref: ${pointer}`)
  }

  const segments = pointer
    .slice(2)
    .split('/')
    .map(decodeJsonPointerSegment)

  let current: unknown = root
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`$ref target not found: ${pointer}`)
    }
    current = (current as Record<string, unknown>)[segment]
    if (current === undefined) {
      throw new Error(`$ref target not found: ${pointer}`)
    }
  }

  if (typeof current !== 'object' || current === null) {
    throw new Error(`$ref target must be an object schema: ${pointer}`)
  }

  return current as JSONSchemaObject
}

function mergeSchemas(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): JSONSchemaObject {
  const result: JSONSchemaObject = { ...base }

  mergeType(result, overlay)
  mergeProperties(result, overlay)
  mergeRequired(result, overlay)
  mergeRestrictiveNumber('minLength', Math.max, result, overlay)
  mergeRestrictiveNumber('maxLength', Math.min, result, overlay)
  mergeRestrictiveNumber('minimum', Math.max, result, overlay)
  mergeRestrictiveNumber('maximum', Math.min, result, overlay)
  mergeRestrictiveNumber('minItems', Math.max, result, overlay)
  mergeRestrictiveNumber('maxItems', Math.min, result, overlay)
  mergePattern(result, overlay)
  mergeEnum(result, overlay)
  mergeLastWinsString('title', result, overlay)
  mergeLastWinsString('description', result, overlay)
  mergeLastWinsString('format', result, overlay)

  return result
}

function mergeType(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const baseType = base.type
  const overlayType = overlay.type

  if (baseType === undefined) {
    if (overlayType !== undefined) {
      base.type = overlayType
    }
    return
  }

  if (overlayType === undefined) {
    return
  }

  if (baseType !== overlayType) {
    throw new Error(
      `Conflicting type in allOf merge: ${String(baseType)} vs ${String(overlayType)}`
    )
  }
}

function mergeProperties(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const overlayProperties = overlay.properties
  if (!overlayProperties) {
    return
  }

  const mergedProperties: NonNullable<JSONSchemaObject['properties']> = {
    ...(base.properties ?? {}),
  }

  for (const [key, overlayProp] of Object.entries(overlayProperties)) {
    const baseProp = mergedProperties[key]
    if (
      baseProp !== undefined &&
      typeof baseProp === 'object' &&
      baseProp !== null &&
      typeof overlayProp === 'object' &&
      overlayProp !== null
    ) {
      mergedProperties[key] = mergeSchemas(
        baseProp as JSONSchemaObject,
        overlayProp as JSONSchemaObject
      )
    } else {
      mergedProperties[key] = overlayProp
    }
  }

  base.properties = mergedProperties
}

function mergeRequired(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const overlayRequired = overlay.required
  if (!overlayRequired || overlayRequired.length === 0) {
    return
  }

  const seen = new Set(base.required ?? [])
  const merged = [...(base.required ?? [])]

  for (const name of overlayRequired) {
    if (!seen.has(name)) {
      seen.add(name)
      merged.push(name)
    }
  }

  base.required = merged
}

function mergeRestrictiveNumber(
  key: 'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'minItems' | 'maxItems',
  combine: (a: number, b: number) => number,
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const baseValue = base[key]
  const overlayValue = overlay[key]

  if (baseValue === undefined) {
    if (overlayValue !== undefined) {
      base[key] = overlayValue
    }
    return
  }

  if (overlayValue === undefined) {
    return
  }

  base[key] = combine(baseValue, overlayValue)
}

function mergePattern(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const basePattern = base.pattern
  const overlayPattern = overlay.pattern

  if (basePattern === undefined) {
    if (overlayPattern !== undefined) {
      base.pattern = overlayPattern
    }
    return
  }

  if (overlayPattern === undefined) {
    return
  }

  if (basePattern !== overlayPattern) {
    throw new Error(
      `Conflicting pattern in allOf merge: ${basePattern} vs ${overlayPattern}`
    )
  }
}

function mergeEnum(
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const baseEnum = base.enum
  const overlayEnum = overlay.enum

  if (baseEnum === undefined) {
    if (overlayEnum !== undefined) {
      base.enum = overlayEnum
    }
    return
  }

  if (overlayEnum === undefined) {
    return
  }

  const overlaySet = new Set(overlayEnum)
  const intersection = baseEnum.filter((value) => overlaySet.has(value))

  if (intersection.length === 0) {
    throw new Error('Conflicting enum in allOf merge: empty intersection')
  }

  base.enum = intersection
}

function mergeLastWinsString(
  key: 'title' | 'description' | 'format',
  base: JSONSchemaObject,
  overlay: JSONSchemaObject
): void {
  const overlayValue = overlay[key]
  if (overlayValue !== undefined) {
    base[key] = overlayValue
  }
}
