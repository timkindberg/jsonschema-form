// Reactive validation-issue store (ADR 023) — the fan-out-free path.
//
// Validation issues are runtime state read by every field (`useFieldIssues`).
// Holding them in a single React Context re-renders *every* consumer on any
// change (Context bypasses the `NodeRenderer` memo), so one keystroke re-renders
// the whole form — the RJSF perf trap. Instead we keep them in an external store
// read through `useSyncExternalStore` with a **per-path snapshot**, and the store
// guarantees a **stable array reference for any path whose issues are unchanged**
// (and a shared `EMPTY` for none). A field's snapshot then only changes identity
// when *its own* issues change, so `useSyncExternalStore`'s `Object.is` check
// bails the re-render for every other field. Result: a validation pass re-renders
// only the fields whose issues actually changed — zero preventable re-renders.
//
// This is deliberately a tiny store we own (not a dependency): the genuinely hard
// part (tearing / concurrent correctness) is delegated to React's official
// `useSyncExternalStore`, and the part that bites hand-rolled stores (selector +
// custom equality) is sidestepped entirely by the reference-stability discipline
// above. It is also the seam a form-library adapter (RHF/TanStack) will later
// implement — kept internal until a second consumer earns the public shape
// (ADR 008).
import { groupIssuesByPath, type ValidationIssue } from '@jsonschema-form/core'

/** Shared empty snapshot — one stable reference so "no issues" never re-renders. */
export const EMPTY_ISSUES: ValidationIssue[] = Object.freeze(
  [] as ValidationIssue[]
) as ValidationIssue[]

/**
 * The reactive issue store. `getIssues(path)` returns a reference that is stable
 * across `setResult` calls that don't change that path — the property the
 * `useSyncExternalStore` bail relies on.
 */
export interface IssueStore {
  /** Issues for one field path; the shared `EMPTY_ISSUES` when none. */
  getIssues(path: string): ValidationIssue[]
  /** All issues, flat — stable across no-op `setResult`s. */
  getAll(): ValidationIssue[]
  /** Subscribe to any change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Replace the issue set; diffs per path and notifies. */
  setResult(issues: ValidationIssue[]): void
}

function sameIssues(a: ValidationIssue[], b: ValidationIssue[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.path !== y.path || x.message !== y.message || x.keyword !== y.keyword)
      return false
  }
  return true
}

export function createIssueStore(initial: ValidationIssue[] = []): IssueStore {
  let all: ValidationIssue[] = initial
  let byPath = groupIssuesByPath(initial)
  const listeners = new Set<() => void>()

  return {
    getIssues(path) {
      return byPath.get(path) ?? EMPTY_ISSUES
    },
    getAll() {
      return all
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setResult(issues) {
      const next = groupIssuesByPath(issues)
      // Preserve the previous array reference for any path whose issues are
      // unchanged, so that path's snapshot stays referentially identical and its
      // subscriber bails. (A path that dropped to zero issues is simply absent
      // from `next` → `getIssues` returns the shared `EMPTY_ISSUES`.)
      for (const [path, nextIssues] of next) {
        const prev = byPath.get(path)
        if (prev && sameIssues(prev, nextIssues)) next.set(path, prev)
      }
      byPath = next
      all = issues
      for (const listener of listeners) listener()
    },
  }
}
