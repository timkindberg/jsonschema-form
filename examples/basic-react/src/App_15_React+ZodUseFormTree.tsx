// Zod end-to-end: compile → validate → bind → submit (ADR 034/035).
//
// 1. Define a Zod schema (structure + validation in one place).
// 2. Compile explicitly with zodToTree(schema).
// 3. Adapt validation explicitly with fromStandardSchema(schema).
// 4. Bind with useFormTree(tree, { validator }).
// 5. Submit through the hook's submit callback — not GroupNode/form.submit.
// 6. Wrap in FormStoreProvider so the Summary + field errors read the store.
// 7. One continuation customization; everything else stays default.
import { useState } from 'react'
import { z } from 'zod'
import { fromStandardSchema } from '@formframe/core'
import { zodToTree } from '@formframe/input-zod'
import {
  useFormTree,
  FormStoreProvider,
  SchemaFields,
  ValidationSummary,
} from '@formframe/renderer-react'

const schema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .meta({ title: 'Name', description: 'Your display name.' }),
  email: z.string().email('Enter a valid email').meta({ title: 'Email' }),
})

const tree = zodToTree(schema)
const validator = fromStandardSchema(schema)

function App() {
  const { form, submit, revalidate, handleBlur, store } = useFormTree(tree, {
    validator,
  })
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null)

  return (
    <div>
      <h1>Zod Form — compile, then bind (ADR 034/035)</h1>
      <p>
        <code>zodToTree(schema)</code> compiles structure;{' '}
        <code>fromStandardSchema(schema)</code> adapts validation;{' '}
        <code>useFormTree(tree, {'{ validator }'})</code> binds React behavior.
        Wrap the content in <code>FormStoreProvider</code> — errors, touched,
        submitted, and pending state all read from the hook&apos;s store.
      </p>
      <p>
        The email field below shows one continuation move: augment the label
        while keeping the default control and validation wiring.
      </p>

      <form
        noValidate
        onSubmit={submit((data) => setSaved(data))}
        onBlur={(event) => {
          handleBlur(event)
          revalidate(event)
        }}
      >
        <FormStoreProvider store={store}>
          <ValidationSummary />
          <SchemaFields
            form={form}
            renderNode={(node, { Default }) =>
              node.isField && node.path === 'email' ? (
                <Default
                  of={node}
                  parts={{
                    label: (label) => (
                      <span>
                        <Default of={label} />
                        <small
                          style={{
                            marginLeft: 6,
                            color: '#666',
                            fontWeight: 'normal',
                          }}
                        >
                          Account notifications only.
                        </small>
                      </span>
                    ),
                  }}
                />
              ) : (
                <Default of={node} />
              )
            }
          />
        </FormStoreProvider>
        <button type="submit">Save profile</button>
      </form>

      {saved && (
        <>
          <p style={{ color: 'green' }}>Saved valid data:</p>
          <pre>{JSON.stringify(saved, null, 2)}</pre>
        </>
      )}
    </div>
  )
}

export default App
