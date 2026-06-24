# ADR 016: Render by Calling, Not Mounting — Stable Component Types in the React Fold

**Date:** 2026-06-23
**Status:** Accepted
**Deciders:** Tim Kindberg

## Context

ADR 015 set out to make the React fold behave like a hand-crafted tree, and its decision 2 (a `memo`'d, stable-`core` `NodeRenderer`) does prevent unrelated re-renders. But it left the underlying defect in place and only *suppressed its symptom*. ADR 015 even lists "keep `<node.Default/>` as a fresh-closure component" under rejected alternatives — yet the default resolver still **mounted** `<node.Default/>`, and the `root` components still mounted `<part.Default/>`. The memo floor merely guaranteed those closures were rarely re-evaluated; it never made re-evaluation *safe*.

**The flaw, precisely.** `enrich`/`enrichParts` mint a fresh `Default` closure every run. Mounting one as JSX (`<node.Default/>`) makes its **component type identity new on every render**. React reconciles by type, so the instant a node *actually* re-renders — not a memo bail — React unmounts and remounts the whole subtree, discarding uncontrolled `<input>` DOM and the user's typed value. The memo floor hid this because, with a stable `core` and a stable resolver, nodes never re-rendered. Two ordinary situations break that assumption:

- a consumer **inlines `renderNode`** (`renderNode={(node) => node.Default()}`) — a new closure each parent render, so the resolver prop changes and every `NodeRenderer` legitimately re-renders;
- **dense arrays** (the `ux5` follow-up) require an item's `core`/path to change on reorder, which is a real re-render.

In both, "avoid re-rendering" is not available — the node *must* re-render, and re-rendering must reconcile in place. A library that wipes inputs whenever a node re-renders is the fragility ADR 015 was meant to remove; it was only deferred.

**The tell was already in the codebase.** The vanilla oracle (R = string) cannot JSX-mount anything, so it was *forced* into the correct shape: `const resolver = renderNode ?? ((node) => node.Default())`, and every part is `part.Default()`. React was the lone outlier — it copied the pretty `<node.Default/>` ergonomic and inherited a remount footgun the string fold never had.

## Decision

**React renders continuation handles by *calling* them, exactly as vanilla does — never by mounting them as JSX.** `{node.Default()}`, `{node.Children()}`, `{part.Default()}`. A handle is a per-render closure; *calling* it returns markup composed only of **module-level component types** (`NodeRenderer`, `ArrayRoot`, `PartHost`) and intrinsic elements (`<div>`, `<input>`, …), all of which reconcile in place. *Mounting* it would make the closure itself the type. This unifies the two adapters: the calling convention is no longer a vanilla quirk but the contract.

### 1. The default resolver calls

`defaultResolver = (node) => node.Default()` (was `(node) => <node.Default/>`). `NodeRenderer` now renders the node's default *markup* directly, so its child is a stable type (`<div className="jsf-field">…`), not a fresh `node.Default` component. A real re-render updates attributes (e.g. an input's `name`) in place; the DOM node — and its uncontrolled value — survives.

### 2. `renderPart` — the part-level seam, mirroring `renderChild`

Parts cannot simply be inlined, because two of them (`array.addButton`, `arrayItem.removeButton`) read a behavior Context (ADR 015 §5). Calling such a renderer inline in its parent would read Context from *above* the parent's own Provider and miss the actions. So the engine gains a second strategy seam beside `renderChild`:

```
createContinuation<R>(adapter, { renderChild?, renderPart? })
renderPart(render: () => R): R
```

`enrichParts` builds each part's render thunk and, if `renderPart` is supplied, hands the thunk to it; otherwise it invokes the thunk eagerly (the string fold — unchanged). The two seams exist for one reason: a *called* continuation handle must yield a **stable component type** at the call site, not a per-render one.

### 3. `PartHost` — the one module-level part component

React supplies `renderPart: (render) => <PartHost render={render} />`, where `PartHost({ render }) { return render() }` is module-stable. Every part renders through this single type, so across re-renders React reconciles in place rather than remounting a fresh closure. It also gives the part its own fiber **below** whatever Provider its parent rendered, so a Context-reading button (placed by `ArrayRoot` inside its `ArrayActionsContext.Provider`) still sees the actions — the exact thing inline-calling would break.

### 4. The customization API is `{node.Default()}`, not `<node.Default/>`

This refines ADR 010's ergonomic. The continuation handles (`Default`, `Children`, `child(p).Default`, `parts.X.Default`) are **called**; their results are placed with `{…}`. `Default`/`child().Default` accept their options as an argument: `node.Default({ parts })`, `address.Default({ renderNode })`. The adapter, examples (`App_08`), and tests all model this. `<node.Default/>` is no longer how you re-enter — it is the anti-pattern this ADR removes (it still *type-checks*, because a handle is a function, but it reintroduces the remount and is documented against).

## Consequences

- **A node that truly re-renders reconciles in place.** New, sharper test: an inlined `renderNode` (fresh identity each parent render) forces every `NodeRenderer` to re-render, and the field's input keeps both its value *and* its exact DOM node (`render-stability.test.tsx`). This is the case ADR 015's memo floor could not cover.
- **Re-render safety unblocks dense arrays.** With re-renders no longer remounting, an array item's `core`/path can change on reorder and reconcile — so `ux5` (dense submission via UI re-pathing) becomes a localized change rather than an architectural blocker. ADR 015 §6 chose stable-sparse paths *because* re-pathing remounted; that constraint is now lifted.
- **One render path, two strategies.** `renderChild` + `renderPart` are the complete seam set: vanilla invokes both eagerly (string fold), React wraps both in stable components (`NodeRenderer`, `PartHost`). Conformance is untouched — both still emit identical markup (the React override cases in `conformance.test.tsx` are now *textually* the vanilla cases).
- **The perf contract is unchanged and still green.** `PartHost` re-renders only when its node's `NodeRenderer` re-renders (its `render` prop is recreated only then); the memo floor and the counting-adapter numbers (ADR 015 §7) hold.
- **Fewer fibers, not more.** Fields/groups/items no longer get a throwaway `node.Default` fiber; they render as inline markup under their `NodeRenderer`. Only `NodeRenderer`, `ArrayRoot`, and `PartHost` are mounted components — every one module-level.

## Alternatives Considered

- **Memoize `enrich` by `core` so the closure is stable per node** — rejected: it makes re-renders with an *unchanged* core safe (which the memo floor already gave us) but a *changed* core (dense) still produces a new closure → new type → remount. It is the same half-measure, dressed differently, and it is not "components defined outside render."
- **Keep `<node.Default/>` and forbid inline `renderNode`** — rejected: inlining a render prop is idiomatic React; a form library may not outlaw it. The fix belongs in the library, not the consumer's discipline.
- **Inline-call every part (no `PartHost`)** — rejected: the Context-reading buttons would read their actions from above their own Provider and render inert. `PartHost` is the minimal stable fiber that fixes this uniformly for all parts (and any future stateful part).
- **A React-specific `renderDefault`/`renderNode` host too** — unnecessary: `node.Default()` already returns markup whose top type is stable (`<div>`/`<fieldset>`/`<ArrayRoot/>`). Only parts needed a host, for the Context reason above.

---

**Relates to:** ADR 010 (refines the continuation ergonomic: re-enter by *calling* `{node.Default()}`, not mounting `<node.Default/>`), ADR 013 (`renderPart` joins `combine`/`root` as renderer-set machinery; `PartHost` is the React wiring), ADR 014 (`renderPart` is the part-level twin of `renderChild`; both keep the fold's output a markup contract), ADR 015 (completes its intent — its decisions 1–2 *avoided* re-renders; this makes re-renders *safe*, and lifts the §6 constraint that blocked dense arrays).
