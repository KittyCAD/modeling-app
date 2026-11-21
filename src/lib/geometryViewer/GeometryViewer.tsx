import { useSignals } from '@preact/signals-react/runtime'
import type { ReadonlySignal } from '@preact/signals-core'
import { KclScene } from '@src/lib/kcl/modeling/KclScene'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { isErr } from '@src/lib/trap'

/** Presents an engine-backed model alongside an explicit destination for its KCL import. */
export function GeometryViewer({
  context,
}: {
  context: ComponentProps<typeof KclScene>['context'] & {
    targets: ReadonlySignal<readonly { path: string; label: string }[]>
    insert: (path: string) => Promise<Error | undefined>
  }
}) {
  useSignals()
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Error | string>()
  const targets = context.targets.value
  const insert = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      const error = await context.insert(target)
      setMessage(error ?? 'Import inserted')
    } catch (cause) {
      setMessage(
        isErr(cause)
          ? cause
          : new Error('Unable to insert the import', { cause })
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="3D viewer" className="flex h-full w-full flex-col">
      <div
        role="toolbar"
        aria-label="Model actions"
        className="flex shrink-0 items-center gap-2 border-b b-4 bg-2 p-2 text-sm"
      >
        <select
          aria-label="KCL destination"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value)
            setMessage(undefined)
          }}
          className="min-w-0 rounded border b-4 bg-1 p-1"
          disabled={busy}
        >
          <option value="">Choose a KCL file</option>
          {targets.map(({ path, label }) => (
            <option key={path} value={path}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !targets.some(({ path }) => path === target)}
          onClick={() => {
            void insert()
          }}
          className="rounded border b-4 px-2 py-1 hover:bg-3 disabled:opacity-50"
        >
          Insert into KCL
        </button>
        {message && (
          <span role={isErr(message) ? 'alert' : 'status'}>
            {isErr(message) ? message.message : message}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <KclScene context={context} />
      </div>
    </section>
  )
}
