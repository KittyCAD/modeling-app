import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import type { AtprotoProjectApiConfig } from '@src/lib/atprotoSync/api'
import type { ExtensionSettingDefinition } from '@src/lib/settings/extensionSettings'
import { Setting } from '@src/lib/settings/initialSettings'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { reportRejection } from '@src/lib/trap'
import {
  type ConnectedIdentity,
  connectedIdentitiesService,
  connectedIdentityProvidersValueSpec,
} from '@src/registry/contracts/connectedIdentities'
import {
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
import { useState } from 'react'

export const ATPROTO_IDENTITY_PROVIDER_ID = 'atproto'
export const ATPROTO_AUTH_SETTING_CATEGORY = 'auth'
export const ATPROTO_AUTH_SETTING_NAME = 'atproto'
export const ATPROTO_AUTH_SYNC_SCOPE = 'include:nyc.noirot.cad.authSync'
export const ATPROTO_ARCHIVE_BLOB_SCOPE = 'blob:application/zip'
export const ATPROTO_PROJECT_RECORD_COLLECTION = 'nyc.noirot.cad.project'
export const ATPROTO_ARCHIVE_RECORD_COLLECTION = 'nyc.noirot.cad.archive'
export const ATPROTO_OAUTH_SCOPES = [
  'atproto',
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_ARCHIVE_BLOB_SCOPE,
] as const

export type AtprotoOAuthIdentityStatus =
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'error'

/**
 * Persisted ATProto account snapshot used for identity projection and plugin
 * activation. OAuth tokens and DPoP keys intentionally stay in the OAuth
 * connector/session store rather than in ZDS settings.
 */
export type AtprotoOAuthIdentity = {
  provider: typeof ATPROTO_IDENTITY_PROVIDER_ID
  did: string
  handle?: string
  pdsUrl?: string
  serviceUrl?: string
  authorizationServer?: string
  scopes: readonly string[]
  status: AtprotoOAuthIdentityStatus
  connectedAt: string
  expiresAt?: string
}

export type AtprotoOAuthConnectOptions = {
  scopes: readonly string[]
  input?: string
}

export type AtprotoOAuthConnector = {
  initialize?: () => Promise<AtprotoOAuthIdentity | null | undefined>
  createProjectApiConfig?: (
    identity: AtprotoOAuthIdentity
  ) => Promise<AtprotoProjectApiConfig>
  connect: (
    options: AtprotoOAuthConnectOptions
  ) => Promise<AtprotoOAuthIdentity>
  disconnect?: (identity: AtprotoOAuthIdentity) => Promise<void>
  refresh?: (
    identity: AtprotoOAuthIdentity
  ) => Promise<AtprotoOAuthIdentity | null | undefined>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRecord(value: JsonValue | undefined): value is {
  [key: string]: JsonValue
} {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isAtprotoOAuthIdentityStatus(
  value: unknown
): value is AtprotoOAuthIdentityStatus {
  return (
    value === 'connected' ||
    value === 'expired' ||
    value === 'revoked' ||
    value === 'error'
  )
}

export function isAtprotoOAuthIdentity(
  value: unknown
): value is AtprotoOAuthIdentity {
  return (
    isRecord(value) &&
    value.provider === ATPROTO_IDENTITY_PROVIDER_ID &&
    typeof value.did === 'string' &&
    value.did.startsWith('did:') &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === 'string') &&
    isAtprotoOAuthIdentityStatus(value.status) &&
    typeof value.connectedAt === 'string'
  )
}

function atprotoOAuthIdentityFromToml(
  value: JsonValue | undefined
): AtprotoOAuthIdentity | undefined {
  if (!isJsonRecord(value)) {
    return undefined
  }

  const identity = {
    provider: value.provider,
    did: value.did,
    handle: optionalString(value.handle),
    pdsUrl: optionalString(value.pds_url),
    serviceUrl: optionalString(value.service_url),
    authorizationServer: optionalString(value.authorization_server),
    scopes: Array.isArray(value.scopes)
      ? value.scopes.filter(
          (scope): scope is string => typeof scope === 'string'
        )
      : [],
    status: value.status,
    connectedAt: value.connected_at,
    expiresAt: optionalString(value.expires_at),
  }

  return isAtprotoOAuthIdentity(identity) ? identity : undefined
}

function compactTomlRecord(
  record: Record<string, JsonValue | undefined>
): { [key: string]: JsonValue } | undefined {
  const compacted = Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as { [key: string]: JsonValue }

  return Object.keys(compacted).length > 0 ? compacted : undefined
}

function atprotoOAuthIdentityToToml(value: unknown): JsonValue | undefined {
  if (!isAtprotoOAuthIdentity(value)) {
    return undefined
  }

  return compactTomlRecord({
    provider: value.provider,
    did: value.did,
    handle: value.handle,
    pds_url: value.pdsUrl,
    service_url: value.serviceUrl,
    authorization_server: value.authorizationServer,
    scopes: [...value.scopes],
    status: value.status,
    connected_at: value.connectedAt,
    expires_at: value.expiresAt,
  })
}

export function atprotoConnectedIdentityFromOAuthIdentity(
  identity: AtprotoOAuthIdentity
): ConnectedIdentity {
  return {
    id: `${ATPROTO_IDENTITY_PROVIDER_ID}:${identity.did}`,
    provider: ATPROTO_IDENTITY_PROVIDER_ID,
    label: identity.handle ?? identity.did,
    handle: identity.handle,
    did: identity.did,
    capabilities: [
      'atproto:oauth',
      ATPROTO_AUTH_SYNC_SCOPE,
      ATPROTO_ARCHIVE_BLOB_SCOPE,
    ],
    status: identity.status,
  }
}

function hasScope(identity: AtprotoOAuthIdentity, scope: string) {
  return identity.scopes.includes(scope)
}

function parseRepoScopeCollections(scope: string): Set<string> | 'all' | null {
  if (scope === 'repo') {
    return 'all'
  }

  if (scope.startsWith('repo:')) {
    const collection = scope.slice('repo:'.length)
    return collection ? new Set([collection]) : null
  }

  if (!scope.startsWith('repo?')) {
    return null
  }

  const params = new URLSearchParams(scope.slice('repo?'.length))
  const collections = params
    .getAll('collection')
    .filter((collection) => collection.length > 0)
  return collections.length > 0 ? new Set(collections) : 'all'
}

function hasRepoScopeForCollections(
  identity: AtprotoOAuthIdentity,
  requiredCollections: readonly string[]
) {
  const grantedCollections = new Set<string>()

  for (const scope of identity.scopes) {
    const collections = parseRepoScopeCollections(scope)
    if (collections === 'all') {
      return true
    }
    if (!collections) {
      continue
    }
    for (const collection of collections) {
      grantedCollections.add(collection)
    }
  }

  return requiredCollections.every((collection) =>
    grantedCollections.has(collection)
  )
}

export function isAtprotoSyncIdentity(value: unknown): boolean {
  if (!isAtprotoOAuthIdentity(value) || value.status !== 'connected') {
    return false
  }

  const hasRepoWriteScope =
    hasScope(value, ATPROTO_AUTH_SYNC_SCOPE) ||
    hasScope(value, 'transition:generic') ||
    hasRepoScopeForCollections(value, [
      ATPROTO_PROJECT_RECORD_COLLECTION,
      ATPROTO_ARCHIVE_RECORD_COLLECTION,
    ])
  const hasBlobScope =
    hasScope(value, ATPROTO_ARCHIVE_BLOB_SCOPE) ||
    hasScope(value, 'blob:*/*') ||
    hasScope(value, 'transition:generic')

  return hasScope(value, 'atproto') && hasRepoWriteScope && hasBlobScope
}

export function normalizeAtprotoOAuthIdentity(
  identity: AtprotoOAuthIdentity
): AtprotoOAuthIdentity {
  return {
    ...identity,
    provider: ATPROTO_IDENTITY_PROVIDER_ID,
    scopes: [...new Set(identity.scopes)],
    connectedAt: identity.connectedAt || new Date().toISOString(),
  }
}

function createUnavailableOAuthConnector(): AtprotoOAuthConnector {
  return {
    connect: async () => {
      throw new Error('ATProto OAuth connector is not configured.')
    },
  }
}

export const atprotoOAuthSetting: ExtensionSettingDefinition = {
  createSetting: () =>
    new Setting<AtprotoOAuthIdentity | null>({
      defaultValue: null,
      title: 'ATProto account',
      description: 'Connected ATProto account used for experimental sync.',
      validate: (value) => value === null || isAtprotoOAuthIdentity(value),
      hideOnLevel: 'project',
      Component: AtprotoOAuthSetting,
    }),
  userToml: {
    sectionKey: ATPROTO_AUTH_SETTING_CATEGORY,
    tomlKey: ATPROTO_AUTH_SETTING_NAME,
    fromToml: atprotoOAuthIdentityFromToml,
    toToml: atprotoOAuthIdentityToToml,
  },
}

function AtprotoOAuthSetting({
  value,
  registry,
}: SettingComponentProps<AtprotoOAuthIdentity | null>) {
  useSignals()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const connectedIdentities = registry.optional(connectedIdentitiesService)
  const identity = isAtprotoOAuthIdentity(value) ? value : null
  const [signInInput, setSignInInput] = useState(identity?.handle ?? '')
  const identityId = identity
    ? `${ATPROTO_IDENTITY_PROVIDER_ID}:${identity.did}`
    : undefined

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">
          {identity?.handle ?? identity?.did ?? 'Not connected'}
        </span>
        {identityId ? (
          <button
            type="button"
            className="rounded-sm border border-chalkboard-30 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || !connectedIdentities}
            onClick={() => {
              if (!connectedIdentities) {
                return
              }
              void run(() => connectedIdentities.disconnect(identityId))
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="rounded-sm border border-chalkboard-30 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || !connectedIdentities}
            onClick={() => {
              if (!connectedIdentities) {
                return
              }
              void run(() =>
                connectedIdentities.connect(ATPROTO_IDENTITY_PROVIDER_ID, {
                  input: signInInput.trim() || undefined,
                })
              )
            }}
          >
            Connect
          </button>
        )}
      </div>
      {!identity ? (
        <input
          type="text"
          className="w-full rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-sm"
          placeholder="handle, DID, or PDS URL"
          value={signInInput}
          disabled={busy}
          onChange={(event) => setSignInInput(event.target.value)}
        />
      ) : null}
      {error ? (
        <p className="text-xs text-destroy-70 dark:text-destroy-20">{error}</p>
      ) : null}
    </div>
  )
}

export function createAtprotoOAuthRegistryItem({
  connector = createUnavailableOAuthConnector(),
}: {
  connector?: AtprotoOAuthConnector
} = {}) {
  return defineRegistryItemFactory((ctx) => {
    let disposed = false
    const settings = ctx.services.signal(settingsService)
    const identity = computed<AtprotoOAuthIdentity | null>(() => {
      const settingsRecord = settings.value?.get() as
        | Record<string, Record<string, { current?: unknown }> | undefined>
        | undefined
      const settingValue =
        settingsRecord?.[ATPROTO_AUTH_SETTING_CATEGORY]?.[
          ATPROTO_AUTH_SETTING_NAME
        ]?.current

      return isAtprotoOAuthIdentity(settingValue) ? settingValue : null
    })
    const identities = computed<readonly ConnectedIdentity[]>(() =>
      identity.value
        ? [atprotoConnectedIdentityFromOAuthIdentity(identity.value)]
        : []
    )

    const updateIdentity = (value: AtprotoOAuthIdentity | null) => {
      if (disposed) {
        return
      }

      const settingsServiceImpl = ctx.services.get(settingsService)
      settingsServiceImpl.send({
        type: `set.${ATPROTO_AUTH_SETTING_CATEGORY}.${ATPROTO_AUTH_SETTING_NAME}`,
        data: {
          level: 'user',
          value,
        },
      } as never)
    }

    queueMicrotask(() => {
      if (disposed || !connector.initialize) {
        return
      }

      void connector.initialize().then((initializedIdentity) => {
        if (initializedIdentity !== undefined) {
          updateIdentity(
            initializedIdentity
              ? normalizeAtprotoOAuthIdentity(initializedIdentity)
              : null
          )
        }
      }, reportRejection)
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'atproto-oauth-provider',
        provides: [
          provide(settingsValueSpec, {
            [ATPROTO_AUTH_SETTING_CATEGORY]: {
              [ATPROTO_AUTH_SETTING_NAME]: atprotoOAuthSetting,
            },
          }),
          provide(
            connectedIdentityProvidersValueSpec,
            {
              id: ATPROTO_IDENTITY_PROVIDER_ID,
              title: 'ATProto',
              identities,
              connect: async (options) => {
                const connectOptions = isRecord(options) ? options : {}
                const input = optionalString(connectOptions.input)
                const nextIdentity = await connector.connect({
                  scopes: ATPROTO_OAUTH_SCOPES,
                  input,
                })
                updateIdentity(normalizeAtprotoOAuthIdentity(nextIdentity))
              },
              disconnect: async () => {
                const currentIdentity = identity.value
                if (currentIdentity) {
                  await connector.disconnect?.(currentIdentity)
                }
                updateIdentity(null)
              },
              refresh: async () => {
                const currentIdentity = identity.value
                if (!currentIdentity) {
                  return
                }

                const refreshed = await connector.refresh?.(currentIdentity)
                if (refreshed !== undefined) {
                  updateIdentity(
                    refreshed ? normalizeAtprotoOAuthIdentity(refreshed) : null
                  )
                }
              },
            },
            {
              key: 'atproto-oauth-provider:connected-identity-provider',
            }
          ),
        ],
        dispose: () => {
          disposed = true
        },
      }),
    }
  }, 'atproto-oauth-provider')
}

export const atprotoOAuthRegistryItem = createAtprotoOAuthRegistryItem()

export default defineRegistryItem({
  id: 'atproto-oauth',
  uses: [atprotoOAuthRegistryItem],
})
