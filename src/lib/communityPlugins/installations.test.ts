import {
  createPluginInstallations,
  type PluginInstallations,
} from '@src/lib/communityPlugins/installations'
import {
  compiledHello,
  helloPlugin,
  pluginStorageFixture,
} from '@src/lib/communityPlugins/testSupport'
import { requireSuccess } from '@src/lib/editors/testViews'
import type { PluginRuntime } from '@src/lib/communityPlugins/runtime'
import { createFilePluginStorage } from '@src/lib/communityPlugins/persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('retained plugin installations', () => {
  const managers: PluginInstallations[] = []
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  })
  const harness = (fixture = pluginStorageFixture()) => {
    const runtimes = new Map<string, PluginRuntime>()
    const sources = new Map<string, string>()
    const messages: string[] = []
    const manager = createPluginInstallations({
      storage: async () => fixture.storage,
      readSource: async (path) => {
        const text = sources.get(path)
        if (text === undefined) throw new Error('Source file is missing')
        return text
      },
      publish: async (id, runtime) => {
        if (runtime) runtimes.set(id, runtime)
        else runtimes.delete(id)
        return undefined
      },
      notify: (message) => messages.push(message),
    })
    managers.push(manager)
    return { manager, runtimes, sources, messages, fixture }
  }
  const install = async (
    h: ReturnType<typeof harness>,
    mode: 'snapshot' | 'development' = 'snapshot',
    permissions = ['ui.notify']
  ) => {
    requireSuccess(await h.manager.restore())
    const source = requireSuccess(await compiledHello('Hello!', permissions))
    requireSuccess(
      await h.manager.install(
        source,
        mode,
        '/plugins/hello.zds.ts',
        new Set(permissions)
      )
    )
    return h.manager.entries.value[0].installation.id
  }

  it('restores the pinned source and grant with a stable identity after restarting', async () => {
    const first = harness()
    const id = await install(first)
    await first.manager.dispose()
    const second = harness(first.fixture)
    second.sources.set('/plugins/hello.zds.ts', helloPlugin('Replaced source'))
    requireSuccess(await second.manager.restore())
    expect(second.manager.entries.value[0].installation.id).toBe(id)
    expect(second.runtimes.get(id)!.invoke(0)).toBeUndefined()
    expect(second.messages).toEqual(['Hello!'])
    const previous = second.runtimes.get(id)!
    requireSuccess(await second.manager.setEnabled(id, false))
    expect(previous.invoke(0)).toBeInstanceOf(Error)
    const third = harness(first.fixture)
    requireSuccess(await third.manager.restore())
    expect(third.runtimes.size).toBe(0)
    requireSuccess(await third.manager.setEnabled(id, true))
    expect(third.runtimes.get(id)!.invoke(0)).toBeUndefined()
    expect(third.messages).toEqual(['Hello!'])
  })

  it('retains missing development sources and recovers explicitly when they return', async () => {
    const first = harness()
    const id = await install(first, 'development')
    await first.manager.dispose()
    const second = harness(first.fixture)
    requireSuccess(await second.manager.restore())
    expect(second.manager.entries.value).toHaveLength(1)
    expect(second.manager.entries.value[0].status.value).toContain(
      'Source unavailable'
    )
    expect(second.runtimes.size).toBe(0)
    second.sources.set('/plugins/hello.zds.ts', helloPlugin('Recovered'))
    requireSuccess(await second.manager.retry(id))
    second.runtimes.get(id)!.invoke(0)
    expect(second.messages).toEqual(['Recovered'])
  })

  it('waits for approval when development source gains a permission', async () => {
    const first = harness()
    const id = await install(first, 'development', [])
    await first.manager.dispose()
    const second = harness(first.fixture)
    second.sources.set('/plugins/hello.zds.ts', helloPlugin('New permission'))
    requireSuccess(await second.manager.restore())
    const entry = second.manager.entries.value[0]
    expect(second.runtimes.size).toBe(0)
    expect(entry.status.value).toContain('approval required')
    requireSuccess(await second.manager.approve(id, entry.review.value!))
    second.runtimes.get(id)!.invoke(0)
    expect(second.messages).toEqual(['New permission'])
  })

  it('revokes grants immediately and does not restore them on restart', async () => {
    const first = harness()
    const id = await install(first)
    const previous = first.runtimes.get(id)!
    const revoking = first.manager.revokePermissions(id)
    expect(previous.invoke(0)).toBeInstanceOf(Error)
    requireSuccess(await revoking)
    const second = harness(first.fixture)
    requireSuccess(await second.manager.restore())
    expect(second.runtimes.size).toBe(0)
    expect(second.manager.entries.value[0].granted.value).toEqual([])
  })

  it('removes grants on uninstall and never inherits them for the same declared plugin ID', async () => {
    const h = harness()
    const id = await install(h)
    requireSuccess(await h.manager.uninstall(id))
    const saved = requireSuccess(await h.fixture.storage.load()).preferences
    expect(saved.installations).toEqual([])
    expect(saved.grants).toEqual([])
    const source = requireSuccess(await compiledHello())
    expect(
      await h.manager.install(source, 'snapshot', undefined, new Set())
    ).toBeInstanceOf(Error)
    requireSuccess(
      await h.manager.install(
        source,
        'snapshot',
        undefined,
        new Set(['ui.notify'])
      )
    )
    expect(h.manager.entries.value[0].installation.id).not.toBe(id)
  })

  it('never activates an installation whose persistence failed', async () => {
    const h = harness()
    requireSuccess(await h.manager.restore())
    h.fixture.failWrites(new Error('Disk full'))
    expect(
      await h.manager.install(
        requireSuccess(await compiledHello()),
        'snapshot',
        undefined,
        new Set(['ui.notify'])
      )
    ).toBeInstanceOf(Error)
    expect(h.runtimes.size).toBe(0)
    expect(h.manager.entries.value).toEqual([])
  })

  it('follows open development buffers, preserves the last good instance, and leaves snapshots unchanged', async () => {
    const h = harness()
    const development = await install(h, 'development')
    requireSuccess(
      await h.manager.install(
        requireSuccess(await compiledHello('Snapshot')),
        'snapshot',
        undefined,
        new Set(['ui.notify'])
      )
    )
    const snapshot = h.manager.entries.value[1].installation.id
    const owner = Symbol('source editor')
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compiledHello('Buffer edit')),
      owner
    )
    await h.manager.settled()
    h.runtimes.get(development)!.invoke(0)
    h.runtimes.get(snapshot)!.invoke(0)
    expect(h.messages).toEqual(['Buffer edit', 'Snapshot'])
    const previous = h.runtimes.get(development)!
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      new Error('Broken buffer'),
      owner
    )
    await h.manager.settled()
    expect(h.runtimes.get(development)).toBe(previous)
    expect(h.manager.entries.value[0].status.value).toBe('Broken buffer')
    requireSuccess(await h.manager.setEnabled(development, false))
    requireSuccess(await h.manager.setEnabled(development, true))
    expect(h.runtimes.has(development)).toBe(false)
    expect(h.manager.entries.value[0].status.value).toBe('Broken buffer')
  })

  it('does not transfer grants when a development path declares a different plugin ID', async () => {
    const h = harness()
    const id = await install(h, 'development')
    await h.manager.dispose()
    const next = harness(h.fixture)
    next.sources.set(
      '/plugins/hello.zds.ts',
      helloPlugin('Replacement', ['ui.notify'], 'different')
    )
    requireSuccess(await next.manager.restore())
    expect(next.runtimes.has(id)).toBe(false)
    expect(next.manager.entries.value[0].status.value).toContain(
      'different plugin'
    )
  })

  it.each(['snapshot', 'development'] as const)(
    'uses the intended source when a %s installation finishes saving after a buffer edit',
    async (mode) => {
      const h = harness()
      requireSuccess(await h.manager.restore())
      const saving = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      h.fixture.beforeWrite(async () => {
        entered.resolve(undefined)
        await saving.promise
      })
      const installing = h.manager.install(
        requireSuccess(await compiledHello('Clicked source')),
        mode,
        '/plugins/hello.zds.ts',
        new Set(['ui.notify'])
      )
      try {
        await entered.promise
        h.manager.updateDevelopment(
          '/plugins/hello.zds.ts',
          requireSuccess(await compiledHello('Latest buffer')),
          Symbol('editor')
        )
      } finally {
        saving.resolve(undefined)
      }
      requireSuccess(await installing)
      h.runtimes.values().next().value!.invoke(0)
      expect(h.messages).toEqual([
        mode === 'snapshot' ? 'Clicked source' : 'Latest buffer',
      ])
    }
  )

  it('does not restart an obsolete review if its buffer changes while approval is saved', async () => {
    const h = harness()
    const id = await install(h, 'development', [])
    const owner = Symbol('editor')
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compiledHello('Reviewed')),
      owner
    )
    await h.manager.settled()
    const entry = h.manager.entries.value[0]
    const previous = h.runtimes.get(id)
    const reviewed = entry.review.value!
    const saving = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    h.fixture.beforeWrite(async () => {
      entered.resolve(undefined)
      await saving.promise
    })
    const approval = h.manager.approve(id, reviewed)
    await entered.promise
    h.manager.updateDevelopment(
      '/plugins/hello.zds.ts',
      requireSuccess(await compiledHello('Newer buffer')),
      owner
    )
    await vi.waitFor(() => expect(entry.review.value).not.toBe(reviewed))
    saving.resolve(undefined)
    expect(await approval).toBeInstanceOf(Error)
    expect(h.runtimes.get(id)).toBe(previous)
    h.fixture.beforeWrite(undefined)
    requireSuccess(await h.manager.retry(id))
    h.runtimes.get(id)!.invoke(0)
    expect(h.messages).toEqual(['Newer buffer'])
  })

  it('revokes another window before it restores changed grants', async () => {
    const first = harness()
    const id = await install(first)
    const otherStorage = createFilePluginStorage(
      first.fixture.operations,
      '/user/community-plugins.toml'
    )
    const second = harness({ ...first.fixture, storage: otherStorage })
    requireSuccess(await second.manager.restore())
    const previous = second.runtimes.get(id)!
    requireSuccess(await first.manager.revokePermissions(id))
    await vi.waitFor(() => expect(previous.invoke(0)).toBeInstanceOf(Error))
    await second.manager.settled()
    expect(second.runtimes.has(id)).toBe(false)
    expect(second.manager.entries.value[0].granted.value).toEqual([])
  })

  it('does not activate a source read that finishes after disable', async () => {
    const h = harness()
    const id = await install(h, 'development')
    await h.manager.dispose()
    const read = Promise.withResolvers<string>()
    const publish = vi.fn(
      async (_id: string, _runtime: PluginRuntime | undefined) => undefined
    )
    const manager = createPluginInstallations({
      storage: async () => h.fixture.storage,
      readSource: () => read.promise,
      publish,
      notify: () => {},
    })
    managers.push(manager)
    const restoring = manager.restore()
    await vi.waitFor(() => expect(manager.entries.value).toHaveLength(1))
    const disabling = manager.setEnabled(id, false)
    read.resolve(helloPlugin('Late'))
    await Promise.all([restoring, disabling])
    expect(publish.mock.calls.every((call) => call[1] === undefined)).toBe(true)
  })
})
