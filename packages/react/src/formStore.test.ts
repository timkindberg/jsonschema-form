// Framework-neutral orchestration contract (ADR 042–046). These assert the hard
// parts — generation authority, supersede-on-start staleness, ref-counted
// pending, retained errors, the dual-natured submit, and the failure surface —
// against the plain store, with no React in sight (the reuse ADR 008 will earn).

import { describe, it, expect, vi } from 'vitest'
import type {
  AsyncValidator,
  ValidationResult,
  Validator,
} from '@formframe/core'
import { createFormStore } from './formStore'

/** A promise whose resolution we drive from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const invalid = (path: string, message = 'bad'): ValidationResult => ({
  valid: false,
  errors: [{ path, message }],
})
const valid = (data?: unknown): ValidationResult => ({
  valid: true,
  errors: [],
  ...(data === undefined ? {} : { data }),
})

/** Flush microtasks so awaited validators/onValid settle. */
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('formStore — seam (sync vs async)', () => {
  it('a sync validator publishes errors immediately', () => {
    const store = createFormStore({
      validator: () => invalid('name'),
    })
    store.validate({})
    expect(store.errors.getErrors('name')).toHaveLength(1)
    expect(store.status.isValidating()).toBe(false)
  })

  it('an async validator is awaited before publishing', async () => {
    const store = createFormStore({
      validator: async () => invalid('name'),
    })
    store.validate({})
    // Not yet published; validating is true.
    expect(store.errors.getErrors('name')).toHaveLength(0)
    expect(store.status.isValidating()).toBe(true)
    await tick()
    expect(store.errors.getErrors('name')).toHaveLength(1)
    expect(store.status.isValidating()).toBe(false)
  })
})

describe('formStore — authority & staleness (ADR 042)', () => {
  it('an earlier run resolving after a newer one is dropped on every channel', async () => {
    const first = deferred<ValidationResult>()
    const second = deferred<ValidationResult>()
    const calls = [first, second]
    let i = 0
    const validator: AsyncValidator = () => calls[i++].promise
    const store = createFormStore({ validator })

    store.validate({ v: 1 }) // generation 1
    store.validate({ v: 2 }) // generation 2 supersedes 1

    // Resolve the NEWER run first (it's current) → it publishes.
    second.resolve(invalid('second'))
    await tick()
    expect(store.errors.getErrors('second')).toHaveLength(1)

    // Now the STALE first run resolves late → must touch nothing.
    first.resolve(invalid('first'))
    await tick()
    expect(store.errors.getErrors('first')).toHaveLength(0)
    expect(store.errors.getErrors('second')).toHaveLength(1)
  })

  it('a sync run started after an async run suppresses the async run', async () => {
    const slow = deferred<ValidationResult>()
    let first = true
    const validator: AsyncValidator = () => {
      if (first) {
        first = false
        return slow.promise
      }
      return Promise.resolve(invalid('sync-newer'))
    }
    const store = createFormStore({ validator })
    store.validate({}) // gen 1 (slow)
    store.validate({}) // gen 2 (newer)
    await tick()
    expect(store.errors.getErrors('sync-newer')).toHaveLength(1)
    slow.resolve(invalid('slow-stale'))
    await tick()
    expect(store.errors.getErrors('slow-stale')).toHaveLength(0)
  })
})

describe('formStore — pending (ADR 044)', () => {
  it('isValidating is reference-counted across overlapping runs', async () => {
    const a = deferred<ValidationResult>()
    const b = deferred<ValidationResult>()
    const calls = [a, b]
    let i = 0
    const store = createFormStore({ validator: () => calls[i++].promise })

    expect(store.status.isValidating()).toBe(false)
    store.validate({})
    store.validate({})
    expect(store.status.isValidating()).toBe(true)
    a.resolve(valid())
    await tick()
    // One still in flight → still true.
    expect(store.status.isValidating()).toBe(true)
    b.resolve(valid())
    await tick()
    expect(store.status.isValidating()).toBe(false)
  })

  it('notifies status subscribers only on the 0↔1 edges', async () => {
    const a = deferred<ValidationResult>()
    const b = deferred<ValidationResult>()
    const calls = [a, b]
    let i = 0
    const store = createFormStore({ validator: () => calls[i++].promise })
    const listener = vi.fn()
    store.status.subscribe(listener)

    store.validate({}) // 0→1 : notify
    store.validate({}) // 1→2 : no notify
    expect(listener).toHaveBeenCalledTimes(1)
    a.resolve(valid())
    await tick() // 2→1 : no notify
    expect(listener).toHaveBeenCalledTimes(1)
    b.resolve(valid())
    await tick() // 1→0 : notify
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('formStore — retained errors (ADR 044)', () => {
  it('keeps prior errors visible unchanged while a newer run is pending', async () => {
    const pending = deferred<ValidationResult>()
    let first = true
    const validator: AsyncValidator = () => {
      if (first) {
        first = false
        return Promise.resolve(invalid('name', 'first error'))
      }
      return pending.promise
    }
    const store = createFormStore({ validator })
    store.validate({})
    await tick()
    expect(store.errors.getErrors('name')[0].message).toBe('first error')

    // A newer run starts but hasn't resolved — errors are NOT blanked.
    store.validate({})
    expect(store.errors.getErrors('name')[0].message).toBe('first error')

    pending.resolve(valid())
    await tick()
    expect(store.errors.getErrors('name')).toHaveLength(0)
  })

  it('preserves the array reference for a path whose errors are unchanged', async () => {
    const store = createFormStore({
      validator: () => ({
        valid: false,
        errors: [
          { path: 'a', message: 'a-bad' },
          { path: 'b', message: 'b-bad' },
        ],
      }),
    })
    store.validate({})
    const aBefore = store.errors.getErrors('a')
    // Re-run with the same verdict → 'a' keeps its exact reference (diff-wise).
    store.validate({})
    expect(store.errors.getErrors('a')).toBe(aBefore)
  })
})

describe('formStore — submit (ADR 043)', () => {
  it('latches submitted and raises isSubmitting immediately', () => {
    const store = createFormStore({ validator: async () => valid() })
    expect(store.touched.isSubmitted()).toBe(false)
    store.submit({})
    expect(store.touched.isSubmitted()).toBe(true)
    expect(store.status.isSubmitting()).toBe(true)
  })

  it('calls onValid with result.data when present, else the snapshot', async () => {
    const withData = createFormStore({
      validator: () => valid({ n: 42 }),
    })
    const onValidA = vi.fn()
    withData.submit({ n: 1 }, onValidA)
    await tick()
    expect(onValidA).toHaveBeenCalledWith({ n: 42 })

    const noData = createFormStore({ validator: () => valid() })
    const onValidB = vi.fn()
    const snapshot = { n: 7 }
    noData.submit(snapshot, onValidB)
    await tick()
    expect(onValidB).toHaveBeenCalledWith(snapshot)
  })

  it('does not call onValid on an invalid verdict, and clears isSubmitting', async () => {
    const store = createFormStore({ validator: () => invalid('name') })
    const onValid = vi.fn()
    store.submit({}, onValid)
    await tick()
    expect(onValid).not.toHaveBeenCalled()
    expect(store.status.isSubmitting()).toBe(false)
    expect(store.errors.getErrors('name')).toHaveLength(1)
  })

  it('a superseded submit suppresses errors yet still fires onValid (dual-natured)', async () => {
    const submitRun = deferred<ValidationResult>()
    let first = true
    const validator: AsyncValidator = () => {
      if (first) {
        first = false
        return submitRun.promise
      }
      return Promise.resolve(invalid('live'))
    }
    const store = createFormStore({ validator })
    const onValid = vi.fn()
    store.submit({ click: 'time' }, onValid) // gen 1 (submit)
    store.validate({}) // gen 2 supersedes the submit
    await tick() // live run publishes 'live'
    expect(store.errors.getErrors('live')).toHaveLength(1)

    // The superseded submit resolves valid: it must NOT publish (gated) but MUST
    // still fire onValid with its click-time data (ungated).
    submitRun.resolve(valid())
    await tick()
    expect(onValid).toHaveBeenCalledWith({ click: 'time' })
    // errors still belong to the newer live run — the submit published nothing.
    expect(store.errors.getErrors('live')).toHaveLength(1)
  })

  it('counts two overlapping submits and clears at zero', async () => {
    const a = deferred<ValidationResult>()
    const b = deferred<ValidationResult>()
    const calls = [a, b]
    let i = 0
    const store = createFormStore({ validator: () => calls[i++].promise })
    store.submit({})
    store.submit({})
    expect(store.status.isSubmitting()).toBe(true)
    a.resolve(valid())
    await tick()
    expect(store.status.isSubmitting()).toBe(true)
    b.resolve(valid())
    await tick()
    expect(store.status.isSubmitting()).toBe(false)
  })

  it('isSubmitting spans an async onValid and clears when it settles', async () => {
    const store = createFormStore({ validator: () => valid() })
    const onValidDone = deferred<void>()
    store.submit({}, () => onValidDone.promise)
    await tick()
    // Validation resolved valid, but onValid is still pending.
    expect(store.status.isSubmitting()).toBe(true)
    onValidDone.resolve()
    await tick()
    expect(store.status.isSubmitting()).toBe(false)
  })

  it('an onValid rejection clears isSubmitting without setting the failure surface', async () => {
    const store = createFormStore({ validator: () => valid() })
    store.submit({}, () => Promise.reject(new Error('consumer blew up')))
    await tick()
    expect(store.status.isSubmitting()).toBe(false)
    expect(store.status.getFailure()).toBeNull()
  })
})

describe('formStore — failure surface (ADR 042)', () => {
  it('an authoritative failure retains errors and exposes the raw reason', async () => {
    let first = true
    const boom = new Error('validator exploded')
    const validator: AsyncValidator = () => {
      if (first) {
        first = false
        return Promise.resolve(invalid('name', 'held'))
      }
      return Promise.reject(boom)
    }
    const store = createFormStore({ validator })
    store.validate({})
    await tick()
    expect(store.errors.getErrors('name')[0].message).toBe('held')

    store.validate({})
    await tick()
    // errors retained, raw reason surfaced.
    expect(store.errors.getErrors('name')[0].message).toBe('held')
    expect(store.status.getFailure()).toBe(boom)
  })

  it('a stale run failure is silent', async () => {
    const slow = deferred<ValidationResult>()
    let first = true
    const validator: AsyncValidator = () => {
      if (first) {
        first = false
        return slow.promise
      }
      return Promise.resolve(valid())
    }
    const store = createFormStore({ validator })
    store.validate({}) // gen 1 (will fail late)
    store.validate({}) // gen 2 supersedes
    await tick()
    slow.reject(new Error('stale boom'))
    await tick()
    expect(store.status.getFailure()).toBeNull()
  })

  it('the next authoritative publication clears the failure', async () => {
    let call = 0
    const validator: AsyncValidator = () => {
      call++
      if (call === 1) return Promise.reject(new Error('boom'))
      return Promise.resolve(valid())
    }
    const store = createFormStore({ validator })
    store.validate({})
    await tick()
    expect(store.status.getFailure()).not.toBeNull()
    store.validate({})
    await tick()
    expect(store.status.getFailure()).toBeNull()
  })

  it('a synchronous validator throw is a failure, not an invalid verdict', () => {
    const boom = new Error('sync throw')
    const validator: Validator = () => {
      throw boom
    }
    const store = createFormStore({ validator })
    store.validate({})
    expect(store.status.getFailure()).toBe(boom)
    expect(store.status.isValidating()).toBe(false)
  })
})
