import {
  useMemo,
  useState,
  useCallback,
  type FC,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { present, defaultPresentation, layered } from '@formframe/core'
import type {
  ApplyWidgetOverrides,
  FormShape,
  GroupNode,
  TypedTree,
  Validator,
  ValidationError,
  ValidationResult,
  PresentationResolver,
  WidgetOverridesOf,
} from '@formframe/core'
import {
  SchemaFields as SchemaFieldsRenderer,
  type EGroup,
  type RenderNode,
} from './renderer'

/**
 * Props accepted by the `SchemaFields` component returned from
 * {@link useFormTree}. Same as `SchemaFieldsProps` minus `form` because the hook
 * holds the tree.
 */
export interface BoundSchemaFieldsProps {
  /** Per-node hijack (ADR 010). Omit to render every node's default. */
  renderNode?: RenderNode
  /** Place-yourself at the root: receives the enriched root node. */
  children?: (root: EGroup) => ReactNode
}

/**
 * Validation state returned by {@link useFormTree}, ready to spread into
 * `ValidationProvider` without omitting touched or submitted state (ADR 036).
 */
export interface FormTreeValidation {
  errors: ValidationError[]
  touched: ReadonlySet<string>
  submitted: boolean
}

/** Options for {@link useFormTree}. */
export interface UseFormTreeOptions<
  S = unknown,
  Output = Record<string, unknown>,
  R extends PresentationResolver<S> = PresentationResolver<S>,
> {
  /**
   * A side-loaded validator (ADR 019), normally from the same source adapter as
   * the tree. When set, `submit` runs it, exposes `errors`, and only calls the
   * consumer handler when the data is valid.
   */
  validator?: Validator<Output>
  /**
   * Consumer presentation resolver (ADR 029). It runs above the shipped default
   * presentation and receives the tree's source-specific `origin.schema` type.
   * Keep the function reference stable; a new resolver re-presents the tree.
   *
   * When this is a typed `overrideWidgets(map)` resolver, the `const` map is
   * threaded into the returned `form`'s `FormShape` brand, so typing a customize
   * binding off `form` re-narrows the control to the OVERRIDDEN widget — no desync
   * between the typed control and what renders (bd bh7.8).
   */
  resolvePresentation?: R
}

/**
 * Bind source-agnostic React form behavior to an existing Core form tree.
 *
 * A front-end such as `jsonSchemaToTree` or `zodToTree` owns schema compilation.
 * This hook owns the React-facing behavior shared by every front-end: layered
 * presentation, a bound `SchemaFields`, native submission, validation errors,
 * live revalidation, and touched/submit state.
 */
export interface UseFormTreeResult<F, Output> {
  /** The presented tree that actually renders. For a branded input tree it carries
   * the `FormShape` re-narrowed by any widget overrides `resolvePresentation`
   * supplied (bd bh7.8) — type your customize binding off THIS, not the pre-override
   * input, and the typed control cannot desync from what renders. */
  form: F
  SchemaFields: FC<BoundSchemaFieldsProps>
  submit: (
    onValid?: (data: Output) => void
  ) => (event: FormEvent<HTMLFormElement>) => void
  revalidate: (event: SyntheticEvent<HTMLFormElement>) => void
  validation: FormTreeValidation
  errors: ValidationError[]
  handleBlur: (event: FocusEvent<HTMLFormElement>) => void
  touched: ReadonlySet<string>
  submitted: boolean
}

/**
 * Bind React behavior to a **branded** tree (`jsonSchemaToTree`/`zodToTree`): the
 * returned `form` carries the tree's `FormShape` re-narrowed by any widget overrides
 * `resolvePresentation` supplies (bd bh7.8). Type `useRenderNodeRules(form, …)` off
 * this `form`, not the pre-override input tree, and the typed control cannot desync
 * from what actually renders.
 */
export function useFormTree<
  TS extends FormShape,
  S,
  Output = Record<string, unknown>,
  R extends PresentationResolver<S> = PresentationResolver<S>,
>(
  tree: TypedTree<TS, S>,
  options?: UseFormTreeOptions<S, Output, R>
): UseFormTreeResult<
  TypedTree<ApplyWidgetOverrides<TS, WidgetOverridesOf<R>>, S>,
  Output
>
/** Bind React behavior to a plain (unbranded) tree — no `FormShape` to thread. */
export function useFormTree<S = unknown, Output = Record<string, unknown>>(
  tree: GroupNode<S>,
  options?: UseFormTreeOptions<S, Output>
): UseFormTreeResult<GroupNode<S>, Output>
export function useFormTree<S = unknown, Output = Record<string, unknown>>(
  tree: GroupNode<S>,
  options: UseFormTreeOptions<S, Output> = {}
): UseFormTreeResult<GroupNode<S>, Output> {
  const { validator, resolvePresentation } = options
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

  const [errors, setErrors] = useState<ValidationError[]>([])
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)

  /**
   * Mark a field touched on blur. `focusout` bubbles, so one form-level handler
   * covers every named control.
   */
  const handleBlur = useCallback((event: FocusEvent<HTMLFormElement>) => {
    const name = (event.target as { name?: string }).name
    if (!name) return
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)))
  }, [])

  const runValidator = useCallback(
    (data: Record<string, unknown>): ValidationResult<Output> => {
      const result: ValidationResult<Output> = validator
        ? validator(data)
        : { valid: true, errors: [] as ValidationError[] }
      setErrors(result.errors)
      return result
    },
    [validator]
  )

  /** Build a DOM submit handler that assembles data and gates on validation. */
  const submit = useCallback(
    (onValid?: (data: Output) => void) => {
      const run = form.submit((data) => {
        const result = runValidator(data)
        if (result.valid) {
          onValid?.(result.data === undefined ? (data as Output) : result.data)
        }
      })
      return (event: FormEvent<HTMLFormElement>) => {
        setSubmitted(true)
        run(event)
      }
    },
    [form, runValidator]
  )

  /**
   * Run the same validator from a form event. Wire to `onInput`, `onChange`, or
   * `onBlur` according to the desired validation timing.
   */
  const revalidate = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      if (!validator) return
      form.submit((data) => {
        runValidator(data)
      })({ preventDefault: () => {}, currentTarget: event.currentTarget })
    },
    [form, validator, runValidator]
  )

  // Stable component type: validation updates do not remount uncontrolled fields.
  const SchemaFields = useMemo<FC<BoundSchemaFieldsProps>>(() => {
    return function SchemaFields({
      renderNode,
      children,
    }: BoundSchemaFieldsProps) {
      return (
        <SchemaFieldsRenderer form={form} renderNode={renderNode}>
          {children}
        </SchemaFieldsRenderer>
      )
    }
  }, [form])

  const validation = useMemo<FormTreeValidation>(
    () => ({ errors, touched, submitted }),
    [errors, touched, submitted]
  )

  return {
    form,
    SchemaFields,
    submit,
    revalidate,
    validation,
    errors,
    handleBlur,
    touched,
    submitted,
  }
}
