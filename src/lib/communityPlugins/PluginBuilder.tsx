import { useSignals } from '@preact/signals-react/runtime'
import { useState } from 'react'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import type { PluginSession } from '@src/lib/communityPlugins/session'
import type { PluginInstallations } from '@src/lib/communityPlugins/installations'
import { InstalledPlugins } from '@src/lib/communityPlugins/InstalledPlugins'
import { reportRejection } from '@src/lib/trap'

/** Permission approval belongs to the requested permission set, independently of any running generation. */
export function PluginBuilder({
  source,
  error,
  session,
  installations,
  path,
}: {
  source: PluginSource | undefined
  error: Error | undefined
  session: PluginSession
  installations: PluginInstallations
  path: string | undefined
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
      <div className="flex flex-col gap-2">
        <p>
          Keep this plugin installed after closing its document or restarting
          ZDS.
        </p>
        <button
          type="button"
          disabled={
            !source ||
            !!error ||
            !supported ||
            !approved ||
            !installations.ready.value ||
            installations.busy.value
          }
          onClick={() => {
            if (source)
              void session
                .stop()
                .then(() =>
                  installations.install(
                    source,
                    'snapshot',
                    path,
                    new Set(permissions)
                  )
                )
                .catch(reportRejection)
          }}
        >
          Install snapshot
        </button>
        <button
          type="button"
          disabled={
            !source ||
            !!error ||
            !supported ||
            !approved ||
            !path ||
            !installations.ready.value ||
            installations.busy.value
          }
          onClick={() => {
            if (source)
              void session
                .stop()
                .then(() =>
                  installations.install(
                    source,
                    'development',
                    path,
                    new Set(permissions)
                  )
                )
                .catch(reportRejection)
          }}
        >
          Install for development
        </button>
        <p>
          Snapshots keep this exact source. Development installations follow
          this file's open buffer and reload it on startup.
        </p>
      </div>
      <p>
        Edit in Code, then return here to inspect the build. Successful edits
        reload after starting a preview. Closing the document stops the preview.
      </p>
      <InstalledPlugins manager={installations} />
    </section>
  )
}
