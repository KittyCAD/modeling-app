import { useSignals } from '@preact/signals-react/runtime'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import type { PluginInstallations } from '@src/lib/communityPlugins/installations'
import { isPluginPermission } from '@src/lib/communityPlugins/persistence'
import { reportRejection } from '@src/lib/trap'
import type { Registry } from 'plankton'

export function InstalledPluginsSection({ registry }: { registry: Registry }) {
  useSignals()
  const resolution = registry.observe(communityPluginsService).value
  return resolution.kind === 'ready' ? (
    <InstalledPlugins manager={resolution.value} />
  ) : null
}

/** Settings remain available when an installed source is closed, missing, or invalid. */
export function InstalledPlugins({
  manager,
}: {
  manager: PluginInstallations
}) {
  useSignals()
  const busy = manager.busy.value
  return (
    <section
      aria-label="Installed community plugins"
      className="flex flex-col gap-4"
    >
      <h2 className="text-lg">Installed community plugins</h2>
      {busy && <p role="status">Updating installed plugins...</p>}
      {manager.error.value && <p role="alert">{manager.error.value.message}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void manager.restore().catch(reportRejection)
        }}
      >
        Reload installed plugins
      </button>
      {!manager.ready.value && !manager.error.value && (
        <p role="status">Loading installed plugins...</p>
      )}
      {manager.ready.value && manager.entries.value.length === 0 && (
        <p>
          No community plugins installed. Open a .zds.ts or .zds.js file to
          install one.
        </p>
      )}
      {manager.entries.value.map((entry) => {
        const installation = entry.installation
        const review = entry.review.value
        return (
          <article
            key={installation.id}
            aria-label={installation.name}
            className="flex flex-col gap-2 rounded border b-4 p-3"
          >
            <h3>{installation.name}</h3>
            <p>
              {installation.source.kind === 'snapshot'
                ? 'Installed snapshot'
                : `Development source: ${installation.source.path}`}
            </p>
            <p role="status">{entry.status.value}</p>
            <label>
              <input
                type="checkbox"
                checked={installation.enabled}
                disabled={busy}
                onChange={(event) => {
                  void manager
                    .setEnabled(installation.id, event.target.checked)
                    .catch(reportRejection)
                }}
              />{' '}
              Enabled, including on startup
            </label>
            <p>
              Approved permissions: {entry.granted.value.join(', ') || 'None'}
            </p>
            {review && (
              <p>
                Requested permissions:{' '}
                {review.manifest.permissions.join(', ') || 'None'}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || !installation.enabled}
                onClick={() => {
                  void manager.retry(installation.id).catch(reportRejection)
                }}
              >
                Retry / reload source
              </button>
              {review &&
                review.manifest.permissions.some(
                  (permission) =>
                    !entry.granted.value.some((grant) => grant === permission)
                ) && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !installation.enabled ||
                      !review.manifest.permissions.every(isPluginPermission)
                    }
                    onClick={() => {
                      void manager
                        .approve(installation.id, review)
                        .catch(reportRejection)
                    }}
                  >
                    Approve requested permissions
                  </button>
                )}
              {entry.granted.value.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void manager
                      .revokePermissions(installation.id)
                      .catch(reportRejection)
                  }}
                >
                  Revoke permissions
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void manager.uninstall(installation.id).catch(reportRejection)
                }}
              >
                Uninstall
              </button>
            </div>
          </article>
        )
      })}
    </section>
  )
}
