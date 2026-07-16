# Tribe-of-TS-lib-mentors review — 9jk async validation + store migration

- **Repo:** `/Users/tim.kindberg/projects/personal/jsonschema-form-wt-9jk`
- **Branch:** `jsonschema-form-9jk-async-validator` (PR #71)
- **Fixed point:** `origin/main` (merge-base `ef6b90caad6e8b4515bb938eae858ba9c948b03b`)
- **Diff:** `git diff origin/main...HEAD` — 32 files, +1717/−261
- **Gate at review time:** `npm run gate` → `EXIT=0`
- **Reviewers:** three parallel, mutually-blind sub-agents (Adversarial / Type-DX "Pocock" / Library-author "Tanner").

---

## Reviewer 1 — Unbiased Adversarial (correctness & soundness)

### Verdict

**SHIP-WITH-FIXES** — The generation-gated orchestration is internally consistent, ADR-backed, and proven at the store layer (`formStore.test.ts`); gate is green (`EXIT=0`). Ship after addressing the Promise/thenable split, documenting the dual-natured submit hazard, and adding a React-level test for `useValidationFailure`.

### Findings

**[HIGH] Dual-natured submit can persist click-time data while UI shows a newer verdict** — `packages/react/src/formStore.ts:174-175` — Ungated `onValid` fires on the submit run's own verdict even when `current` is false; errors publish only when `current` (`formStore.ts:172-173`). ADR 043 intends this, but a consumer wiring `submit` to an API save will hand off superseded data while field errors reflect a newer live pass. `formStore.test.ts:228-251` proves it; nothing in README/async docs warns that **visible errors and `onValid` can disagree**. Fix: prominent "split brain" callout in README + example 16; consider a dev-only warning when ungated `onValid` fires on a superseded generation.

**[HIGH] `as Output` is the only type boundary — never verified** — `packages/react/src/formStore.ts:176` — `(result.data ?? data) as Output` trusts the validator. A mis-typed `AnyValidator<Output>` or a lying `result.data` shape flows straight into `onValid` with no runtime guard. The contract suite checks purity, not output-shape conformance. Fix: document that `Output` is caller-owned fiction, or narrow via schema-inferred helpers (Zod `TypeOf`).

**[MED] Promise detection diverges across layers** — `packages/react/src/formStore.ts:133` vs `packages/core/src/standardSchema.ts:131` — `runValidation` duck-types via `isPromise` (`typeof then === 'function'`); sync `fromStandardSchema` rejects only `instanceof Promise`. A thenable from `~standard.validate` can slip through sync consume and yield a false valid verdict (`standardResultToValidation` treats missing `issues` as success). `fromStandardSchemaAsync` (`standardSchema.ts:153`) correctly `await`s. Fix: one shared thenable detector (or `Promise.resolve` normalize) in Core, used by both `formStore` and `fromStandardSchema`.

**[MED] `onValid` rejections are swallowed with no library signal** — `packages/react/src/formStore.ts:186-187` — `handled.then(endSubmit, endSubmit)` clears `isSubmitting` on reject but routes nothing to `useValidationFailure` (ADR 043 §5). Consumers who omit `.catch` get silent failure after a "successful" validation. Fix: document explicitly; `5ss` affordance is filed but README should state "you own handler errors."

**[MED] Breaking `FormTreeValidation` removal lacks migration path** — `packages/react/src/useFormTree.tsx` (diff removes `FormTreeValidation` + `validation` return) — Consumers spreading `{...validation}` into `ValidationProvider` break with no changelog entry or codemod. Examples/README show the new `store` + selector pattern, but there is no "before/after" for upgraders.

**[MED] `useValidationFailure` has zero automated coverage** — `packages/react/src/renderer.tsx:381-387` — Store-level failure is tested (`formStore.test.ts:292-359`); the React selector hook is not. Example 16 (`App_16_React+AsyncValidation.tsx:106-114`) is manual-only. Fix: one browser test asserting banner text after a rejecting validator.

**[MED] Status ref-counts can underflow silently** — `packages/react/src/statusStore.ts:69-71` — `decValidating`/`decSubmitting` decrement without a floor. A double-settle bug would drive the count negative; `isValidating()` (`statusStore.ts:55`) stays false while work may still be in flight. Fix: dev assert `count > 0` before decrement.

**[LOW] Stale `Validator` JSDoc contradicts shipped API** — `packages/core/src/validation.ts:47-49` — Still says "async validators are a future seam evolution" while `AsyncValidator` is exported at `validation.ts:80-82`. Fix: update the comment.

**[LOW] React stale-supersede test is end-state only** — `packages/react/src/async-validation.test.tsx:103-125` — Comment admits timing isn't exercised; only checks `errorEls().length` after fill. Store tests cover races; React binding doesn't.

### Genuinely strong

- **`formStore.test.ts` is the right proof surface** — ~360 lines exercising generation supersede, ref-counted pending, retained errors, dual-natured submit, and failure retention without React in the loop. That's how you earn ADR 008 reuse later.
- **Single authority gate over errors + failure** (`formStore.ts:99-102`, `formStore.ts:116-120`) — One `isCurrent(g)` check prevents the incoherent "stale failure, fresh errors" split ADR 042 rejected.
- **Sibling `AsyncValidator` seam** (`validation.ts:63-80`) — Not widening `Validator` keeps sync Standard Schema consumers and AJV untouched; `validation-contract` uniform `await` (`validation-contract/src/index.ts:54-56`) is the right conformance move.
- **Store-owned state + fan-out-free selectors** — Moving orchestration off `useState` in `useFormTree` into `createFormStore` with `useSyncExternalStore` readers preserves the ADR 023 per-path stability contract while adding pending/failure without remounting inputs (`useFormTree.test.tsx:32-62`).

---

## Reviewer 2 — Type-DX ("Matt Pocock" lens)

### Type-DX score: **7/10**

The sibling `Validator`/`AsyncValidator` seam is well-typed and wrong-call errors are unusually legible, but validated output still escapes through `as` casts, `ValidationResult` does not narrow, and the breaking store migration leaves consumers to rediscover types the old `validation` bag used to surface.

### Findings

**[high] `Output` is inferred from `validator`, but success data is still asserted — `packages/react/src/formStore.ts:176`**

`useFormTree` correctly threads `Output` from `AnyValidator<Output>` into `OnValid<Output>` (confirmed: `submit((data) => …)` gets `{ name: string; age: number }` when the validator is `fromStandardSchema(schema)` or `createZodValidator(schema)`). At publish time, though, the store does:

```ts
const value = (result.data ?? data) as Output
```

`ValidationResult<T>` uses a bare `valid: boolean` (`packages/core/src/validation.ts:30-31`), so TypeScript cannot prove `data` is `Output` when `valid === true` and `data` is omitted. The cast papers over a real type↔runtime gap: AJV/Zod may return `{ valid: true, errors: [] }` with no `data`, and `onValid` receives the unvalidated snapshot typed as `Output`. **Fix:** make success a discriminated union, e.g. `{ valid: true; errors: []; data: T } | { valid: false; errors: ValidationError[]; data?: never }`, and drop the cast.

**[medium] `ValidationResult` does not narrow — `packages/core/src/validation.ts:30-44`**

After `if (result.valid)`, `result.data` stays `T | undefined`. Adapter authors and store consumers get no compiler help distinguishing "valid + transformed" from "valid + omitted." Low-cost DX win at the product's core contract.

**[medium] Breaking `validation` return with no migration typing — `packages/react/src/useFormTree.tsx:170-178` (vs `origin/main:160-170`)**

`FormTreeValidation` and the spreadable `validation` object are gone. Consumers must adopt `store` + `useValidationErrors`/`useFieldErrors`/selector hooks. That is architecturally right (ADR 044), but the type surface offers no deprecated shim or `Pick<FormStore, …>` alias, so upgrades are grep-driven. A transitional `/** @deprecated */` type or one-release re-export would reduce cliff-hanger upgrades.

**[medium] `useValidationFailure(): unknown` pushes narrowing onto every caller — `packages/react/src/renderer.tsx:381`**

`unknown` is honest for thrown/rejected reasons, but the public hook gives zero structure. Example 16 (`App_16_React+AsyncValidation.tsx:107-109`) reimplements `instanceof Error` + `String(failure)` — copy-paste tax. Export a small `ValidationRunFailure` branded union or `getValidationFailureMessage(failure: unknown): string` helper beside the hook.

**[low] `FormStoreProvider` erases `Output` — `packages/react/src/renderer.tsx:298`**

`store: FormStore` (defaults to `FormStore<unknown>`) loses the `Output` generic from `useFormTree`'s return. Harmless for error hooks, but advanced `store.submit(…, onValid)` off-context won't infer callback input. **Fix:** `store: FormStore<unknown>` explicitly, or `FormStoreProvider<Output>` generic.

**[low] `AnyValidator<T>` is invariant on `T` — `packages/react/src/formStore.ts:34`**

`tsc` probe: `Validator<Record<string, unknown>>` is not assignable to `AnyValidator<{ a: string }>`. Reusable validators typed at document width won't slot without annotation or a covariant helper. Expected for function-parameter `T`, but worth documenting.

**[positive — teaching error] Async where sync is required — `packages/core/src/standardSchema.ts:131-135`**

Assigning `AsyncValidator<…>` to `Validator<…>` yields: *"Type 'Promise<ValidationResult<…>>' is missing the following properties from type 'ValidationResult<…>': valid, errors"* — not `never` soup. Runtime `fromStandardSchema` throws an equally explicit `TypeError`. This is how sibling seams should fail.

**[positive — teaching error] Sync where only async is accepted — `packages/core/src/validation.ts:61` vs `80-82`**

`Validator<T>` assigned to `AsyncValidator<T>`: *"missing … then, catch, finally"* — immediately actionable.

**[nit] Default `Output` mismatch — `packages/react/src/useFormTree.tsx:46` vs `packages/react/src/formStore.ts:41`**

`useFormTree` defaults `Output` to `Record<string, unknown>`; `FormStore` defaults to `unknown`. No-validator `submit` callbacks see `Record<string, unknown>` (probe: `data.foo` is `unknown`). Align defaults to one story.

### What's elegant

- **Sibling seam, not widened signature** (`packages/core/src/validation.ts:61-82`): `Validator` stays sync; `AsyncValidator` is parallel. Sync callers never absorb `Promise` pollution.
- **Single `Output` parameter** ties `validator`, `createFormStore<Output>`, and `OnValid<Output>` (`useFormTree.tsx:44-54`, `formStore.ts:63-73`) — one annotation propagates when inference isn't enough.
- **Zod factories are single-source** (`packages/validation-zod/src/zodValidator.ts:18-46`): both `createZodValidator` and `createZodAsyncValidator` return `ValidationResult<TypeOf<T>>` through shared `toValidationResult` — no sync/async type drift.
- **Standard Schema twins** (`packages/core/src/standardSchema.ts:62-96`, `125-154`): `toStandardSchema`/`toStandardSchemaAsync` and `fromStandardSchema`/`fromStandardSchemaAsync` share mapping helpers; async consumer accepts sync schemas uniformly.
- **Return hover is flat and legible**: `{ form, SchemaFields, submit, revalidate, handleBlur, store }` — no raw conditional generic explosion on the hook result.
- **Gate green** (`EXIT=0`): types, lint, and tests agree — rare for a store migration this size.

**Merge?** Yes, with the `ValidationResult` discriminated-union follow-up filed — the `as Output` cast is the one soundness leak in an otherwise careful public surface.

---

## Reviewer 3 — Library author ("Tanner Linsley" lens)

### Verdict

**SHIP-WITH-GUARDRAILS** — The store + generation-counter design is the right extraction for async (gate green, stale-run tests solid), but the shipped teach path still pushes the *advanced* composition API while docs retain a removed surface. Merge once the happy-path story and the sharp submit edges are explicit.

### Guardrails / findings

**[medium] Two-tier composition cliff — `useFormTree.tsx:151-168`, `App_16_React+AsyncValidation.tsx:169-184`, `displayPolicy.ts:24-25`**
The hook returns a bound `SchemaFields` that auto-wraps `FormStoreProvider`, yet every migrated example (09/11/13/15/16) manually does `FormStoreProvider` + raw `SchemaFields form={form}`. New users will copy the longer path, forget the provider, and get silent `false`/`null` from the status hooks (`renderer.tsx:354-360`). `displayPolicy.ts` still tells readers to spread `useFormTree`'s removed `validation` object. **Failure mode:** spinner never shows, errors never gate on touched. **Guardrail:** README primary snippet should use bound `<SchemaFields />`; relegate `store` + `FormStoreProvider` to an "advanced / out-of-tree" subsection; fix the stale `displayPolicy` comment.

**[medium] Ungated `onValid` on superseded submits — `formStore.ts:174-175`, `formStore.test.ts:228-252`, ADR 043 §3**
A superseded submit still calls `onValid` with click-time data while visible errors belong to a newer run. That's coherent if documented; it's brutal if not. **Failure mode:** user edits during a slow async check, live validation supersedes, first submit still saves stale data — duplicate or wrong persistence. **Guardrail:** ship a one-line warning in README async section + example 16 comment; recommend `disabled={useIsSubmitting() || useIsValidating()}` (example 16 does this for the button, not as library default).

**[medium] `onValid` rejections are swallowed — `formStore.ts:186-187`, `formStore.test.ts:283-289`**
Rejected async handlers clear `isSubmitting` but never surface on `useValidationFailure()`. **Failure mode:** save API 500s, UI looks idle, user retries blindly. Reasonable boundary, but undiscoverable. **Guardrail:** document explicitly; consider optional `onSubmitError` later — don't leave it implicit.

**[low] Per-field double subscription — `renderer.tsx:488-499`**
`DefaultFieldRoot` calls `useFieldErrors`/`useFieldErrorDisplay`, then `DefaultFieldErrors` repeats both (`renderer.tsx:455-458`). Harmless at small scale; wasteful on 50-field admin forms. **Guardrail:** pass errors/show into `DefaultFieldErrors` or collapse to one hook site.

**[low] `useValidationFailure(): unknown` — `renderer.tsx:381-387`**
Correct at runtime, DX cliff at authoring time. Every consumer does `instanceof Error` (example 16:109). **Guardrail:** export a narrow `ValidationRunFailure` type or helper `formatValidationFailure(failure)`.

**[low] No unmount-during-flight contract — `formStore.ts:133-137`**
Generation gating prevents stale *error* publication; nothing aborts in-flight `onValid` after unmount. **Failure mode:** route change mid-save still runs `setState` in a dead tree. Standard React caveat, but async submit makes it common. **Guardrail:** one README line: consumer owns cancellation in `onValid`; optional future `AbortSignal` on submit.

**[low] Whole-validator cost is consumer-owned — `README.md:140-148`, `useFormTree.tsx:140-146`**
Honestly documented and example 16 models cache + skip-when-unchanged. Good. Just ensure this stays in the *first* async paragraph, not buried — it's the #1 production surprise with Zod async.

### What I'd copy into my own lib

- **Framework-neutral orchestration store** with React as a thin binder (`formStore.ts:1-22`, `useFormTree.tsx:105-108`) — earns a second framework without rewriting stale-run logic.
- **Supersede-on-start generation counter** instead of per-request `AbortController` (`formStore.ts:90-96`, `formStore.test.ts:63-84`) — simpler mental model, retains errors during pending (`formStore.test.ts:149-172`).
- **Reference-counted `isValidating`/`isSubmitting`** with notify only on 0↔1 edges (`statusStore.ts:64-79`) — overlapping submits work without boolean races.
- **Per-path `useSyncExternalStore` error slices** with stable array refs (`errorStore.ts:8-12`, `render-counts.test.tsx:270-291`) — the RJSF fan-out trap avoided, with render-count tests as contract.
- **Stable bound component identity** via `useMemo` + `useState` lazy store init (`useFormTree.tsx:105-108`, `useFormTree.tsx:151-168`, `useFormTree.test.tsx:32-62`) — uncontrolled inputs survive validation passes.
- **Single `validator` slot** branching on Promise shape (`formStore.ts:133-137`) — no sync/async API fork for consumers.

---

## Consensus

### Converged findings (≥2 reviewers — the real signal)

1. **`as Output` cast + `ValidationResult` doesn't narrow** — Adversarial [HIGH], Pocock [high]+[medium]. The bare `valid: boolean` at `validation.ts:30` forces `(result.data ?? data) as Output` at `formStore.ts:176`; a `{valid:true, errors:[]}` with no `data` flows the *unvalidated* snapshot into `onValid` typed as `Output`. Both propose making `ValidationResult` a discriminated union on `valid`. **This is the one true soundness leak** and it's at the product's core contract.

2. **Dual-natured submit "split brain" needs to be documented** — Adversarial [HIGH], Tanner [medium]. Ungated `onValid` on a superseded submit (`formStore.ts:174-175`) can persist click-time data while visible errors belong to a newer run. Behavior is ADR 043-intended and tested; the gap is *docs*, not code. Recommend a README/example callout + `disabled={isSubmitting || isValidating}` guidance.

3. **Swallowed `onValid` rejection** — Adversarial [MED], Tanner [medium]. `handled.then(endSubmit, endSubmit)` (`formStore.ts:186-187`) clears `isSubmitting` but never surfaces the reason. Document "you own handler errors"; consider a future `onSubmitError`.

4. **`useValidationFailure(): unknown` DX cliff** — Pocock [medium], Tanner [low]. Every consumer re-implements `instanceof Error` (example 16:109). Ship a `formatValidationFailure(failure)` helper or a `ValidationRunFailure` type.

5. **Breaking `validation`/`FormTreeValidation` removal lacks a migration path** — Adversarial [MED], Pocock [medium]. Right architecturally (ADR 044) but upgrades are grep-driven; add a before/after migration note (and/or a one-release `@deprecated` shim).

6. **`useValidationFailure` has no React-level test** — Adversarial [MED]; Tanner notes example 16 is manual-only. Add one browser test asserting the banner after a rejecting validator.

### Sharpest single-reviewer catch

**Adversarial — Promise vs thenable detection divergence** (`formStore.ts:133` uses `isPromise` duck-typing; `standardSchema.ts:131` rejects only `instanceof Promise`). A thenable returned by `~standard.validate` can slip through the *sync* `fromStandardSchema` and, because `standardResultToValidation` treats a missing `issues` key as success, yield a **false valid verdict**. Neither other reviewer caught this. Fix: one shared thenable detector in Core used by both call sites.

### Where they disagreed

- **Severity of the `as Output` leak:** Adversarial rates it HIGH (soundness); Pocock calls it "the one soundness leak" yet still votes merge-with-follow-up. Same finding, different urgency.
- **Emphasis:** Adversarial weights runtime/async races (thenable split, ref-count underflow, staleness test depth); Pocock weights the type contract (discriminated union, invariance, generic erasure); Tanner weights the *teach path* (docs still show the removed `validation`, examples push the advanced composition over the bound `SchemaFields`).
- No reviewer voted HOLD.

### Verdicts side by side

| Reviewer | Verdict |
|---|---|
| Adversarial | **SHIP-WITH-FIXES** |
| Type-DX (Pocock) | **7/10 — merge with `ValidationResult` discriminated-union follow-up** |
| Library-author (Tanner) | **SHIP-WITH-GUARDRAILS** |

### Before-merge list (highest consensus, lowest cost)

1. Make `ValidationResult` a **discriminated union on `valid`** and drop the `as Output` cast (`validation.ts` + `formStore.ts:176`). *(consensus #1 — soundness)*
2. Add a **shared thenable detector** in Core; use it in `fromStandardSchema` and `formStore` (`standardSchema.ts:131`, `formStore.ts:133`). *(sharpest catch — soundness)*
3. **Document** the dual-natured-submit split-brain + the swallowed `onValid` rejection; recommend disabling submit while validating/submitting. *(consensus #2, #3)*
4. **Fix stale docs:** `Validator` JSDoc "async is future" (`validation.ts:47`), the `displayPolicy.ts` comment referencing the removed `validation`, and lead the README/examples with the bound `<SchemaFields />`. *(consensus, docs-truth)*
5. Add a **migration note** for the removed `validation` / `FormTreeValidation`. *(consensus #5)*

Follow-up beads (non-blocking): `useValidationFailure` helper/type; React test for the failure hook; ref-count underflow dev-assert; per-field double-subscription; `FormStoreProvider` `Output` generic; align `Output` defaults between hook and store.
