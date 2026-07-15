// The form store (ADR 042–046) — the framework-neutral owner of all form and
// validation state plus the validation orchestration. `useFormTree` is only a
// React *binding* over this: it creates one per mounted form, wires DOM events to
// these methods, and reads the sub-stores via `useSyncExternalStore`. Another
// framework's binding would drive the same store (the reuse ADR 008 will earn).
// Zero React imports on purpose.
//
// It composes the three fan-out-free sub-stores — per-path errors (ADR 023),
// per-path touched + submitted (ADR 027), and form-scope status (ADR 044) — and
// owns the one piece that ties them together: **validation-run authority**.
//
// Authority (ADR 042): every run (submit or live) takes the next value of a
// monotonic `generation` counter at *start*. A run may publish its verdict only
// if its generation is still current when it resolves (supersede-on-start) — so a
// slow async run that a newer run has overtaken is silent on every channel
// (errors, failure). This is the stale-result protection, needing no cancellation.
//
// Submit is dual-natured (ADR 043): its *errors/failure* publish through the same
// generation gate, but its `onValid` is **ungated** — it fires on the submit
// run's own click-time verdict even if a newer run has superseded it, so a
// superseded submit still hands validated data to the consumer while the visible
// errors belong to the newer run.

import type {
  AsyncValidator,
  ValidationResult,
  Validator,
} from '@formframe/core'
import { createErrorStore, type ErrorStore } from './errorStore'
import { createTouchedStore, type TouchedStore } from './touchedStore'
import { createStatusStore, type StatusStore } from './statusStore'

/** A validator in either seam (ADR 041): the store branches on result shape. */
export type AnyValidator<T = unknown> = Validator<T> | AsyncValidator<T>

/** The consumer's success handler; may be async, in which case `isSubmitting`
 * spans it (ADR 043). Its rejection clears `isSubmitting` but is NOT routed
 * through the run-failure surface — that's the consumer's concern. */
export type OnValid<T> = (data: T) => void | Promise<void>

export interface FormStore<Output = unknown> {
  /** Per-path validation errors (ADR 023). */
  readonly errors: ErrorStore
  /** Per-path touched + form-scope submitted (ADR 027). */
  readonly touched: TouchedStore
  /** Form-scope isValidating / isSubmitting / failure (ADR 044). */
  readonly status: StatusStore

  /**
   * A live revalidation pass over an already-assembled snapshot (ADR 021). Starts
   * a run (generation++, isValidating++), and on resolve publishes the verdict
   * **only if still current**. No validator ⇒ no-op.
   */
  validate(data: unknown): void

  /**
   * A submit pass over the click-time snapshot (ADR 043). `submitted` latches and
   * `isSubmitting` rises immediately (no-silent-submit). Errors/failure publish
   * through the generation gate; `onValid` is ungated and fires on this run's own
   * valid verdict with `result.data ?? data`. `isSubmitting` spans an async
   * `onValid`; its rejection clears `isSubmitting` without setting failure.
   */
  submit(data: unknown, onValid?: OnValid<Output>): void

  /** Mark one field path touched (focus→blur). */
  markTouched(name: string): void

  /**
   * Swap the current validator (or clear it). Runs resolve the validator lazily,
   * so a binding can keep it in sync with a changing prop without recreating the
   * store — the accumulated errors/touched state survives the swap.
   */
  setValidator(validator: AnyValidator<Output> | undefined): void
}

export interface CreateFormStoreOptions<Output> {
  /** The initial validator; swap later via {@link FormStore.setValidator}. */
  validator?: AnyValidator<Output>
}

export function createFormStore<Output = unknown>(
  options: CreateFormStoreOptions<Output> = {}
): FormStore<Output> {
  let currentValidator = options.validator
  const resolveValidator = () => currentValidator
  const errors = createErrorStore()
  const touched = createTouchedStore()
  const status = createStatusStore()

  // Start-order authority (ADR 042): the newest-*started* run owns the shared
  // channels. Monotonic, so a resolving run is current iff its captured id still
  // equals this. One gate governs errors + failure together.
  let generation = 0

  const isCurrent = (g: number) => g === generation

  /** Publish an authoritative verdict: replace errors diff-wise and clear any
   * prior failure. Stale (superseded) runs never reach here. */
  const publishVerdict = (result: ValidationResult<Output>) => {
    errors.setResult(result.errors)
    status.clearFailure()
  }

  /** Run the validator over a snapshot, normalizing sync/async into one Promise,
   * and route the outcome through the caller's `onVerdict`/`onFailure`, each
   * gated by whether this run is still current at resolve time. */
  const runValidation = (
    data: unknown,
    onVerdict: (result: ValidationResult<Output>, current: boolean) => void,
    onFailure: (reason: unknown, current: boolean) => void
  ): void => {
    const g = ++generation
    status.incValidating()
    const settleVerdict = (result: ValidationResult<Output>) => {
      status.decValidating()
      onVerdict(result, isCurrent(g))
    }
    const settleFailure = (reason: unknown) => {
      status.decValidating()
      onFailure(reason, isCurrent(g))
    }
    const validator = resolveValidator()
    let outcome: ValidationResult<Output> | Promise<ValidationResult<Output>>
    try {
      outcome = validator
        ? validator(data)
        : { valid: true, errors: [] as ValidationResult<Output>['errors'] }
    } catch (reason) {
      // A synchronous throw is a run failure, not an invalid verdict (ADR 042).
      settleFailure(reason)
      return
    }
    if (isPromise(outcome)) {
      outcome.then(settleVerdict, settleFailure)
    } else {
      settleVerdict(outcome)
    }
  }

  return {
    errors,
    touched,
    status,

    validate(data) {
      if (!resolveValidator()) return
      runValidation(
        data,
        (result, current) => {
          if (current) publishVerdict(result)
        },
        (reason, current) => {
          // Retain errors; expose the raw reason on the failure surface (ADR 042).
          if (current) status.setFailure(reason)
        }
      )
    },

    submit(data, onValid) {
      // Every attempt drives observable state (no-silent-submit, ADR 042/043).
      touched.sync(touched.snapshotTouched(), true)
      status.incSubmitting()
      let submitSettled = false
      const endSubmit = () => {
        if (submitSettled) return
        submitSettled = true
        status.decSubmitting()
      }
      runValidation(
        data,
        (result, current) => {
          // errors/failure are gated by authority…
          if (current) publishVerdict(result)
          // …but onValid is ungated: it fires on THIS run's own verdict (ADR 043).
          if (result.valid) {
            const value = (result.data ?? data) as Output
            let handled: void | Promise<void>
            try {
              handled = onValid?.(value)
            } catch {
              // A synchronous onValid throw still clears isSubmitting; it is the
              // consumer's concern, not the run-failure surface (ADR 043 §5).
              endSubmit()
              return
            }
            if (isPromise(handled)) {
              handled.then(endSubmit, endSubmit)
            } else {
              endSubmit()
            }
          } else {
            // Invalid verdict: no onValid, submit is done.
            endSubmit()
          }
        },
        (reason, current) => {
          if (current) status.setFailure(reason)
          // Run failure ⇒ never onValid, submit is done.
          endSubmit()
        }
      )
    },

    markTouched(name) {
      const prev = touched.snapshotTouched()
      if (prev.has(name)) return
      touched.sync(new Set(prev).add(name), touched.isSubmitted())
    },

    setValidator(validator) {
      currentValidator = validator
    },
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown })?.then === 'function'
}
