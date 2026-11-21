import { useSignals } from '@preact/signals-react/runtime'
import { useState } from 'react'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import type { PluginSession } from '@src/lib/communityPlugins/session'
import { reportRejection } from '@src/lib/trap'

/** Permission approval belongs to the requested permission set, independently of any running generation. */
export function PluginBuilder({
  source,
  error,
  session,
}: {
  source: PluginSource | undefined
  error: Error | undefined
  session: PluginSession
}) {
  useSignals()
  const [approvedPermissions, setApprovedPermissions] = useState<string>()
  const permissions = source?.manifest.permissions ?? []
  const supported = permissions.every(
    (permission) => permission === 'ui.notify'
  )
  const permissionKey = JSON.stringify([...permissions].sort())
  const approved =
    permissions.length === 0 || approvedPermissions === permissionKey
  return (
    <section
      aria-label="Plugin Builder"
      className="flex flex-col gap-3 overflow-auto p-6 text-1"
    >
      <h2>Plugin Builder</h2>
      <p>{source?.manifest.name ?? 'Local plugin'}</p>
      <p role="status">{session.status.value}</p>
      {error && <p role="alert">{error.message}</p>}
      <p>Requested permissions: {permissions.join(', ') || 'None'}</p>
      {!supported && (
        <p role="alert">This prototype supports only ui.notify.</p>
      )}
      {permissions.length > 0 && supported && (
        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) =>
              setApprovedPermissions(
                event.target.checked ? permissionKey : undefined
              )
            }
          />
          Allow this plugin to show notifications
        </label>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={!source || !!error || !supported || !approved}
          onClick={() => {
            if (source)
              void session
                .start(source, new Set(permissions))
                .catch(reportRejection)
          }}
        >
          Start / approve reload
        </button>
        <button
          type="button"
          disabled={!session.enabled.value}
          onClick={() => {
            void session.stop().catch(reportRejection)
          }}
        >
          Stop
        </button>
      </div>
      <p>
        Edit in Code, then return here to inspect the build. Successful edits
        reload after starting. Closing the document stops the plugin.
      </p>
    </section>
  )
}
