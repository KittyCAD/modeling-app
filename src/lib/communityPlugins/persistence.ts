import { REGEXP_UUIDV4 } from '@src/lib/constants'
import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { isErr, reportRejection } from '@src/lib/trap'
import { isArray, isRecord } from '@src/lib/utils'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { SettingValue } from '@zoo/zds-plugin'
import {
  isSettingKey,
  isSettingValue,
} from '@src/lib/communityPlugins/settings/schema'

export const supportedPluginPermissions = ['ui.notify'] as const
export type PluginPermission = (typeof supportedPluginPermissions)[number]

/** Installation identity is host-assigned; source identity and activation preference carry no grants. */
export interface PluginInstallation {
  id: string
  pluginId: string
  name: string
  description?: string
  enabled: boolean
  source:
    | { kind: 'snapshot'; contents: string }
    | { kind: 'development'; path: string }
}

/** Grants belong to installation identities and are removed with their installation. */
export interface PluginPreferences {
  version: 1
  installations: readonly PluginInstallation[]
  grants: readonly {
    installationId: string
    permissions: readonly PluginPermission[]
  }[]
  settings: readonly {
    installationId: string
    values: Readonly<Record<string, SettingValue>>
  }[]
}

export interface PluginPreferencesSnapshot {
  preferences: PluginPreferences
  token: string | null
}

export interface PluginStorage {
  load: () => Promise<PluginPreferencesSnapshot | Error>
  save: (
    preferences: PluginPreferences,
    expectedToken: string | null
  ) => Promise<PluginPreferencesSnapshot | Error>
  subscribe?: (changed: () => void) => () => void
}

export const emptyPluginPreferences = (): PluginPreferences => ({
  version: 1,
  installations: [],
  grants: [],
  settings: [],
})

export function isPluginPermission(value: unknown): value is PluginPermission {
  return value === 'ui.notify'
}

/** Parse the complete document before permitting any activation or mutation. Invalid stores are never reset implicitly. */
export function parsePluginPreferences(
  contents: string
): PluginPreferences | Error {
  try {
    if (contents.length > 5_000_000)
      return new Error('Plugin preferences exceed 5 MB.')
    const value: unknown = parseToml(contents)
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !isArray(value.installations) ||
      !isArray(value.grants)
    )
      return new Error('Unsupported plugin preferences schema.')
    if (value.installations.length > 32)
      return new Error('At most 32 plugins can be installed.')
    const installations: PluginInstallation[] = []
    const ids = new Set<string>()
    for (const item of value.installations) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        !REGEXP_UUIDV4.test(item.id) ||
        ids.has(item.id) ||
        typeof item.plugin_id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(item.plugin_id) ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name.length > 120 ||
        (item.description !== undefined &&
          (typeof item.description !== 'string' ||
            item.description.length > 2000)) ||
        typeof item.enabled !== 'boolean' ||
        !isRecord(item.source)
      )
        return new Error('Invalid or duplicate plugin installation.')
      let source: PluginInstallation['source']
      if (
        item.source.kind === 'snapshot' &&
        typeof item.source.contents === 'string' &&
        item.source.contents.length <= 128_000
      )
        source = { kind: 'snapshot', contents: item.source.contents }
      else if (
        item.source.kind === 'development' &&
        typeof item.source.path === 'string' &&
        item.source.path.trim() &&
        item.source.path.length <= 4096
      )
        source = { kind: 'development', path: item.source.path }
      else return new Error('Invalid plugin source reference.')
      ids.add(item.id)
      installations.push({
        id: item.id,
        pluginId: item.plugin_id,
        name: item.name,
        ...(typeof item.description === 'string' && item.description.trim()
          ? { description: item.description.trim() }
          : {}),
        enabled: item.enabled,
        source,
      })
    }
    const grants: PluginPreferences['grants'][number][] = []
    const granted = new Set<string>()
    for (const grant of value.grants) {
      if (
        !isRecord(grant) ||
        typeof grant.installation_id !== 'string' ||
        !ids.has(grant.installation_id) ||
        granted.has(grant.installation_id) ||
        !isArray(grant.permissions) ||
        !grant.permissions.every(isPluginPermission)
      )
        return new Error('Invalid plugin permission grant.')
      granted.add(grant.installation_id)
      grants.push({
        installationId: grant.installation_id,
        permissions: [...new Set(grant.permissions)],
      })
    }
    const settings: PluginPreferences['settings'][number][] = []
    const configured = new Set<string>()
    if (value.settings !== undefined && !isArray(value.settings))
      return new Error('Invalid plugin settings collection.')
    for (const record of value.settings ?? []) {
      if (
        !isRecord(record) ||
        typeof record.installation_id !== 'string' ||
        !ids.has(record.installation_id) ||
        configured.has(record.installation_id) ||
        !isRecord(record.values) ||
        Object.keys(record.values).length > 128 ||
        Object.entries(record.values).some(
          ([key, value]) => !isSettingKey(key) || !isSettingValue(value)
        )
      )
        return new Error('Invalid plugin setting overrides.')
      configured.add(record.installation_id)
      const values: [string, SettingValue][] = []
      for (const [key, value] of Object.entries(record.values)) {
        if (isSettingValue(value)) values.push([key, value])
      }
      settings.push({
        installationId: record.installation_id,
        values: Object.fromEntries(values),
      })
    }
    return { version: 1, installations, grants, settings }
  } catch (cause) {
    return new Error(
      `Cannot read plugin preferences: ${isErr(cause) ? cause.message : String(cause)}`
    )
  }
}

export function serializePluginPreferences(
  preferences: PluginPreferences
): string {
  return stringifyToml({
    version: preferences.version,
    installations: preferences.installations.map(({ pluginId, ...item }) => ({
      ...item,
      plugin_id: pluginId,
    })),
    grants: preferences.grants.map(({ installationId, permissions }) => ({
      installation_id: installationId,
      permissions: [...permissions],
    })),
    settings: preferences.settings.map(({ installationId, values }) => ({
      installation_id: installationId,
      values: { ...values },
    })),
  })
}

/** The user's configuration filesystem owns this document; no project settings participate. */
export function createFilePluginStorage(
  operations: Pick<FileOperationsRegistryService, 'readFile' | 'writeFile'>,
  path: string
): PluginStorage {
  const sender = crypto.randomUUID()
  const channelName = `zds.communityPlugins:${path}`
  const read = async (): Promise<string | null | Error> => {
    try {
      return new TextDecoder().decode(await operations.readFile(path))
    } catch (cause) {
      return cause instanceof FileNotFound
        ? null
        : new Error(
            `Cannot read installed plugins: ${isErr(cause) ? cause.message : String(cause)}`
          )
    }
  }
  const load = async (): Promise<PluginPreferencesSnapshot | Error> => {
    const token = await read()
    if (isErr(token)) return token
    const preferences =
      token === null ? emptyPluginPreferences() : parsePluginPreferences(token)
    return isErr(preferences) ? preferences : { preferences, token }
  }
  return {
    load,
    subscribe: (changed) => {
      if (typeof BroadcastChannel === 'undefined') return () => {}
      const channel = new BroadcastChannel(channelName)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isRecord(event.data) && event.data.sender !== sender) changed()
      }
      return () => channel.close()
    },
    save: async (preferences, expectedToken) => {
      const write = async (): Promise<PluginPreferencesSnapshot | Error> => {
        const current = await read()
        if (isErr(current)) return current
        if (current !== expectedToken)
          return new Error(
            'Installed plugins changed elsewhere. Reload the list before saving.'
          )
        const token = serializePluginPreferences(preferences)
        const checked = parsePluginPreferences(token)
        if (isErr(checked)) return checked
        try {
          await operations.writeFile(path, token)
        } catch (cause) {
          return new Error(
            `Cannot save installed plugins: ${isErr(cause) ? cause.message : String(cause)}`
          )
        }
        if (typeof BroadcastChannel !== 'undefined') {
          let channel: BroadcastChannel | undefined
          try {
            channel = new BroadcastChannel(channelName)
            channel.postMessage({ sender })
          } catch (cause) {
            reportRejection(cause)
          } finally {
            channel?.close()
          }
        }
        return { preferences: checked, token }
      }
      // Same-origin windows serialize the compare/write pair; the token also detects external edits.
      return globalThis.navigator?.locks
        ? navigator.locks.request(`zds.communityPlugins:${path}`, write)
        : write()
    },
  }
}
