// The store's one job is reference stability (ADR 023): a path whose issues did
// not change must return the SAME array reference across `setResult`, so its
// `useSyncExternalStore` subscriber bails. These tests pin that invariant
// directly (the render-count test proves it end-to-end through React).
import { describe, it, expect, vi } from 'vitest'
import type { ValidationIssue } from '@jsonschema-form/core'
import { createIssueStore, EMPTY_ISSUES } from './issueStore'

const issue = (path: string, message = 'bad'): ValidationIssue => ({
  path,
  message,
})

describe('issueStore (ADR 023)', () => {
  it('returns the shared EMPTY_ISSUES for an unknown path', () => {
    const store = createIssueStore()
    expect(store.getIssues('a')).toBe(EMPTY_ISSUES)
    expect(store.getIssues('b')).toBe(EMPTY_ISSUES)
  })

  it('keeps the same reference for a path whose issues are unchanged', () => {
    const store = createIssueStore([issue('a'), issue('b')])
    const beforeB = store.getIssues('b')

    // change only `a`; `b` is structurally identical in the next result
    store.setResult([issue('a', 'different'), issue('b')])

    expect(store.getIssues('b')).toBe(beforeB) // stable → b's subscriber bails
    expect(store.getIssues('a')).not.toBe(undefined)
    expect(store.getIssues('a')[0].message).toBe('different')
  })

  it('returns a new reference for a path whose issues changed', () => {
    const store = createIssueStore([issue('a')])
    const beforeA = store.getIssues('a')
    store.setResult([issue('a', 'changed')])
    expect(store.getIssues('a')).not.toBe(beforeA)
  })

  it('drops a cleared path back to the shared EMPTY_ISSUES', () => {
    const store = createIssueStore([issue('a')])
    expect(store.getIssues('a')).not.toBe(EMPTY_ISSUES)
    store.setResult([])
    expect(store.getIssues('a')).toBe(EMPTY_ISSUES)
  })

  it('notifies subscribers on setResult and stops after unsubscribe', () => {
    const store = createIssueStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.setResult([issue('a')])
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.setResult([issue('a'), issue('b')])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('exposes the flat issue list via getAll', () => {
    const store = createIssueStore()
    const issues = [issue('a'), issue('b')]
    store.setResult(issues)
    expect(store.getAll()).toBe(issues)
  })
})
