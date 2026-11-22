import { afterEach, describe, expect, it, vi } from 'vitest'
import { contribute, Facet, factory, Registry } from 'plankton'
import {
  createDevAccountConfigController,
  readDevAccountConfigProject,
  resolveDevAccountConfig,
  type DevAccountConfigRequest,
  type LoadedAccountConfig,
  type PreparedAccountExtensions,
} from '@src/lib/appConfiguration/devAccount'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import { prepareAccountExtensions } from '@src/lib/appConfiguration/extensions'

const projectId = '019a1111-2222-7333-8444-555555555555'
const request: DevAccountConfigRequest = {
  accountId: 'dev-user',
  projectId,
  token: 'test-token',
  baseUrl: 'https://api.example.test',
}
const unbranded =
  'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:appLogo"]'
const normal = 'schema-version = 1\nbase = "zoo:default"'

describe('dev account configuration pointer', () => {
  it('reads the opt-in user field without interpreting ordinary company names or raw IDs', () => {
    expect(readDevAccountConfigProject({ company: 'Zoo' })).toBeUndefined()
    expect(readDevAccountConfigProject({})).toBeUndefined()
    expect(readDevAccountConfigProject({ company: projectId })).toBeUndefined()
    expect(
      readDevAccountConfigProject({
        company: `zds-dev-app-config:${projectId}`,
      })
    ).toBe(projectId)
    expect(
      readDevAccountConfigProject({
        company: 'zds-dev-app-config:not-a-project',
      })
    ).toBeInstanceOf(Error)
  })
  it('allows the optional logo to be omitted while preserving required and native entrypoints', () => {
    const ids = resolveDevAccountConfig(unbranded, defaultRegistryItemIds)
    if (ids instanceof Error) throw ids
    expect(ids.bundledIds).not.toContain('zoo:appLogo')
    expect(ids.bundledIds).toContain('zoo:auth')
    expect(ids.bundledIds).toContain('zoo:communityPlugins')
    expect(
      resolveDevAccountConfig(
        unbranded.replace('zoo:appLogo', 'zoo:auth'),
        defaultRegistryItemIds
      )
    ).toBeInstanceOf(Error)
    expect(
      resolveDevAccountConfig(
        unbranded.replace('zoo:appLogo', 'zoo:slicer'),
        defaultRegistryItemIds
      )
    ).toBeInstanceOf(Error)
  })
})

describe('authenticated configuration lifecycle', () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })
  const open = async (
    load: (
      input: DevAccountConfigRequest,
      signal: AbortSignal
    ) => Promise<LoadedAccountConfig>,
    prepare: (
      loaded: LoadedAccountConfig,
      ids: readonly string[],
      request: DevAccountConfigRequest,
      assertCurrent: () => void
    ) => Promise<PreparedAccountExtensions> = (
      loaded,
      ids,
      request,
      assertCurrent
    ) => prepareAccountExtensions(loaded, ids, request, [], assertCurrent)
  ) => {
    const registry = new Registry()
    const logos = new Facet<string, readonly string[]>(
      'logos',
      (inputs) => inputs
    )
    const acquireAuth = vi.fn(() => ({ exports: { account: 'stable' } }))
    const auth = factory({ create: acquireAuth })
    const branding = contribute(logos, () => 'Zoo')
    const apply = async (
      ids: readonly string[],
      assertCurrent: () => void,
      authored: PreparedAccountExtensions['extensions'] = []
    ) => {
      assertCurrent()
      await registry.configure([
        auth,
        ...(ids.includes('zoo:appLogo') ? [branding] : []),
        ...authored,
      ])
    }
    await apply(defaultRegistryItemIds, () => {})
    const errors: Error[] = []
    const controller = createDevAccountConfigController({
      baseline: defaultRegistryItemIds,
      load,
      apply,
      prepare,
      reportError: (error) => errors.push(error),
    })
    cleanups.push(async () => {
      controller.dispose()
      await controller.settled()
      await registry.dispose()
    })
    return { registry, logos, acquireAuth, controller, errors }
  }

  it('applies an authenticated manifest and restores startup branding on logout without recreating auth', async () => {
    const h = await open(async () => ({
      contents: unbranded,
      revision: 'version-1',
    }))
    h.controller.update(request)
    await h.controller.settled()
    expect(h.registry.get(h.logos)).toEqual([])
    expect(h.controller.status.value).toContain('version-1')
    h.controller.update(undefined)
    await h.controller.settled()
    expect(h.registry.get(h.logos)).toEqual(['Zoo'])
    expect(h.acquireAuth).toHaveBeenCalledTimes(1)
    expect(h.errors).toEqual([])
  })

  it('does not apply a completed download from a previous account', async () => {
    const old = Promise.withResolvers<LoadedAccountConfig>()
    let signal: AbortSignal | undefined
    const h = await open(async (input, abort) => {
      if (input.accountId === request.accountId) {
        signal = abort
        return old.promise
      }
      return { contents: normal, revision: 'new-account-version' }
    })
    h.controller.update(request)
    h.controller.update({ ...request, accountId: 'another-user' })
    old.resolve({ contents: unbranded, revision: 'old-account-version' })
    await h.controller.settled()
    expect(signal?.aborted).toBe(true)
    expect(h.registry.get(h.logos)).toEqual(['Zoo'])
    expect(h.controller.status.value).toContain('new-account-version')
    expect(h.errors).toEqual([])
  })

  it('keeps the last working selection when a refresh is invalid and deduplicates unchanged auth state', async () => {
    let contents = unbranded
    const load = vi.fn(async () => ({ contents, revision: 'version-1' }))
    const h = await open(load)
    h.controller.update(request)
    await h.controller.settled()
    h.controller.update({ ...request })
    await h.controller.settled()
    expect(load).toHaveBeenCalledTimes(1)
    contents = 'schema-version = 999'
    h.controller.update({ ...request, token: 'refreshed-token' })
    await h.controller.settled()
    expect(h.registry.get(h.logos)).toEqual([])
    expect(h.errors).toHaveLength(1)
    expect(h.controller.status.value).toContain('failed')
  })

  it('restores the startup selection when a pointer is removed or malformed', async () => {
    const h = await open(async () => ({
      contents: unbranded,
      revision: 'version-1',
    }))
    h.controller.update(request)
    await h.controller.settled()
    h.controller.update(undefined, new Error('Invalid configuration pointer'))
    await h.controller.settled()
    expect(h.registry.get(h.logos)).toEqual(['Zoo'])
    expect(h.errors[0].message).toBe('Invalid configuration pointer')
  })
  it('disposes prepared guests when logout supersedes preparation before publication', async () => {
    const pending = Promise.withResolvers<PreparedAccountExtensions>()
    const dispose = vi.fn()
    let preparing = false
    const h = await open(
      async () => ({ contents: normal, revision: 'version-1' }),
      async () => {
        preparing = true
        return pending.promise
      }
    )
    h.controller.update(request)
    await vi.waitFor(() => expect(preparing).toBe(true))
    h.controller.update(undefined)
    pending.resolve({ extensions: [], dispose })
    await h.controller.settled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(h.registry.get(h.logos)).toEqual(['Zoo'])
    expect(h.errors).toEqual([])
  })

  it('revokes a guest immediately when logout interrupts composition cleanup', async () => {
    const cleanup = Promise.withResolvers<undefined>()
    const enteredApply = Promise.withResolvers<undefined>()
    const dispose = vi.fn()
    const errors: Error[] = []
    let publishing = true
    const controller = createDevAccountConfigController({
      baseline: defaultRegistryItemIds,
      load: async () => ({ contents: normal, revision: 'version-1' }),
      prepare: async () => ({ extensions: [], dispose }),
      apply: async () => {
        if (!publishing) return
        publishing = false
        enteredApply.resolve(undefined)
        await cleanup.promise
      },
      reportError: (error) => errors.push(error),
    })
    cleanups.push(async () => {
      cleanup.resolve(undefined)
      controller.dispose()
      await controller.settled()
    })
    controller.update(request)
    await enteredApply.promise
    controller.update(undefined)
    expect(dispose).toHaveBeenCalled()
    cleanup.resolve(undefined)
    await controller.settled()
    expect(controller.status.value).toBe('Using startup app composition')
    expect(errors).toEqual([])
  })
})
