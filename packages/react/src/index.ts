/**
 * @formframe/renderer-react
 *
 * React adapter for Core form trees from any schema front-end.
 */

// Source-agnostic React hook
export { useFormTree } from './useFormTree'
export type { BoundSchemaFieldsProps, UseFormTreeOptions } from './useFormTree'

// Framework-neutral form store (ADR 042–046) — the state + validation
// orchestration `useFormTree` binds. Exported for advanced composition and as
// the seam a non-React binding would drive (kept internal to @formframe/react
// until a second framework earns extraction — ADR 008).
export { createFormStore } from './formStore'
export type {
  FormStore,
  CreateFormStoreOptions,
  AnyValidator,
  OnValid,
} from './formStore'
export type { ErrorStore } from './errorStore'
export type { TouchedStore } from './touchedStore'
export type { StatusStore } from './statusStore'

// Continuation renderer (ADR 010/013) — typed, front-end-agnostic (operates on
// the Core tree). Schema compilation lives in separate input packages.
//
// `SchemaFields` is batteries-included; `createRenderer` is the public floor
// (bind a partial renderer set; gaps fall back to `diagnosticAdapter` markers);
// spread `defaultAdapter` to override entries by reference.
export {
  SchemaFields,
  createRenderer,
  defaultAdapter,
  diagnosticAdapter,
  Default,
  Children,
  ValidationProvider,
  FormStoreProvider,
  useFieldErrors,
  useFieldErrorDisplay,
  useDisplayPolicy,
  useValidationErrors,
  useIsValidating,
  useIsSubmitting,
  useValidationFailure,
  formatValidationFailure,
  fieldControlId,
  fieldErrorId,
} from './renderer'
// Error-display policy (ADR 027): touched-gated / submit-gated error visibility.
export {
  shouldDisplayFieldErrors,
  DEFAULT_SHOW_ERRORS_WHEN,
  type ShowErrorsWhen,
} from './displayPolicy'
export { ValidationSummary } from './ValidationSummary'
export type {
  SchemaFieldsProps,
  RenderNode,
  RenderHelpers,
  ReactAdapter,
  ReactPartialAdapter,
  ENode,
  EField,
  EGroup,
  EArray,
  EArrayItem,
} from './renderer'

// The render-node rules layer (ADR 047/048) — a form-scope selector registry
// lowering to an ordinary `RenderNode` (no engine seam); handlers are mounted
// components receiving arrangeable parts. Source-agnostic runtime.
export { renderNodeRules } from './renderNodeRules'
export type {
  RuleRegistrar,
  RulesBuild,
  PartComponent,
  PartsBag,
  LabelData,
  TextData,
  FieldHandler,
  GroupHandler,
  ArrayHandler,
  NodeHandler,
  FieldHandlerProps,
  GroupHandlerProps,
  ArrayHandlerProps,
  NodeHandlerProps,
} from './renderNodeRules'

// The typed binding (ADR 048) — reads the `FormShape` a front-end brands onto the
// tree and re-types the registrar off it. `useRenderNodeRules(tree, rules)` is the
// typed + memoized front door; `FieldProps`/`GroupProps`/`ArrayProps`/`ControlProps`
// annotate hoisted handlers (keyed on `type Shape = FormShapeOf<typeof schema>`
// from the front-end).
export { useRenderNodeRules } from './useRenderNodeRules'
export type {
  FieldProps,
  GroupProps,
  ArrayProps,
  ControlProps,
  TypedRuleRegistrar,
} from './useRenderNodeRules'
