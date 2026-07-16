// The validation capability slot (ADR 019) — a neutral, side-loaded contract.
//
// Core does not validate; it only names the shape. An adapter package (AJV, and
// later Zod/Valibot) supplies the implementation, and a consumer (React's submit
// path) runs it. These are pure types plus one pure helper — no imports, no
// state, no DOM — so the stubborn Core boundary holds while validation still
// "rides on" Core as the shared vocabulary every renderer/validator can depend on.

/**
 * One validation problem, keyed to a field by the **same dot-path as
 * `node.path`** (`name`, `contacts.0.email`; `""` = the root value). Carrying the
 * path here is what lets a renderer map an error back to the field that owns it
 * with no translation layer. `keyword` is an optional machine code — typically
 * the JSON Schema keyword that failed (`required`, `minLength`, `pattern`).
 */
export interface ValidationError {
  path: string
  message: string
  keyword?: string
}

/**
 * The outcome of validating one data value: a verdict, the flat error list, and
 * optionally the validated data after any validator-applied coercion (ADR 025).
 *
 * A **discriminated union on `valid`** (ADR 025, review addendum 2026-07-15): an
 * invalid result carries `data?: never`, so a consumer can never read
 * "transformed data" off a failed verdict. On success `data` is the validated
 * value after any coercion/normalization the validator applied (e.g. AJV
 * `coerceTypes` turning `"18"` into `18`, Zod `coerce`/transforms). It stays
 * **optional on success**: a validator that transforms nothing omits it and
 * callers fall back to the value they passed in (see the {@link Validator}
 * contract). When present it is **never a reference to the caller's input**
 * (always a fresh value), per the purity invariant — so a consumer can adopt
 * typed values without ever observing a mutation of its own state.
 *
 * `T` is the shape of the success `data`; it defaults to `unknown`. Adapters that
 * know the shape specialize it — Zod from its output type, AJV via `InferData<S>`.
 */
export type ValidationResult<T = unknown> =
  | { valid: true; errors: ValidationError[]; data?: T }
  | { valid: false; errors: ValidationError[]; data?: never }

/**
 * The slot itself: given the form's assembled data, return the result.
 * Synchronous (submit-time, native-adapter path — ADR 019); its async sibling is
 * {@link AsyncValidator} (ADR 041), a separate seam a consumer accepts alongside
 * this one. Side-loaded: Core defines this; adapters implement it.
 *
 * **Purity invariant (ADR 025): a `Validator` MUST NOT mutate its input** (or
 * anything reachable from it). Adapters whose engine mutates (e.g. AJV's
 * `coerceTypes`) must clone internally and validate the clone. This lets any
 * consumer pass a live object — a form library's state, a React ref — without
 * defensive copying. Coercion is surfaced via {@link ValidationResult.data},
 * never via a side effect.
 *
 * `T` is the type of the returned {@link ValidationResult.data} (default
 * `unknown`). A bare `Validator` is `Validator<unknown>` — identical to before.
 */
export type Validator<T = unknown> = (data: unknown) => ValidationResult<T>

/**
 * The async sibling of {@link Validator} (ADR 041): given the form's assembled
 * data, return a `Promise` of the result. This is a **separate seam**, not a
 * widening of `Validator` — a consumer's single validation slot accepts
 * `Validator<T> | AsyncValidator<T>` and branches on the returned value's
 * Promise-shape at call time (ADR 046 §2), never on the validator's identity.
 * Synchronous callers are therefore untouched.
 *
 * The same **purity invariant** as {@link Validator} holds: an `AsyncValidator`
 * MUST NOT mutate its input (or anything reachable from it); coercion is surfaced
 * via {@link ValidationResult.data}, never via a side effect. A thrown error or a
 * rejected promise is a *validation-run failure* (ADR 042) — distinct from an
 * invalid verdict — and is the orchestrator's concern, not part of the result.
 *
 * `T` is the type of the resolved {@link ValidationResult.data} (default
 * `unknown`).
 */
export type AsyncValidator<T = unknown> = (
  data: unknown
) => Promise<ValidationResult<T>>

/**
 * Group errors by their `path` for O(1) per-field lookup — the shape a renderer
 * wants ("does this field have errors?"). Pure and order-preserving within a path.
 */
export function groupErrorsByPath(
  errors: ValidationError[]
): Map<string, ValidationError[]> {
  const byPath = new Map<string, ValidationError[]>()
  for (const error of errors) {
    const existing = byPath.get(error.path)
    if (existing) existing.push(error)
    else byPath.set(error.path, [error])
  }
  return byPath
}

/**
 * True for any **thenable** (a real `Promise` or any object/function with a
 * callable `then`). The single async detector shared by the whole seam so async
 * branching never hinges on `instanceof Promise` — which misses cross-realm and
 * library thenables (a Standard-Schema `~standard.validate` may return one). Used
 * by {@link fromStandardSchema} to reject async schemas and by the React store to
 * branch a sync vs async validation result (ADR 041/045, review addendum).
 */
export function isThenable<T = unknown>(
  value: unknown
): value is PromiseLike<T> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}
