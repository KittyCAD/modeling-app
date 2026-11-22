import type { UserResponse } from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import {
  getRequiredRegistryItemIds,
  bundledRegistryItemMetadata,
  isBundledRegistryItemId,
} from '@src/registry/catalogMetadata'
import { parseAppManifest, resolveAppManifest } from '@src/registry/appManifest'
import { isErr } from '@src/lib/trap'

export const DEV_ACCOUNT_CONFIG_PREFIX = 'zds-dev-app-config:'

/** Temporary dev-account pointer; ordinary company names never select executable configuration. */
export function readDevAccountConfigProject(
  user: Pick<UserResponse, 'company'>
): string | undefined | Error {
  const value = user.company?.trim()
  if (!value?.startsWith(DEV_ACCOUNT_CONFIG_PREFIX)) return undefined
  const id = value.slice(DEV_ACCOUNT_CONFIG_PREFIX.length)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return new Error(
      'Dev app configuration company field must be zds-dev-app-config:<project UUID>.'
    )
  return id
}

export interface DevAccountConfigRequest {
  accountId: string
  projectId: string
  token: string
  baseUrl: string
}

export interface LoadedAccountConfig {
  contents: string
  revision: string
}

/** A dev configuration only changes renderer selection; native handlers remain process-owned. */
export function resolveDevAccountConfig(
  contents: string,
  baseline: readonly BundledRegistryItemId[]
): readonly BundledRegistryItemId[] | Error {
  if (contents.length > 128_000)
    return new Error('App manifest exceeds 128 KB.')
  const manifest = parseAppManifest(contents)
  if (isErr(manifest)) return manifest
  const resolved = resolveAppManifest(manifest, {
    availableIds: Object.keys(bundledRegistryItemMetadata),
    defaultIds: baseline,
    requiredIds: getRequiredRegistryItemIds(
      import.meta.env.VITE_INTERACTION_PERFORMANCE === '1'
    ),
  })
  if (isErr(resolved)) return resolved
  if (
    resolved.extensionIds.includes('zoo:slicer') !==
    baseline.includes('zoo:slicer')
  )
    return new Error(
      'Changing native slicer registration requires a startup app manifest.'
    )
  return resolved.extensionIds.filter(isBundledRegistryItemId)
}

/** Async reads belong to one account, API environment, and pointer generation; late results never apply. */
export function createDevAccountConfigController({
  baseline,
  load,
  apply,
  reportError,
}: {
  baseline: readonly BundledRegistryItemId[]
  load: (
    request: DevAccountConfigRequest,
    signal: AbortSignal
  ) => Promise<LoadedAccountConfig>
  apply: (
    ids: readonly BundledRegistryItemId[],
    assertCurrent: () => void
  ) => Promise<void>
  reportError: (error: Error) => void
}) {
  const status = signal('Using startup app composition')
  let generation = 0
  let context = ''
  let lastRequest = ''
  let controller: AbortController | undefined
  let changedComposition = false
  let disposed = false
  const work = new Set<Promise<void>>()
  return {
    status,
    update(
      request: DevAccountConfigRequest | undefined,
      preferenceError?: Error
    ) {
      if (disposed) return
      const nextContext = request
        ? JSON.stringify([
            request.accountId,
            request.baseUrl,
            request.projectId,
          ])
        : ''
      const key = JSON.stringify([
        nextContext,
        request?.token,
        preferenceError?.message,
      ])
      if (lastRequest === key) return
      lastRequest = key
      const restore = changedComposition && context !== nextContext
      context = nextContext
      const current = ++generation
      controller?.abort()
      controller = new AbortController()
      const { signal } = controller
      const assertCurrent = () => {
        signal.throwIfAborted()
      }
      const run = async () => {
        if (restore) {
          await apply(baseline, assertCurrent)
          assertCurrent()
          changedComposition = false
        }
        if (preferenceError) return Promise.reject(preferenceError)
        if (!request) {
          status.value = 'Using startup app composition'
          return
        }
        status.value = `Loading app configuration from Project ${request.projectId}`
        const loaded = await load(request, signal)
        assertCurrent()
        const ids = resolveDevAccountConfig(loaded.contents, baseline)
        if (isErr(ids)) return Promise.reject(ids)
        // An auth change during registry cleanup must still schedule restoration.
        changedComposition = true
        await apply(ids, assertCurrent)
        assertCurrent()
        status.value = `Applied app configuration from Project ${request.projectId} at version ${loaded.revision}`
      }
      const pending = run().catch((cause) => {
        if (signal.aborted || disposed || generation !== current) return
        const error = isErr(cause) ? cause : new Error(String(cause))
        status.value = `App configuration failed: ${error.message}`
        reportError(error)
      })
      work.add(pending)
      void pending.finally(() => work.delete(pending))
    },
    async settled() {
      while (work.size) await Promise.all([...work])
    },
    dispose() {
      disposed = true
      generation++
      controller?.abort()
    },
  }
}
