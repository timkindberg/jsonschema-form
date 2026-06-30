import Ajv, { type ErrorObject, type Options as AjvOptions } from 'ajv'
import addFormats from 'ajv-formats'
import type {
  JSONSchema,
  Validator,
  ValidationIssue,
  InferData,
} from '@jsonschema-form/core'

export interface AjvValidatorOptions {
  /**
   * Extra AJV options, merged over the adapter defaults
   * (`allErrors: true`, `strict: false`). Use to pass custom keywords, formats,
   * or a stricter mode if your schemas warrant it.
   */
  ajv?: AjvOptions
  /**
   * Register the standard `ajv-formats` vocabulary (`email`, `uri`, `date`, …).
   * Defaults to `true`; set `false` to leave `format` unhandled or register your
   * own formats via {@link AjvValidatorOptions.ajv}.
   */
  formats?: boolean
}

/**
 * Build a {@link Validator} (ADR 019) backed by AJV. The schema is compiled once;
 * the returned function validates data and returns issues keyed by the same
 * dot-path as `node.path`, so a renderer can map each issue straight to its field.
 *
 * Defaults suit form data: `allErrors` (collect every problem, not just the
 * first), `strict: false` (form schemas lean on annotations like
 * `title`/`description` and `oneOf`, which strict mode is fussy about), and
 * `coerceTypes: true` — native FormData is all strings, so a `number`/`integer`/
 * `boolean` field would otherwise spuriously fail its type check. Coercion
 * normalizes the validated object in place; override via `options.ajv`.
 *
 * The standard `ajv-formats` vocabulary (`email`, `uri`, `date`, `uuid`, …) is
 * registered by default — AJV v8 ignores `format` otherwise, so an
 * `{ format: 'email' }` field would silently never fail. Skip it with
 * `options.formats: false` if you register your own.
 *
 * Per the {@link Validator} purity invariant (ADR 025) the input is **never
 * mutated**: AJV's `coerceTypes` would otherwise rewrite the caller's object in
 * place, so each call validates a `structuredClone`. The coerced clone is
 * returned as `result.data` — that is where typed values (e.g. `"18"` → `18`)
 * are surfaced, not via a side effect. When the schema is a literal, `result.data`
 * is typed via {@link InferData}; otherwise it widens to `unknown`.
 */
export function createAjvValidator<const S extends JSONSchema>(
  schema: S,
  options: AjvValidatorOptions = {}
): Validator<InferData<S>> {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: true,
    ...options.ajv,
  })
  if (options.formats !== false) addFormats(ajv)
  const validate = ajv.compile(schema as object)

  return (data: unknown) => {
    // Clone first: `coerceTypes` mutates in place, and a Validator must not touch
    // the caller's object (ADR 025). AJV coerces the clone; we hand it back as
    // `data` so callers get typed values without the mutation footgun.
    const coerced = structuredClone(data)
    const valid = validate(coerced) === true
    const issues = valid ? [] : (validate.errors ?? []).map(toIssue)
    return { valid, issues, data: coerced as InferData<S> }
  }
}

/** Map one AJV error to a neutral issue, landing it on the offending field. */
function toIssue(error: ErrorObject): ValidationIssue {
  const base = pointerToPath(error.instancePath)

  // `required` (and `dependentRequired`) report the *parent* object's path; the
  // offending key lives in `params.missingProperty`. Append it so the issue lands
  // on the missing field itself rather than its container.
  const missing = (error.params as { missingProperty?: string }).missingProperty
  const path =
    (error.keyword === 'required' || error.keyword === 'dependentRequired') &&
    typeof missing === 'string'
      ? join(base, missing)
      : base

  return {
    path,
    message: error.message ?? 'is invalid',
    keyword: error.keyword,
  }
}

/** RFC 6901 JSON Pointer (`/contacts/0/email`) → tree dot-path (`contacts.0.email`). */
function pointerToPath(pointer: string): string {
  if (!pointer) return ''
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.')
}

function join(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment
}
