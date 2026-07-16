import {
  useMemo,
  useState,
  useCallback,
  useLayoutEffect,
  type FC,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { present, defaultPresentation, layered } from '@formframe/core'
import type { GroupNode, PresentationResolver } from '@formframe/core'
import {
  SchemaFields as SchemaFieldsRenderer,
  FormStoreProvider,
  type EGroup,
  type RenderNode,
} from './renderer'
import { createFormStore, type OnValid } from './formStore'
import type { AnyValidator } from './formStore'
import type { ShowErrorsWhen } from './displayPolicy'

/**
 * Props accepted by the `SchemaFields` component returned from
 * {@link useFormTree}. Same as `SchemaFieldsProps` minus `form` because the hook
 * holds the tree. It also auto-provides the hook's form store to its subtree, so
 * fields read errors/touched/status with no manual `ValidationProvider`.
 */
export interface BoundSchemaFieldsProps {
  /** Per-node hijack (ADR 010). Omit to render every node's default. */
  renderNode?: RenderNode
  /**
   * Error-display policy (ADR 027) for this render — reactive, so a consumer can
   * toggle it live without remounting inputs. Overrides the hook's
   * `showErrorsWhen` option; falls back to it (then `'touched'`) when omitted.
   */
  showErrorsWhen?: ShowErrorsWhen
  /** Place-yourself at the root: receives the enriched root node. */
  children?: (root: EGroup) => ReactNode
}

/** Options for {@link useFormTree}. */
export interface UseFormTreeOptions<
  S = unknown,
  Output = Record<string, unknown>,
> {
  /**
   * A side-loaded validator (ADR 019), sync or async (ADR 041), normally from the
   * same source adapter as the tree. When set, `submit` runs it, publishes
   * `errors`, and only calls the consumer handler when the data is valid. The
   * single slot accepts either seam and branches on the result's Promise-shape.
   */
  validator?: AnyValidator<Output>
  /**
   * When each field reveals its errors (ADR 027): `'touched'` (default),
   * `'submit'`, or `'always'`. Owned here now that the hook provides the stores.
   */
  showErrorsWhen?: ShowErrorsWhen
  /**
   * Consumer presentation resolver (ADR 029). It runs above the shipped default
   * presentation and receives the tree's source-specific `origin.schema` type.
   * Keep the function reference stable; a new resolver re-presents the tree.
   */
  resolvePresentation?: PresentationResolver<S>
}

/**
 * Bind source-agnostic React form behavior to an existing Core form tree.
 *
 * A front-end such as `jsonSchemaToTree` or `zodToTree` owns schema compilation.
 * This hook owns the React-facing behavior shared by every front-end: layered
 * presentation, a bound `SchemaFields` that auto-provides the form store, native
 * submission, async-aware validation with stale-result protection, and
 * touched/submit/pending state.
 *
 * State lives in a framework-neutral {@link FormStore} the hook instantiates once
 * (not in React state), so a validation pass writes straight to the store and
 * re-renders only the fields/status readers that subscribe — never the consumer's
 * component. Read pending/failure via `useIsValidating`/`useIsSubmitting`/
 * `useValidationFailure` (inside `SchemaFields`) or off the returned `store`.
 */
export function useFormTree<S = unknown, Output = Record<string, unknown>>(
  tree: GroupNode<S>,
  options: UseFormTreeOptions<S, Output> = {}
) {
  const { validator, resolvePresentation, showErrorsWhen } = options
  const form = useMemo(
    () =>
      present<S>(
        tree,
        resolvePresentation
          ? layered<S>(defaultPresentation, resolvePresentation)
          : defaultPresentation
      ),
    [tree, resolvePresentation]
  )

  // Keep the latest validator reachable without recreating the store: the store
  // resolves it lazily per run, so swapping the validator takes effect on the
  // next run and never drops the store's accumulated errors/touched state.
  // The store is created once (stable identity) and kept in sync with a changing
  // validator via an effect — never recreated, so its errors/touched state and
  // the uncontrolled inputs below survive a validator swap.
  const [store] = useState(() => createFormStore<Output>({ validator }))
  useLayoutEffect(() => {
    store.setValidator(validator)
  }, [store, validator])

  /**
   * Mark a field touched on blur. `focusout` bubbles, so one form-level handler
   * covers every named control.
   */
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLFormElement>) => {
      const name = (event.target as { name?: string }).name
      if (name) store.markTouched(name)
    },
    [store]
  )

  /** Build a DOM submit handler that assembles the click-time snapshot and runs
   * the validated-submit lifecycle (ADR 043). */
  const submit = useCallback(
    (onValid?: OnValid<Output>) => {
      const run = form.submit((data) => {
        store.submit(data, onValid)
      })
      return (event: FormEvent<HTMLFormElement>) => {
        run(event)
      }
    },
    [form, store]
  )

  /**
   * Run a live revalidation pass from a form event. Wire to `onInput`,
   * `onChange`, or `onBlur` according to the desired validation timing.
   */
  const revalidate = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      form.submit((data) => {
        store.validate(data)
      })({ preventDefault: () => {}, currentTarget: event.currentTarget })
    },
    [form, store]
  )

  // Stable component type: validation updates do not remount uncontrolled fields.
  // Auto-provides the form store to its subtree (no manual ValidationProvider).
  const SchemaFields = useMemo<FC<BoundSchemaFieldsProps>>(() => {
    return function SchemaFields({
      renderNode,
      showErrorsWhen: mode,
      children,
    }: BoundSchemaFieldsProps) {
      return (
        <FormStoreProvider
          store={store}
          showErrorsWhen={mode ?? showErrorsWhen}
        >
          <SchemaFieldsRenderer form={form} renderNode={renderNode}>
            {children}
          </SchemaFieldsRenderer>
        </FormStoreProvider>
      )
    }
  }, [form, store, showErrorsWhen])

  return {
    form,
    SchemaFields,
    submit,
    revalidate,
    handleBlur,
    /** The framework-neutral form store (advanced / out-of-tree subscription). */
    store,
  }
}
