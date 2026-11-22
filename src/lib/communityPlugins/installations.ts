import {
  computed,
  signal,
  type Signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import {
  emptyPluginPreferences,
  isPluginPermission,
  type PluginInstallation,
  type PluginPermission,
  type PluginPreferences,
  type PluginPreferencesSnapshot,
  type PluginStorage,
} from '@src/lib/communityPlugins/persistence'
import {
  createPluginSession,
  type PluginSession,
} from '@src/lib/communityPlugins/session'
import {
  compilePlugin,
  type PluginSource,
} from '@src/lib/communityPlugins/source'
import type { PluginRuntime } from '@src/lib/communityPlugins/runtime'
import type { SettingValue } from '@zoo/zds-plugin'
import type { SettingsPage } from '@src/registry/contracts/settingsPages'
import {
  acceptsSettingValue,
  readPluginSetting,
} from '@src/lib/communityPlugins/settings/schema'
import { isErr, reportRejection } from '@src/lib/trap'

export interface InstalledPlugin {
  installation: PluginInstallation
  session: PluginSession
  review: Signal<PluginSource | undefined>
  granted: Signal<readonly PluginPermission[]>
  issue: Signal<string | undefined>
  status: ReadonlySignal<string>
  settingsPage: ReadonlySignal<SettingsPage | undefined>
  settingsValues: ReadonlySignal<Readonly<Record<string, SettingValue>>>
  suspended: boolean
  epoch: number
}

/** Retained installations outlive editor panes; runtime instances and resource access never persist. */
export function createPluginInstallations({
  storage,
  readSource,
  publish,
  notify,
  getSettingsPage = () => undefined,
}: {
  storage: () => Promise<PluginStorage>
  readSource: (path: string) => Promise<string>
  publish: (
    id: string,
    runtime: PluginRuntime | undefined,
    source?: PluginSource,
    grants?: ReadonlySet<string>
  ) => Promise<Error | undefined>
  notify: (message: string) => void
  getSettingsPage?: (id: string) => SettingsPage | undefined
}) {
  const entries = signal<readonly InstalledPlugin[]>([])
  const values = signal<PluginPreferences['settings']>([])
  const ready = signal(false)
  const error = signal<Error | undefined>(undefined)
  const busy = signal(false)
  let snapshot: PluginPreferencesSnapshot = {
    preferences: emptyPluginPreferences(),
    token: null,
  }
  let store: PluginStorage | undefined
  let unsubscribe: (() => void) | undefined
  let storeGeneration = 0
  const background = new Set<Promise<void>>()
  const buffers = new Map<
    symbol,
    { path: string; source: PluginSource | Error }
  >()
  let disposed = false
  let pending = Promise.resolve<Error | undefined>(undefined)
  const enqueue = (work: () => Promise<Error | undefined>) => {
    const next = pending.then(async () => {
      if (disposed) return new Error('Plugin installations are closed.')
      busy.value = true
      try {
        const result = await work()
        error.value = result
        return result
      } catch (cause) {
        const result = isErr(cause) ? cause : new Error(String(cause))
        error.value = result
        return result
      } finally {
        busy.value = false
      }
    })
    pending = next
    return next
  }
  const save = async (preferences: PluginPreferences) => {
    if (!ready.peek() || !store)
      return new Error('Installed plugins have not loaded.')
    const saved = await store.save(preferences, snapshot.token)
    if (isErr(saved)) return saved
    snapshot = saved
    values.value = saved.preferences.settings
    for (const entry of entries.peek()) {
      const installation = saved.preferences.installations.find(
        (item) => item.id === entry.installation.id
      )
      if (installation) entry.installation = installation
      entry.granted.value =
        saved.preferences.grants.find(
          (grant) => grant.installationId === entry.installation.id
        )?.permissions ?? []
    }
    entries.value = [...entries.peek()]
    return undefined
  }
  const makeEntry = (installation: PluginInstallation): InstalledPlugin => {
    const session = createPluginSession(
      (runtime, source, grants) =>
        publish(installation.id, runtime, source, grants),
      notify,
      (key, contributions) =>
        readPluginSetting(
          contributions,
          key,
          snapshot.preferences.settings.find(
            (item) => item.installationId === installation.id
          )?.values
        )
    )
    const issue = signal<string | undefined>(undefined)
    return {
      installation,
      session,
      issue,
      status: computed(() => issue.value ?? session.status.value),
      settingsPage: computed(() => getSettingsPage(installation.id)),
      settingsValues: computed(
        () =>
          values.value.find((item) => item.installationId === installation.id)
            ?.values ?? {}
      ),
      review: signal<PluginSource | undefined>(undefined),
      granted: signal<readonly PluginPermission[]>(
        snapshot.preferences.grants.find(
          (grant) => grant.installationId === installation.id
        )?.permissions ?? []
      ),
      suspended: !installation.enabled,
      epoch: 0,
    }
  }
  const currentBuffer = (path: string | undefined) =>
    path
      ? [...buffers.values()].reverse().find((buffer) => buffer.path === path)
          ?.source
      : undefined
  const find = (id: string) =>
    entries.peek().find((entry) => entry.installation.id === id)
  const reconcile = async (
    entry: InstalledPlugin,
    supplied?: PluginSource | Error
  ) => {
    const epoch = ++entry.epoch
    const installation = entry.installation
    if (disposed || entry.suspended || !installation.enabled) return
    try {
      const path =
        installation.source.kind === 'development'
          ? installation.source.path
          : undefined
      const buffer = currentBuffer(path)
      const compiled =
        supplied ??
        buffer ??
        (await compilePlugin(
          installation.source.kind === 'snapshot'
            ? installation.source.contents
            : await readSource(installation.source.path)
        ))
      if (disposed || entry.epoch !== epoch || entry.suspended) return
      if (isErr(compiled)) {
        entry.review.value = undefined
        entry.issue.value = compiled.message
        return
      }
      if (compiled.manifest.id !== installation.pluginId) {
        entry.review.value = undefined
        entry.issue.value =
          'The source now declares a different plugin. Install it separately.'
        return
      }
      entry.review.value = compiled
      const granted = new Set(
        snapshot.preferences.grants.find(
          (grant) => grant.installationId === installation.id
        )?.permissions ?? []
      )
      if (
        compiled.manifest.permissions.some(
          (permission) =>
            !isPluginPermission(permission) || !granted.has(permission)
        )
      ) {
        entry.issue.value =
          'Permission approval required. Any previous instance retains its existing grants.'
        return
      }
      entry.issue.value = undefined
      await entry.session.start(compiled, granted)
    } catch (cause) {
      if (!disposed && entry.epoch === epoch) {
        entry.review.value = undefined
        entry.issue.value = `Source unavailable: ${isErr(cause) ? cause.message : String(cause)}`
      }
    }
  }
  const restore = () =>
    enqueue(async () => {
      const generation = ++storeGeneration
      unsubscribe?.()
      unsubscribe = undefined
      // A reload revokes old instances before accepting another configuration snapshot.
      ready.value = false
      for (const entry of entries.peek()) {
        entry.suspended = true
        entry.epoch++
      }
      await Promise.all(entries.peek().map((entry) => entry.session.dispose()))
      entries.value = []
      store = await storage()
      if (disposed) return undefined
      unsubscribe = store.subscribe?.(() => {
        storeGeneration++
        for (const entry of entries.peek()) {
          entry.suspended = true
          entry.epoch++
          void entry.session.stop().catch(reportRejection)
        }
        void restore().catch(reportRejection)
      })
      const loaded = await store.load()
      if (isErr(loaded)) return loaded
      if (disposed || generation !== storeGeneration) return undefined
      snapshot = loaded
      values.value = loaded.preferences.settings
      entries.value = loaded.preferences.installations.map(makeEntry)
      ready.value = true
      for (const entry of entries.peek()) await reconcile(entry)
      return undefined
    })
  return {
    entries,
    ready,
    error,
    busy,
    restore,
    install: (
      source: PluginSource,
      mode: 'snapshot' | 'development',
      path: string | undefined,
      approved: ReadonlySet<string>
    ) =>
      enqueue(async () => {
        if (
          source.manifest.permissions.some(
            (permission) =>
              !isPluginPermission(permission) || !approved.has(permission)
          )
        )
          return new Error(
            'Approve the plugin permissions before installation.'
          )
        if (mode === 'development' && !path)
          return new Error(
            'Development installations require a saved source path.'
          )
        // Explicit reinstallation replaces one declared plugin, preserving its host-owned settings identity.
        // Older duplicate copies are retired together; their grants and settings are never merged.
        const previous = snapshot.preferences.installations.filter(
          (item) => item.pluginId === source.manifest.id
        )
        const replacedIds = new Set(previous.map((item) => item.id))
        const replacedEntries = entries
          .peek()
          .filter((entry) => replacedIds.has(entry.installation.id))
        const installation: PluginInstallation = {
          id: previous[0]?.id ?? crypto.randomUUID(),
          pluginId: source.manifest.id,
          name: source.manifest.name,
          ...(source.manifest.description
            ? { description: source.manifest.description }
            : {}),
          enabled: true,
          source:
            mode === 'snapshot'
              ? { kind: mode, contents: source.source }
              : { kind: mode, path: path! },
        }
        const permissions =
          source.manifest.permissions.filter(isPluginPermission)
        const failed = await save({
          ...snapshot.preferences,
          installations: previous.length
            ? snapshot.preferences.installations.flatMap((item) =>
                item.id === installation.id
                  ? [installation]
                  : replacedIds.has(item.id)
                    ? []
                    : [item]
              )
            : [...snapshot.preferences.installations, installation],
          grants: [
            ...snapshot.preferences.grants.filter(
              (grant) => !replacedIds.has(grant.installationId)
            ),
            { installationId: installation.id, permissions },
          ],
          settings: snapshot.preferences.settings.filter(
            (item) =>
              !replacedIds.has(item.installationId) ||
              item.installationId === installation.id
          ),
        })
        if (failed || disposed) return failed
        for (const entry of replacedEntries) {
          entry.suspended = true
          entry.epoch++
        }
        await Promise.all(
          replacedEntries.map((entry) => entry.session.dispose())
        )
        if (disposed) return undefined
        const entry = makeEntry(installation)
        entries.value = snapshot.preferences.installations.map((item) =>
          item.id === installation.id ? entry : find(item.id)!
        )
        await reconcile(
          entry,
          mode === 'development' ? (currentBuffer(path) ?? source) : source
        )
        return undefined
      }),
    setEnabled: (id: string, enabled: boolean) => {
      const entry = find(id)
      if (entry && !enabled) {
        entry.suspended = true
        entry.epoch++
        void entry.session.stop().catch(reportRejection)
      }
      return enqueue(async () => {
        const entry = find(id)
        if (!entry) return new Error('Plugin installation was removed.')
        const failed = await save({
          ...snapshot.preferences,
          installations: snapshot.preferences.installations.map((item) =>
            item.id === id ? { ...item, enabled } : item
          ),
        })
        if (failed || disposed) return failed
        entry.suspended = !enabled
        entry.issue.value = undefined
        if (enabled) await reconcile(entry)
        else await entry.session.stop()
        return undefined
      })
    },
    retry: (id: string) =>
      enqueue(async () => {
        const entry = find(id)
        if (!entry) return new Error('Plugin installation was removed.')
        await reconcile(entry)
        return undefined
      }),
    approve: (id: string, reviewed: PluginSource) =>
      enqueue(async () => {
        const entry = find(id)
        if (!entry || entry.review.peek() !== reviewed)
          return new Error(
            'The plugin changed. Review its current permissions.'
          )
        if (
          reviewed.manifest.permissions.some(
            (permission) => !isPluginPermission(permission)
          )
        )
          return new Error('This plugin requests unsupported permissions.')
        const permissions =
          reviewed.manifest.permissions.filter(isPluginPermission)
        const failed = await save({
          ...snapshot.preferences,
          grants: [
            ...snapshot.preferences.grants.filter(
              (grant) => grant.installationId !== id
            ),
            { installationId: id, permissions },
          ],
        })
        if (failed || disposed) return failed
        if (entry.review.peek() !== reviewed)
          return new Error(
            'The source changed during approval. Review its current permissions.'
          )
        await reconcile(entry, reviewed)
        return undefined
      }),
    revokePermissions: (id: string) => {
      const active = find(id)
      if (active) {
        active.suspended = true
        active.epoch++
        void active.session.stop().catch(reportRejection)
      }
      return enqueue(async () => {
        const entry = find(id)
        if (!entry) return new Error('Plugin installation was removed.')
        const failed = await save({
          ...snapshot.preferences,
          grants: snapshot.preferences.grants.filter(
            (grant) => grant.installationId !== id
          ),
        })
        if (failed || disposed) return failed
        await entry.session.stop()
        entry.issue.value = undefined
        entry.suspended = !entry.installation.enabled
        await reconcile(entry)
        return undefined
      })
    },
    uninstall: (id: string) => {
      const entry = find(id)
      if (entry) {
        entry.suspended = true
        entry.epoch++
        void entry.session.stop().catch(reportRejection)
      }
      return enqueue(async () => {
        const entry = find(id)
        const failed = await save({
          ...snapshot.preferences,
          installations: snapshot.preferences.installations.filter(
            (item) => item.id !== id
          ),
          grants: snapshot.preferences.grants.filter(
            (grant) => grant.installationId !== id
          ),
          settings: snapshot.preferences.settings.filter(
            (item) => item.installationId !== id
          ),
        })
        if (failed || !entry) return failed
        await entry.session.dispose()
        entries.value = entries.peek().filter((item) => item !== entry)
        return undefined
      })
    },
    setSetting: (id: string, key: string, value: SettingValue) =>
      enqueue(async () => {
        const entry = find(id)
        const page = entry?.settingsPage.peek()
        if (
          !entry ||
          entry.suspended ||
          !page ||
          !Object.hasOwn(page.fields, key)
        )
          return new Error('This setting is not active for the installation.')
        if (!acceptsSettingValue(page.fields[key], value))
          return new Error('The value does not match the declared setting.')
        const previous =
          snapshot.preferences.settings.find(
            (item) => item.installationId === id
          )?.values ?? {}
        return save({
          ...snapshot.preferences,
          settings: [
            ...snapshot.preferences.settings.filter(
              (item) => item.installationId !== id
            ),
            { installationId: id, values: { ...previous, [key]: value } },
          ],
        })
      }),
    resetSetting: (id: string, key?: string) =>
      enqueue(async () => {
        if (!find(id)) return new Error('Plugin installation was removed.')
        const previous =
          snapshot.preferences.settings.find(
            (item) => item.installationId === id
          )?.values ?? {}
        const remaining =
          key === undefined
            ? {}
            : Object.fromEntries(
                Object.entries(previous).filter(([name]) => name !== key)
              )
        return save({
          ...snapshot.preferences,
          settings: [
            ...snapshot.preferences.settings.filter(
              (item) => item.installationId !== id
            ),
            ...(Object.keys(remaining).length
              ? [{ installationId: id, values: remaining }]
              : []),
          ],
        })
      }),
    updateDevelopment: (
      path: string,
      source: PluginSource | Error,
      owner: symbol
    ) => {
      buffers.delete(owner)
      buffers.set(owner, { path, source })
      for (const entry of entries.peek()) {
        if (
          entry.installation.source.kind === 'development' &&
          entry.installation.source.path === path
        ) {
          const updating = reconcile(entry, source).catch(reportRejection)
          background.add(updating)
          void updating
            .then(() => background.delete(updating))
            .catch(reportRejection)
        }
      }
    },
    releaseDevelopment: (owner: symbol) => {
      buffers.delete(owner)
    },
    dispose: async () => {
      disposed = true
      unsubscribe?.()
      unsubscribe = undefined
      buffers.clear()
      for (const entry of entries.peek()) {
        entry.suspended = true
        entry.epoch++
      }
      await Promise.all(entries.peek().map((entry) => entry.session.dispose()))
      await pending
      await Promise.all(background)
    },
    settled: async () => {
      let previous: Promise<Error | undefined>
      do {
        previous = pending
        await pending
        await Promise.all(background)
        await Promise.all(
          entries.peek().map((entry) => entry.session.settled())
        )
      } while (previous !== pending || background.size > 0)
    },
  }
}

export type PluginInstallations = ReturnType<typeof createPluginInstallations>
