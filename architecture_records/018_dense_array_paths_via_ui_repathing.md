# ADR 018: Dense Array Paths via UI Re-pathing — Relative Keys Decouple Identity from Path

**Date:** 2026-06-24
**Status:** Accepted
**Deciders:** Tim Kindberg

## Context

ADR 015 §6 chose **stable-sparse** array paths: a synthetic id is both the React
key *and* the path index, so after removing the first of two items the survivor
*stays* `contacts.1`. Submission was therefore sparse (`unflatten` yields a
leading hole), tracked as the `ux5` follow-up. The stated reason was remounting:
re-pathing a survivor "would re-path them, and the **path-keyed child fold would
remount them** — losing the very values we protect."

That sentence actually names **two distinct remount vectors**, and they were
never separated:

1. **Closure-type remount.** The default resolver *mounted* a fresh `node.Default`
   closure as JSX, so any real re-render made the component type new → remount.
   **ADR 016 fixed this** by rendering through calling (`node.Default()`) so the
   type is module-stable (`NodeRenderer`/`PartHost`/intrinsics).
2. **Path-key remount.** Independently, the engine's child fold tags each sibling
   with `key: c.path` and React's `combine` mounts `<Fragment key={c.path}>`. When
   a survivor re-paths (`contacts.1`→`contacts.0`), that key changes, so React
   unmounts the old subtree and mounts a new one — wiping the uncontrolled value —
   **even though ADR 016 made the re-render itself safe.**

ADR 016 claimed dense arrays were "unblocked," but it only removed vector 1.
Vector 2 still remounted, which a RED test confirmed: with dense re-minting in
place, the survivor's path went dense (`contacts.0.name`) but its value came back
empty. The path was being used as React's reconciliation **identity**, and those
are not the same thing — the exact "React key vs. form path" distinction that
motivated this work.

## Decision

**Decouple React identity from the form path.** The reconciliation key follows
*identity* (stable across re-paths); the path follows *position* (dense, 0-based).
`unflatten` and the node IR are untouched.

### 1. `renderChildren` keys children by *relative* identity, not absolute path

The defect was that the engine tagged each child with `key: c.path`. An absolute
path **cannot** be a re-pathed subtree's key: when `contacts.1` becomes
`contacts.0`, *every* descendant's path changes (`contacts.1.street` →
`contacts.0.street`), so a path key changes at every level and React remounts —
even though ADR 016 made the re-render itself safe. Stabilizing only the item's
own key is not enough; the volatile index sits in the whole prefix.

The fix is to key a child by its **relative identity**, which drops that prefix:

```
childKey(parent, child, i) = parent.isGroup ? lastSegment(child.path) : String(i)
```

Object containers (group, root) identify a child by its property **name**
(`street`, `city`) — the idiomatic stable list key; positional containers
(array, arrayItem) by **index**. An array item's content is its sole child, so
its `String(0)` is a constant, not a reordering-list index; an array's own items
are rendered by `ArrayRoot` under synthetic-id keys and that fold is discarded, so
its positional keys are never reconciled. Both relative forms are unique among
siblings and unchanged by a dense re-path, so the surviving subtree reconciles in
place. React's `combine` then renders `<Fragment key={c.key}>` verbatim.

This lives in Core because `renderChildren` is where the key is minted; it is a
correctness fix to an existing field (the contract already called `key` "stable"),
not a new seam. Vanilla joins markup and ignores keys, so conformance is
indifferent — the change is invisible to the oracle.

### 2. `ArrayRoot` re-paths survivors event-time, in the state updater

Each item slot is `{ id, core }`: `id` is the monotonic synthetic React key
(identity, never reused, never a path index); `core` is minted at the item's
**dense position**. On remove, the updater filters the dropped id then `densify`s
the result — a slot whose position is unchanged keeps its **exact `core`
reference** (so `NodeRenderer`'s `memo` bails and it does not re-render), while a
slot that shifted re-mints its `core` at the new index. Re-pathing happens at
event time, never during render, so render stays pure (ADR 017). Appending shifts
nothing, so it re-renders no existing item.

Together: the shifted survivor re-renders (vector-1-safe, ADR 016) under an
unchanged **relative** key (vector-2-safe, decision 1), so its `<input>`'s `name`
updates from `contacts.1.name` to `contacts.0.name` **in place** — DOM node and
typed value intact — and `new FormData` reads a dense, contiguous array.

## Consequences

- **Dense submission, `unflatten` untouched.** Removing the first of two items and
  submitting yields `{ contacts: [{ name: 'Bob' }] }`, not `[<hole>, …]`
  (`arrays.test.tsx`). `unflatten` never sees a gap, so no submit-time
  densification policy and no Core submit-semantics change are needed. This
  reverses ADR 015 §6 and closes `ux5`. (The only Core change is the key
  computation in `renderChildren` — a React-rendering hint, not submit logic.)
- **Perf contract, refined and still green** (`render-counts.test.tsx`):
  appending and removing the **last** item shift no position → zero existing
  re-renders; removing a **non-last** item re-renders *only the items after the
  gap* (to update their dense `name`s), in place, while items before the gap
  memo-bail. The "churn nothing on structural change" guarantee narrows to
  "churn only what genuinely re-paths," which is the minimum possible.
- **Conformance untouched.** Keys are not DOM; the canonical HTML is identical, so
  the vanilla oracle still matches React (`conformance.test.tsx`).
- **Identity ≠ path is now explicit.** A child's *relative* identity keys
  reconciliation, the synthetic id pins the item boundary in `ArrayRoot`, and the
  dense position drives the form path. Future reorder/insert operations (not just
  append/remove) inherit this for free — re-pathing already reconciles in place.

## Alternatives Considered

- **Submit-time densify (the `ux5` "Option B")** — compact the sparse array inside
  `unflatten`/`form.submit`, leaving DOM `name`s sparse. Rejected: it pushes a
  density policy into Core's submit semantics and leaves the rendered form and its
  submission disagreeing (`contacts.0,2` in the DOM, `[0,1]` submitted). Dense
  everywhere is simpler and keeps Core dumb.
- **Keep stable-sparse paths (ADR 015 §6 status quo)** — rejected: sparse FormData
  (`{ contacts: [null, {…}] }`) is a real consumer surprise and the original
  acknowledged gap; the whole point of `ux5` is to remove it.
- **Positional keys in React's `combine` (the first cut)** — index the fold in
  the adapter, ignoring the Core key. Rejected: it is the index-key anti-pattern,
  correct only *because* every fold reaching `combine` is currently static-order,
  and it discards a meaningful key — it would silently mis-reconcile the day
  `combine` folds a dynamic-membership list (e.g. conditional fields). Keying by
  relative identity in Core is barely larger, idiomatic (name keys), and future-proof.
- **Thread a stable per-item id into Core (Option 3: `getItem(index, id)`,
  substitute it for the index in keys)** — the fully general "identity ≠ path"
  model. Rejected *for now*: a per-instance id is **live-list state**, which
  belongs in the adapter — `ArrayRoot` already owns it, exactly as RHF's
  `useFieldArray` keeps its stable `id` in hook state, not in the schema. Relative
  keys make descendants stable **without propagating any id downward**, because
  reconciliation is hierarchical and the item boundary is already pinned by
  `ArrayRoot`'s synthetic-id key. Revisit only if a non-React consumer needs the
  *same* stable identity, at which point it is earned (ADR 008) and surfaced from
  the adapter — not baked into stateless Core.

---

**Relates to:** ADR 015 (reverses §6 — paths are now dense, not stable-sparse),
ADR 016 (completes it: 016 removed the closure-type remount and *claimed* dense
arrays were unblocked; this removes the **second**, path-key remount vector that
016 left, and adds the re-path itself), ADR 014 (sharpens the engine's
`ChildResult.key` from absolute path to *relative identity* — a Core-side
correctness fix to the fold's key contract, invisible to the string oracle),
ADR 017 (re-pathing runs event-time in the state updater, keeping render pure).
