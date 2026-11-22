import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  pluginButton,
  pluginQuietButton,
} from '@src/lib/communityPlugins/presentation'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import type { PluginInstallations } from '@src/lib/communityPlugins/installations'
import { isPluginPermission } from '@src/lib/communityPlugins/persistence'
import { PluginSettings } from '@src/lib/communityPlugins/settings/PluginSettings'
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            Installed community plugins
          </h2>
          <span className="rounded-full bg-3/50 px-2 py-0.5 text-xs text-2">
            {manager.entries.value.length}
          </span>
        </div>
        <button
          type="button"
          className={pluginQuietButton}
          disabled={busy}
          onClick={() => {
            void manager.restore().catch(reportRejection)
          }}
        >
          <CustomIcon name="refresh" aria-hidden="true" className="h-4 w-4" />
          Reload installed plugins
        </button>
      </div>
      {busy && (
        <p role="status" className="text-xs text-2">
          Updating installed plugins...
        </p>
      )}
      {manager.error.value && (
        <p
          role="alert"
          className="rounded-lg border b-4 bg-default p-3 text-sm"
        >
          {manager.error.value.message}
        </p>
      )}
      {!manager.ready.value && !manager.error.value && (
        <p role="status" className="text-sm text-2">
          Loading installed plugins...
        </p>
      )}
      {manager.ready.value && manager.entries.value.length === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-dashed b-4 bg-default p-5">
          <CustomIcon
            name="function"
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-2"
          />
          <div>
            <p className="text-sm font-medium">No plugins installed yet</p>
            <p className="mt-1 text-xs leading-5 text-2">
              Open a .zds.ts or .zds.js file in Plugin Builder to install a
              copy.
            </p>
          </div>
        </div>
      )}
      {manager.entries.value.map((entry) => {
        const installation = entry.installation
        const review = entry.review.value
        return (
          <article
            key={installation.id}
            aria-label={installation.name}
            className="flex min-w-0 flex-col gap-3 rounded-xl border b-4 bg-default p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{installation.name}</h3>
              <span className="rounded bg-2 px-2 py-0.5 text-xs text-2">
                {installation.source.kind === 'snapshot'
                  ? 'Snapshot'
                  : 'Development'}
              </span>
            </div>
            {installation.description && (
              <p className="whitespace-pre-line break-words text-sm leading-6 text-2">
                {installation.description}
              </p>
            )}
            <p className="break-all font-mono text-xs text-2">
              {installation.source.kind === 'snapshot'
                ? 'Installed snapshot'
                : `Development source: ${installation.source.path}`}
            </p>
            <p
              role="status"
              className="w-fit max-w-full break-words rounded-md bg-2 px-2 py-1 text-xs text-2"
            >
              {entry.status.value}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
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
            <p className="text-xs text-2">
              Approved permissions: {entry.granted.value.join(', ') || 'None'}
            </p>
            {review && (
              <p className="text-xs text-2">
                Requested permissions:{' '}
                {review.manifest.permissions.join(', ') || 'None'}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                className={pluginButton}
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
                    className={pluginButton}
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
                  className={pluginButton}
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
                className={pluginButton}
                type="button"
                disabled={busy}
                onClick={() => {
                  void manager.uninstall(installation.id).catch(reportRejection)
                }}
              >
                Uninstall
              </button>
            </div>
            <PluginSettings entry={entry} manager={manager} busy={busy} />
            {entry.status.value === 'Running' && !entry.settingsPage.value && (
              <p className="border-t b-4 pt-3 text-xs leading-5 text-2">
                This version does not declare settings.
                {installation.source.kind === 'snapshot' &&
                  ' Snapshots keep the source from installation; install an updated copy to pick up new settings.'}
              </p>
            )}
          </article>
        )
      })}
    </section>
  )
}
