import { useSignals } from '@preact/signals-react/runtime'
import { useId, useState } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import type { PluginSession } from '@src/lib/communityPlugins/session'
import type { PluginInstallations } from '@src/lib/communityPlugins/installations'
import { InstalledPlugins } from '@src/lib/communityPlugins/InstalledPlugins'
import {
  pluginButton,
  pluginPrimaryButton,
} from '@src/lib/communityPlugins/presentation'
import { isPluginPermission } from '@src/lib/communityPlugins/persistence'
import { reportRejection } from '@src/lib/trap'
import styles from './PluginBuilder.module.css'

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
  const builderId = useId()
  const [approvedPermissions, setApprovedPermissions] = useState<string>()
  const permissions = source?.manifest.permissions ?? []
  const supported = permissions.every(isPluginPermission)
  const permissionKey = JSON.stringify([...permissions].sort())
  const approved =
    permissions.length === 0 || approvedPermissions === permissionKey
  const canPreview = !!source && !error && supported && approved
  const canInstall =
    canPreview && installations.ready.value && !installations.busy.value
  const running = session.status.value === 'Running'
  const install = (mode: 'snapshot' | 'development') => {
    if (source)
      void session
        .stop()
        .then(() =>
          installations.install(source, mode, path, new Set(permissions))
        )
        .catch(reportRejection)
  }

  return (
    <section
      aria-label="Plugin Builder"
      className={`${styles.root} min-h-0 min-w-0 flex-1 overflow-y-auto bg-2 text-default`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-7 sm:px-8">
        <header className="flex min-w-0 gap-4 border-b b-4 pb-6">
          <div className="mt-1 grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CustomIcon
              name="function"
              aria-hidden="true"
              className="h-7 w-7"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-2">
              Plugin Builder
            </p>
            <h1 className="break-words text-2xl font-semibold tracking-tight">
              {source?.manifest.name ?? 'Your local plugin'}
            </h1>
            {source?.manifest.description && (
              <p className="mt-2 max-w-2xl whitespace-pre-line break-words text-sm leading-6 text-2">
                {source.manifest.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-2">
              {source && (
                <>
                  <code className="max-w-full break-all rounded border b-4 bg-default px-2 py-1">
                    {source.manifest.id}
                  </code>
                  <span className="rounded bg-3/50 px-2 py-1">
                    API {source.manifest.apiVersion}
                  </span>
                </>
              )}
              <span className="rounded bg-3/50 px-2 py-1">Local source</span>
            </div>
            <p className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-2">
              <CustomIcon
                name="file"
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
              />
              <span className="truncate font-mono" title={path}>
                {path ?? 'Unsaved source'}
              </span>
            </p>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border b-4 bg-default p-4 text-sm"
          >
            <p className="font-semibold">This build needs attention</p>
            <p className="mt-1 break-words whitespace-pre-wrap text-2">
              {error.message}
            </p>
            <p className="mt-2 text-2">
              Switch to Code to fix the source. Any previous working instance
              stays available.
            </p>
          </div>
        )}

        <section
          aria-labelledby={`${builderId}-access`}
          className="rounded-xl border b-4 bg-default p-5"
        >
          <div className="mb-3 flex items-center gap-2">
            <CustomIcon
              name="lockClosed"
              aria-hidden="true"
              className="h-4 w-4 text-2"
            />
            <h2 id={`${builderId}-access`} className="text-sm font-semibold">
              Requested access
            </h2>
          </div>
          {!supported && (
            <div role="alert" className="text-sm text-2">
              <p>
                This plugin requests permissions that this version of ZDS does
                not support:
              </p>
              <p className="mt-2 break-all font-mono">
                {permissions
                  .filter((permission) => !isPluginPermission(permission))
                  .join(', ')}
              </p>
            </div>
          )}
          {permissions.length === 0 && (
            <p className="text-sm text-2">
              {source
                ? 'No additional permissions requested.'
                : 'Access requests will appear after the source compiles.'}
            </p>
          )}
          {permissions.length > 0 && supported && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-2/70 p-3">
              <input
                type="checkbox"
                aria-label="Allow this plugin to show notifications"
                aria-describedby={`${builderId}-notification-description`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={approved}
                onChange={(event) =>
                  setApprovedPermissions(
                    event.target.checked ? permissionKey : undefined
                  )
                }
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Allow this plugin to show notifications
                </span>
                <span
                  id={`${builderId}-notification-description`}
                  className="mt-1 block text-xs leading-5 text-2"
                >
                  Display messages in ZDS when you run a plugin command.
                </span>
              </span>
              <code className="ml-auto hidden shrink-0 text-xs text-2 sm:block">
                ui.notify
              </code>
            </label>
          )}
          {supported && permissions.length > 0 && !approved && (
            <p className="mt-3 text-xs text-2">
              Approve access to enable preview and installation.
            </p>
          )}
        </section>

        <div className={styles.workflow}>
          <section
            aria-labelledby={`${builderId}-preview`}
            className="rounded-xl border b-4 bg-default p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id={`${builderId}-preview`}
                className="text-base font-semibold"
              >
                Try a preview
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${running ? 'bg-primary/10 text-primary' : 'bg-2 text-2'}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-primary' : 'bg-4'}`}
                />
                {running ? 'Running' : 'Temporary'}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-2">
              Run this build while you work. Successful edits reload
              automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={pluginPrimaryButton}
                disabled={!canPreview}
                onClick={() => {
                  if (source)
                    void session
                      .start(source, new Set(permissions))
                      .catch(reportRejection)
                }}
              >
                <CustomIcon
                  name="play"
                  aria-hidden="true"
                  className="h-4 w-4"
                />
                {running ? 'Restart preview' : 'Start preview'}
              </button>
              <button
                type="button"
                className={pluginButton}
                disabled={!session.enabled.value}
                onClick={() => {
                  void session.stop().catch(reportRejection)
                }}
              >
                Stop preview
              </button>
            </div>
            <p
              role="status"
              className="mt-4 break-words text-xs leading-5 text-2"
            >
              {session.status.value}
            </p>
            <div className="mt-4 border-t b-4 pt-4 text-xs leading-5 text-2">
              <p>Closing the source document stops the preview.</p>
              <p className="mt-1">
                Install a copy to keep its commands and edit its saved settings.
              </p>
            </div>
          </section>

          <section
            aria-labelledby={`${builderId}-install`}
            className="overflow-hidden rounded-xl border b-4 bg-default"
          >
            <div className="border-b b-4 px-5 py-4">
              <h2
                id={`${builderId}-install`}
                className="text-base font-semibold"
              >
                Keep it installed
              </h2>
              <p className="mt-1 text-sm leading-6 text-2">
                Keep your plugin available across ZDS sessions.
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2">
                <CustomIcon
                  name="download"
                  aria-hidden="true"
                  className="h-4 w-4 text-2"
                />
                <h3 className="text-sm font-semibold">Snapshot</h3>
                <span className="ml-auto rounded bg-2 px-2 py-0.5 text-xs text-2">
                  Pinned source
                </span>
              </div>
              <p className="mb-3 mt-2 text-sm leading-6 text-2">
                Install this exact version. Later edits to the file won&apos;t
                change this copy.
              </p>
              <button
                type="button"
                className={pluginButton}
                disabled={!canInstall}
                onClick={() => install('snapshot')}
              >
                Install snapshot
              </button>
            </div>
            <div className="border-t b-4 px-5 py-4">
              <div className="flex items-center gap-2">
                <CustomIcon
                  name="code"
                  aria-hidden="true"
                  className="h-4 w-4 text-2"
                />
                <h3 className="text-sm font-semibold">Development</h3>
              </div>
              <p className="mb-3 mt-2 text-sm leading-6 text-2">
                Follow edits in this file. On restart, load its saved source.
              </p>
              <button
                type="button"
                className={pluginButton}
                disabled={!canInstall || !path}
                onClick={() => install('development')}
              >
                Install for development
              </button>
              {!path && (
                <p className="mt-2 text-xs text-2">
                  Save the source file to install for development.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="border-t b-4 pt-6">
          <InstalledPlugins manager={installations} />
        </div>
      </div>
    </section>
  )
}
