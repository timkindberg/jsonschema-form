# ADR 013: A Declarative Template-Set Over the Continuation Engine — and Decomposing FormRenderer

**Date:** 2026-06-21
**Status:** Proposed
**Deciders:** Tim Kindberg

## Context

With `useSchemaForm` now rewired as pure sugar over `FormRenderer` (ADR 010), the engine's responsibilities are visible in one place — and `FormRenderer` bundles **three** distinct jobs:

1. **The engine** — recursion over the IR, `renderNode` dispatch, nearest-scope-wins context, and the re-entry handles (`node.Default`/`Children`/`child`/`parts.X.Default`).
2. **A default template-set** — the hardcoded JSX for each node *kind* and *part*: `DefaultField`/`DefaultGroup`/`DefaultPart` (a `<fieldset>` for groups, label+input/select for fields, etc.).
3. **Form chrome** — the `<form>` element and the submit button.

Two observations forced this ADR:

- **Porting App_08 onto the typed engine** showed the override ergonomics. To customize *one* node you write a `renderNode` arrow with a path check; to customize *all nodes of a kind* you write a `renderNode` switch on `node.isGroup`/`node.widget`. That works (ADR 012 §5) but it's a function where a **declarative map** would read better — and it's exactly what the old `Default*Template` overrides *felt* like, minus their dead-end (they couldn't hand control back to the engine).
- **Tim's framing:** "FormRenderer maybe did too much all at once." Is the default template-set a *separable, injectable* concern? Is there a meaningful **lower rung** — conceptually App_05's altitude — where the defaults are **not assembled for you**, i.e. you *configure the defaults* (or are forced to supply them) and the engine only drives recursion/scoping?

This is the **registration / component-registry skin already named in ADR 010 and deferred in ADR 012 §5**. This ADR sharpens its design and records the decomposition rationale; it does **not** yet authorize building it (see Status / Decision §4).

## Decision (proposed)

### 1. The default template-set is a concern *separate* from the engine

The continuation engine knows nothing about HTML. A **template-set** supplies the per-kind / per-part default rendering:

```ts
interface TemplateSet {
  field?: FC<{ node: EField }>
  group?: FC<{ node: EGroup }>
  array?: FC<{ node: EArray }>
  arrayItem?: FC<{ node: EArrayItem }>
  // optional finer granularity, keyed by widget and/or part:
  widgets?: Partial<Record<Widget, FC<{ node: ENode }>>>
  parts?: Partial<Record<PartName, (part: EnrichedPart) => ReactNode>>
}
```

Every template receives the **enriched** node, so it can re-enter the engine (`node.Children`, `node.child(p).Default`, `part.Default`) — it is *not* a dead-end the way the old `Default*Template`s were. This is the crucial difference from ADR 004's templates.

### 2. The declarative map desugars to a kind-switching `renderNode`

Supplying a template-set is sugar over the one primitive — no new engine capability (consistent with ADR 012 §5):

```tsx
// declarative (proposed)
<FormRenderer form={form} templates={{ group: MyGroup, widgets: { select: MySelect } }} />

// …is exactly:
renderNode={(node) => {
  if (node.isGroup) return <MyGroup node={node} />
  if (node.isField && node.widget === 'select') return <MySelect node={node} />
  return <node.Default />
}}
```

`renderNode` (the function) remains the general primitive; `templates` (the map) is the ergonomic, declarative skin for the common "swap defaults by kind" case. Both compose; a `renderNode` may still be passed alongside for per-node hijacks.

### 3. `FormRenderer` = engine + built-in template-set + chrome (a bundle)

`FormRenderer` stays the batteries-included rung: it injects the **built-in** template-set and renders form chrome. `templates={…}` overrides *entries* in that set (inherit the rest). The engine's own `node.Default` is, in effect, "render via the active template-set" — so the built-in defaults become *just the default template-set*, not privileged engine code.

### 4. Status: designed, **not yet built** — gated by the rule-of-three and the open decomposition

Per ADR 008 (swappability earned by a second implementation) and ADR 012 §5 (this skin is deferred until the UI second-implementation forces it), we do **not** build `templates` now. This ADR is **Proposed** to give the open decomposition discussion (below) a concrete artifact. It is promoted to **Accepted** when either (a) a second UI/template-set implementation forces the seam, or (b) the decomposition discussion resolves to build it deliberately.

## Open questions (for the FormRenderer-decomposition discussion)

These are deliberately unresolved here:

1. **Is a "no-defaults" rung worth exposing?** A layer where the engine drives recursion/scoping but renders *nothing* until you supply a template-set — the strict "configure-the-defaults" altitude (≈ App_05). Or is "override-some, inherit-the-rest" always enough, making a no-defaults rung academic?
2. **Where does form chrome live?** The `<form>` element and submit are currently baked into `FormRenderer`. Porting App_08's place-yourself sections required hand-writing `<button type="submit">` because **submit is not modeled as a part** (the spike faked `root.parts.submit`). Is form chrome (a) engine responsibility, (b) a root-node part, or (c) the consumer's job in the place-yourself branch?
3. **What's the new example's altitude?** Does the injectable template-set become **App_05B** (FormRenderer with a hand-provided template-set), sitting just below 06/06B?
4. **Relationship to styling (ADR 012 §4) and the UI-kit swap (ADR 010).** The template-set, the styling-hooks axis, and a full UI-kit/theme are three points on one spectrum; this ADR should not pre-empt where the UI-kit boundary lands.

## Consequences

- Records that the engine and the default template-set are *conceptually separable*, reframing the built-in defaults as "the default template-set" rather than privileged engine code — without forcing a refactor before it's earned.
- Gives the "FormRenderer does too much" discussion a concrete vocabulary (engine / template-set / chrome) and a concrete API sketch (`templates`).
- Defers implementation, honoring ADR 008's rule-of-three and ADR 012 §5; avoids a speculative public-API surface until forced.
- Surfaces "submit is not a part" as a real gap exposed by the App_08 port, to be decided in the decomposition chat.

## Alternatives Considered

- **Build `templates` now as accepted API** — rejected (for now): contradicts ADR 012 §5's explicit deferral and ADR 008's rule-of-three; the second template-set (a real UI kit) hasn't arrived to validate the shape.
- **Leave only `renderNode`** — viable but under-serves the common "swap all groups/fields" case; the declarative map is materially more ergonomic and recovers the ADR 004 template feel without the dead-end.
- **Resurrect `Default*Template` as the override mechanism** — rejected: they dead-end (no re-entry into the engine), which is the very flaw the continuation model (ADR 010) fixed.

---

**Relates to:** ADR 004 (the original React default templates — superseded mechanism), ADR 010 (continuation rendering; the named-but-deferred registration skin), ADR 008 (swappability earned by a second implementation), ADR 012 §4–§5 (styling axis; kind-level overrides desugar to `renderNode`).
