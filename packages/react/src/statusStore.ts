// Form-scope status store (ADR 042/043/044) — the pending/failure sibling of the
// per-path error store. It holds three form-level signals produced by validation
// orchestration and read, fan-out-free, via `useSyncExternalStore`:
//
//   • isValidating — a verdict is being computed (any origin: submit or live).
//   • isSubmitting — a submit is in flight, through its (possibly async) onValid.
//   • failure      — the raw reason of the last *authoritative* validation-run
//                    failure (a thrown/rejected validator), or null.
//
// `isValidating`/`isSubmitting` are **reference-counted** (ADR 044): each in-flight
// run increments on start and decrements on settle, so the boolean is `count > 0`.
// Counting (not a bare boolean) is what makes overlapping runs correct — two
// concurrent submits raise the count to 2 and it only reads false at zero.
//
// Framework-neutral by construction: zero React imports, plain listeners +
// snapshot getters. React binds it through `useSyncExternalStore`; another
// framework's binding would read the same store (the reuse ADR 008 will earn).

/** A validation-run failure reason, boxed so `null` cleanly means "no failure". */
export interface StatusStore {
  /** Whether ≥1 validation run (submit or live) is currently in flight. */
  isValidating(): boolean
  /** Whether ≥1 submit is in flight (spans its async `onValid`). */
  isSubmitting(): boolean
  /** The raw reason of the last authoritative run failure, or `null`. */
  getFailure(): unknown
  /** Subscribe to any change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Enter/leave a validation run (reference-counted). */
  incValidating(): void
  decValidating(): void
  /** Enter/leave a submit (reference-counted; spans async onValid). */
  incSubmitting(): void
  decSubmitting(): void
  /** Record / clear the authoritative run-failure reason. */
  setFailure(reason: unknown): void
  clearFailure(): void
}

/** A sentinel distinct from any real reason, so `null`/`undefined` reasons are
 * representable as "a failure occurred" without ambiguity. */
const NO_FAILURE = Symbol('no-failure')

export function createStatusStore(): StatusStore {
  let validating = 0
  let submitting = 0
  let failure: unknown = NO_FAILURE
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  return {
    isValidating: () => validating > 0,
    isSubmitting: () => submitting > 0,
    getFailure: () => (failure === NO_FAILURE ? null : failure),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    incValidating() {
      validating++
      // Only the 0→1 edge flips the boolean any reader observes.
      if (validating === 1) notify()
    },
    decValidating() {
      // Floor at zero: a double-settle bug must not drive the count negative
      // (which would keep `isValidating()` stuck false while work is in flight).
      // Guarding here means every dec below zero is a no-op, not a silent under-run.
      if (validating === 0) return
      validating--
      if (validating === 0) notify()
    },
    incSubmitting() {
      submitting++
      if (submitting === 1) notify()
    },
    decSubmitting() {
      if (submitting === 0) return
      submitting--
      if (submitting === 0) notify()
    },
    setFailure(reason) {
      failure = reason
      notify()
    },
    clearFailure() {
      if (failure === NO_FAILURE) return
      failure = NO_FAILURE
      notify()
    },
  }
}
