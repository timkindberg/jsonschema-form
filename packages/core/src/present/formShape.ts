/**
 * The front-end-agnostic **type surface** a front-end brands its tree with, plus
 * the neutral widget → control → parts *composition* that used to live per
 * front-end (ADR 048). React reads a {@link FormShape} off the tree and types its
 * customize registrar generically — importing no front-end.
 *
 * Split of responsibility (ADR 048 §2): the front-end projects only the
 * schema-specific facts per path (`value` / `widget` / `description` state),
 * eagerly mapped over its own field paths. Everything below — deriving the
 * pre-narrowed `FieldControl` member and the present parts bag — is neutral and
 * keyed on {@link WidgetName} + {@link DescriptionState}, instantiated lazily only
 * for the paths a handler actually touches.
 */

import type {
  FieldControl,
  FieldPartsBase,
  GroupNode,
  WidgetName,
} from '../parser/nodeTypes'
import type { ValidationError } from '../validation'
import type { PresentationResolver, WidgetToControlKind } from './present'

/**
 * Whether a path's description part is statically **present**, statically
 * **absent**, or **optional** (unknowable at the type level). A front-end that
 * can prove presence from the schema literal (JSON Schema) reports
 * `'present' | 'absent'`; one that stores descriptions in a runtime registry
 * (Zod) reports `'optional'` — the slot is always placeable but may render
 * nothing (ADR 047 follow-up / ADR 048).
 */
export type DescriptionState = 'present' | 'absent' | 'optional'

// The narrowed DATA payload each present part hands its render prop — Core owns
// these shapes (a React binding wraps each as a `PartComponent<data>`).
type LabelData = FieldPartsBase['label']
type TextData = NonNullable<FieldPartsBase['description']>

/** The pre-narrowed `FieldControl` union member for a widget (neutral Stage B) —
 * so `control.attrs` is the right shape with no runtime `kind` guard. */
export type ControlForWidget<W extends WidgetName> = Extract<
  FieldControl,
  { kind: WidgetToControlKind<W> }
>

/** The `Description` slot contributed by a {@link DescriptionState}: present →
 * required, optional → optional, absent → omitted.
 *
 * TYPE TOUR: one 3-way conditional emits three DIFFERENT object shapes from a
 * single state string. The `absent` branch returns `object` (an empty type): when
 * that gets `&`-intersected into the parts bag it contributes NO key at all — so a
 * field with no schema description has literally no `Description` slot to place,
 * not merely an optional one. That is why `parts.Description` is a compile error on
 * a description-less field instead of `PartComponent | undefined`. */
type DescriptionSlot<D extends DescriptionState> = D extends 'present'
  ? { Description: TextData }
  : D extends 'optional'
    ? { Description?: TextData }
    : object

/**
 * The parts DATA bag for a field, composed from its widget + description state.
 * Neutral (no schema concepts): `Control` is the pre-narrowed member for `W`;
 * `Errors` is runtime validation state; `Description` follows `D`.
 */
export type FieldPartsData<W extends WidgetName, D extends DescriptionState> = {
  Label: LabelData
  Control: ControlForWidget<W>
  Errors: ValidationError[]
} & DescriptionSlot<D>

/** The parts DATA bag for a group/array path (captions only). */
export type GroupPartsData<D extends DescriptionState> = {
  Label: TextData
} & DescriptionSlot<D>

/**
 * The neutral type surface a front-end resolves from its schema and brands onto
 * its tree (ADR 048 §1). Expressed purely in Core vocabulary so React can index
 * it generically. A concrete front-end `FormShapeOf<S>` is a subtype of this.
 */
export interface FormShape {
  fields: Record<
    string,
    { value: unknown; widget: WidgetName; description: DescriptionState }
  >
  groups: Record<string, { description: DescriptionState }>
  arrays: Record<string, { description: DescriptionState }>
}

// TYPE TOUR — "phantom brand": a unique-symbol key that lives ONLY in the type and
// is never emitted at runtime (the front-end asserts it with a cast). It lets a
// plain tree and a "typed" tree be the SAME object at runtime yet DISTINCT to the
// compiler — the trick that lets React read per-schema types off an otherwise
// source-agnostic tree. Making the key REQUIRED (below) is what turns "handed an
// unbranded tree" from a silent loss of all narrowing into a loud type error
// (review finding #1).
declare const FORM_SHAPE: unique symbol

/**
 * A `GroupNode` carrying a phantom {@link FormShape} brand (ADR 048 §3). The
 * brand is a compile-time-only property (never present at runtime; asserted by
 * the front-end's return cast), so a `TypedTree` is an ordinary tree everywhere
 * the runtime looks, and only the type layer sees the resolved surface.
 *
 * The brand is **required**, not optional: a plain `GroupNode` (or a tree widened
 * back to `GroupNode`) is therefore NOT assignable to `TypedTree`, so a consumer
 * that hands an unbranded tree to `useRenderNodeRules` gets a loud type error
 * instead of a silent collapse to the permissive base surface (the alternative —
 * an optional phantom — defeats the whole point by accepting anything). It is
 * still never present at runtime; the front-end asserts it through an
 * `as unknown as TypedTree<…>` cast.
 *
 * The second parameter `Origin` threads the front-end's schema origin type
 * through the tree (ADR 033 §4 / bd wo8) exactly as `GroupNode<S>` did, so
 * `getField`/`walk` still surface `facts.origin.schema` at the front-end's type.
 */
export interface TypedTree<TS extends FormShape = FormShape, Origin = unknown>
  extends GroupNode<Origin> {
  readonly [FORM_SHAPE]: TS
}

/** Extract the branded {@link FormShape} from a tree (falls back to the permissive
 * base surface for an unbranded `GroupNode`). Named `TreeShapeOf` — not `ShapeOf`
 * — to avoid colliding with a front-end's own schema-shape helper (e.g. Zod's
 * internal `ShapeOf`). */
export type TreeShapeOf<T> =
  T extends TypedTree<infer TS, infer _Origin> ? TS : FormShape

/** The origin (`node.facts.origin.schema` type) carried by a tree (ADR 033 §4). */
export type OriginOf<T> = T extends GroupNode<infer S> ? S : unknown

// ═══════════════════════════════════════════════════════════════════════════
// Widget-override threading (bd bh7.8) — closing the `overrideWidgets` desync.
//
// `overrideWidgets(map)` (present.ts) re-presents matched leaves at RUNTIME; the
// SAME `const` map re-narrows the typed control at COMPILE time. The seam that
// carries the map from the runtime call to the type layer is a phantom brand on
// the returned resolver, threaded by `useFormTree` into the presented `form`'s
// `FormShape` brand — so a consumer who types off `form` (the actually-rendered
// tree) can no longer desync from what renders. Because a `FormShape.fields[P]`
// already carries `widget` and React derives the control lazily from it,
// overriding widgets is a NEUTRAL transform on the shape (no front-end import).
// ═══════════════════════════════════════════════════════════════════════════

/** A per-path `path → WidgetName` override map (the `overrideWidgets` argument). */
export type WidgetOverrideMap = Readonly<Record<string, WidgetName>>

// TYPE TOUR — a phantom on a FUNCTION type. `overrideWidgets` returns a
// `PresentationResolver` (a function) that ALSO carries the map type in an
// optional, never-emitted symbol property. Optional so the runtime value (a plain
// function) still satisfies it; the property exists ONLY so `WidgetOverridesOf`
// can read the map back off the resolver a consumer passed to `useFormTree`.
declare const WIDGET_OVERRIDES: unique symbol

/** A {@link WidgetOverrideMap}-carrying `PresentationResolver` — the typed return
 * of `overrideWidgets(map)`. The map rides in a phantom (never present at runtime),
 * so this is an ordinary resolver everywhere the runtime looks. */
export type WidgetOverrideResolver<
  S = unknown,
  O extends WidgetOverrideMap = WidgetOverrideMap,
> = PresentationResolver<S> & {
  readonly [WIDGET_OVERRIDES]?: O
}

/** Recover the {@link WidgetOverrideMap} a resolver carries, or the empty map for a
 * plain (unbranded) resolver — so a `useFormTree` caller without overrides re-brands
 * the presented `form` with the UNCHANGED shape. */
export type WidgetOverridesOf<R> = R extends {
  readonly [WIDGET_OVERRIDES]?: infer O
}
  ? [O] extends [WidgetOverrideMap]
    ? O
    : Record<never, WidgetName>
  : Record<never, WidgetName>

/** Re-narrow a {@link FormShape} by a widget-override map: each field path in `O`
 * takes `O[P]` as its widget (everything else unchanged), so the lazily-derived
 * `Control` re-narrows to the OVERRIDDEN archetype — matching what the runtime
 * `overrideWidgets(O)` resolver renders. Groups/arrays are untouched (widgets are a
 * field concern). An empty `O` is the identity transform. */
export type ApplyWidgetOverrides<
  TS extends FormShape,
  O extends WidgetOverrideMap,
> = {
  fields: {
    [P in keyof TS['fields']]: {
      value: TS['fields'][P]['value']
      // `& WidgetName` keeps this provably a `WidgetName` for the `FormShape`
      // constraint even while `O`/`TS` are still abstract type params.
      widget: (P extends keyof O ? O[P] : TS['fields'][P]['widget']) &
        WidgetName
      description: TS['fields'][P]['description']
    }
  }
  groups: TS['groups']
  arrays: TS['arrays']
}

/** The tree `useFormTree` returns as `form`: the input tree's brand re-narrowed by
 * the widget overrides its `resolvePresentation` carries (bd bh7.8). An unbranded
 * (plain `GroupNode`) input passes through unchanged. Typing a customize binding
 * off THIS tree (not the pre-override input) is desync-proof — it is the tree that
 * actually renders. */
export type OverriddenTree<T, R> =
  T extends TypedTree<infer TS, infer Origin>
    ? TypedTree<ApplyWidgetOverrides<TS, WidgetOverridesOf<R>>, Origin>
    : T
