import { useMemo, useState, type ReactNode } from 'react'
import { jsonSchemaToTree } from '@formframe/input-jsonschema'
import type {
  JSONSchema,
  FieldPaths,
  GroupPaths,
  ValueAt,
  FieldPartsFor,
  GroupPartsFor,
  NoOverrides,
} from '@formframe/input-jsonschema'
import type { WidgetName } from '@formframe/core'
import {
  customize,
  useFormTree,
  ValidationProvider,
  type CustomizeBuild,
  type CustomizeRegistrar,
  type PartSlot,
  type RenderNode,
  type EField,
  type EGroup,
} from '@formframe/renderer-react'
import { createAjvValidator } from '@formframe/validation-ajv'

// ═══════════════════════════════════════════════════════════════════════════
// The customize layer (ADR 041), on the SHIPPED API.
//
// This file also IS the typed binding recipe (ADR 024): the schema-owning type
// helpers live in @formframe/input-jsonschema (`FieldPaths`, `ValueAt`,
// `FieldPartsFor`, …), the source-agnostic runtime lives in
// @formframe/renderer-react (`customize`, `PartSlot`), and a consumer composes
// them into a path-narrowed registrar. React never imports the front-end (it
// stays Zod-ready); the front-end never imports React. They meet HERE.
// ═══════════════════════════════════════════════════════════════════════════

function defineSchema<const T extends JSONSchema>(s: T): T {
  return s
}

const schema = defineSchema({
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: 'Full name',
      description: 'As it appears on your ID.',
      minLength: 3,
    },
    plan: {
      type: 'string',
      title: 'Plan',
      enum: ['free', 'pro', 'enterprise'],
    },
    address: {
      type: 'object',
      title: 'Address',
      properties: {
        street: { type: 'string', title: 'Street' },
        city: { type: 'string', title: 'City' },
      },
      required: ['street'],
    },
  },
  required: ['name'],
})

type S = typeof schema

// ── The typed binding: map the front-end's part-DATA payloads onto React slots ──

/** Wrap each present part's DATA payload as a placeable React `PartSlot`. */
type SlotsOf<D> = { [K in keyof D]: PartSlot<D[K]> }

/** Path-narrowed field handler props (ADR 041 §4): path/value/control/parts all
 * narrow off the const schema `S`; `Default` re-enters the whole node. */
type FieldProps<
  P extends FieldPaths<S>,
  O extends Record<string, WidgetName> = NoOverrides,
> = {
  path: P
  node: EField
  value: ValueAt<S, P>
  Default: () => ReactNode
  parts: SlotsOf<FieldPartsFor<S, P, O>>
}
type GroupProps<P extends GroupPaths<S>> = {
  path: P
  node: EGroup
  Default: () => ReactNode
  parts: SlotsOf<GroupPartsFor<S, P>>
  children: ReactNode
}

/** The path-narrowed registrar — the neutral `CustomizeRegistrar`, re-typed. */
interface TypedRegistrar {
  field<P extends FieldPaths<S>>(
    path: P,
    Handler: (props: FieldProps<P>) => ReactNode
  ): void
  group<P extends GroupPaths<S>>(
    path: P,
    Handler: (props: GroupProps<P>) => ReactNode
  ): void
}

/** The one cast the recipe needs: the runtime is identical (same string paths,
 * same stable parts bag), only the STATIC types are narrower. */
function typedCustomize(build: (r: TypedRegistrar) => void): RenderNode {
  return customize(build as unknown as CustomizeBuild)
}

// ── Handlers (hoisted → stable identity → safe hooks + memo bail, §1) ─────────

// `name` HAS a description in the schema, so `parts.Description` exists here.
function RowName({ parts }: FieldProps<'name'>) {
  const [hint, setHint] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <parts.Control />
      <div>
        <parts.Label />{' '}
        <button
          type="button"
          onClick={() => setHint((v) => !v)}
          style={{ fontSize: 11 }}
        >
          {hint ? 'hide' : 'why?'}
        </button>
        <parts.Description />
        {hint && (
          <small style={{ color: '#666' }}>
            <code>useState</code> in a customize handler — legal because the
            handler is a mounted component (ADR 041 §1).
          </small>
        )}
        <parts.Errors />
      </div>
    </div>
  )
}

// Group label via the TYPED render prop: `l` is `{ text }`.
function CardGroup({ parts, children }: GroupProps<'address'>) {
  return (
    <fieldset
      style={{ border: '2px dashed teal', borderRadius: 8, padding: 12 }}
    >
      <parts.Label render={(l) => <legend>{l.text} (custom)</legend>} />
      {children}
    </fieldset>
  )
}

// FULL control hijack via the TYPED render prop: `c` is narrowed to the input
// member (`ControlAt<'address.street'>`), so `c.attrs` is the input attrs with no
// guard. Spread keeps FormData wiring (ADR 041 §5); we add attrs and drop `type`.
function StreetInput({ parts }: FieldProps<'address.street'>) {
  // presence narrowing: street has no description in the schema.
  // @ts-expect-error 'address.street' has no description part
  void parts.Description
  return (
    <div>
      <parts.Label />
      <parts.Control
        render={(c) => {
          const { type: _t, ...attrs } = c.attrs
          return (
            <input
              {...attrs}
              placeholder="123 Main St"
              autoComplete="street-address"
              style={{
                display: 'block',
                border: '2px solid darkorange',
                borderRadius: 6,
                padding: 6,
              }}
            />
          )
        }}
      />
      <parts.Errors />
    </div>
  )
}

function CityNote({ Default }: FieldProps<'address.city'>) {
  return (
    <div>
      <Default />
      <small style={{ color: '#888' }}>Used for tax estimation.</small>
    </div>
  )
}

const customizeRules = (r: TypedRegistrar): void => {
  r.field('name', RowName)
  r.group('address', CardGroup)
  r.field('address.street', StreetInput)
  r.field('address.city', CityNote)

  // INLINE handler → props inferred as FieldProps<'plan'> (no annotation).
  r.field('plan', ({ value, Default }) => {
    // Hover `value`: 'free' | 'pro' | 'enterprise' — from the schema enum.
    void value
    return <Default />
  })

  // ── Guardrails: each is a COMPILE ERROR. ───────────────────────────────────
  // @ts-expect-error 'nope' is not a field path
  r.field('nope', () => null)
  // @ts-expect-error 'address' is a GROUP, not a field
  r.field('address', () => null)
  // @ts-expect-error 'address.city' is a FIELD, not a group
  r.group('address.city', () => null)
}

function LiveCustomizedForm() {
  const tree = useMemo(() => jsonSchemaToTree(schema), [])
  const validator = useMemo(() => createAjvValidator(schema), [])
  const {
    SchemaFields: Fields,
    submit,
    revalidate,
    errors,
  } = useFormTree(tree, { validator })
  const renderNode = useMemo(() => typedCustomize(customizeRules), [])
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  return (
    <form noValidate onSubmit={submit((d) => setData(d))} onInput={revalidate}>
      <ValidationProvider errors={errors} showErrorsWhen="always">
        <Fields renderNode={renderNode} />
      </ValidationProvider>
      <button type="submit" style={{ marginTop: 12 }}>
        Submit
      </button>
      {data && (
        <pre style={{ background: '#f5f5f5', padding: 8, marginTop: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </form>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ borderBottom: '1px solid #ddd' }}>{title}</h2>
      {children}
    </div>
  )
}

// A plain neutral registrar (no schema types) still works — the source-agnostic
// floor. Here: a blanket rule via the shared `CustomizeRegistrar` type.
const _neutralExample: CustomizeBuild = (r: CustomizeRegistrar) => {
  r.allGroups(({ parts, children }) => (
    <fieldset>
      <parts.Label />
      {children}
    </fieldset>
  ))
}
void _neutralExample

export default function App() {
  return (
    <div>
      <h1>customize — path-narrowed props &amp; arrangeable parts (ADR 041)</h1>
      <p>
        In-editor: <code>{`r.field('…')`}</code>/<code>{`r.group('…')`}</code>{' '}
        narrow to real paths; <code>value</code> and <code>control</code> narrow
        to the schema; <code>parts</code> is derived per path (
        <code>parts.Description</code> exists on <code>name</code> but not{' '}
        <code>street</code>); every part takes a typed <code>render</code> prop;
        and <code>Default</code> re-enters the whole node. Type into the orange
        Street box and Submit.
      </p>
      <Section title="customize — narrowed props/parts, typed render-props, Default prop, live errors">
        <LiveCustomizedForm />
      </Section>
    </div>
  )
}
