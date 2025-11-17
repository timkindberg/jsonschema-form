# ADR 005: Handler Inheritance via Parameters

**Date:** 2025-11-17  
**Status:** Accepted  
**Deciders:** Core team

## Context

After implementing the root handler in ADR 004, we hit recursion issues and complexity with manual handler passing. The core problem: `node.walk()` required handlers to be passed explicitly at every call, and the root handler caused infinite recursion when it tried to call `node.walk(handlers)` with itself included.

## Decision

**Pass handlers as a second parameter to all handler functions:**

```typescript
// Core types
export interface WalkHandlers<R> {
  field?: (node: FieldNode, handlers: WalkHandlers<R>) => R
  group?: (node: GroupNode, handlers: WalkHandlers<R>) => R
}
```

**Remove the root handler entirely.** The React layer wraps `form.walk()` results in `<DefaultRootTemplate>` instead - simpler and no recursion.

**Make templates purely presentational** - they receive `children` props instead of calling `node.walk()` themselves:

```tsx
// Handler does walking
const handlers = {
  field: (node) => <DefaultFieldTemplate node={node} />,
  group: (node, handlers) => (
    <DefaultGroupTemplate node={node}>
      {node.walk(handlers)}  // handlers passed automatically
    </DefaultGroupTemplate>
  ),
}

// Wrap result in root
<DefaultRootTemplate onSubmit={onSubmit}>
  {form.walk(handlers)}
</DefaultRootTemplate>
```

## Consequences

**Pros:**
- Handlers automatically inherit without manual tracking
- No recursion issues (root handler removed)
- Clean separation: handlers walk, templates present
- Type-safe: can't forget to pass handlers

**Cons:**
- Breaking change: all handler signatures must be updated
- Field handlers receive unused `handlers` parameter (leaf nodes)

**Migration:** Update handler signatures to accept `(node, handlers)` and pass `handlers` to `node.walk()` calls.

## Alternatives Considered

**Optional handlers:** `walk(handlers?)` using "current" handlers if omitted. Rejected - requires mutable state, makes API stateful.

**Different signatures for field vs group:** Rejected - inconsistency harder to learn than unused parameter.

---

**Last Updated:** 2025-11-17

