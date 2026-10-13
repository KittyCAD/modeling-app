import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  defineUrlContribution,
  type UrlAdapter,
  type UrlBehavior,
  urlContributionsValueSpec,
  urlService,
} from '@src/registry/contracts/url'
import urlRegistryItem, {
  createBrowserUrlAdapter,
  createUrlRegistryService,
} from '.'
import { afterEach, describe, expect, it, vi } from 'vitest'

function fixture(search = '?tab=project') {
  const tab = signal('user')
  const parse = vi.fn((params: URLSearchParams) => {
    const value = params.get('tab')
    return value === null ? undefined : { tab: value }
  })
  const initialize = vi.fn<UrlBehavior<{ tab: string }>['initialize']>(
    (value) => {
      tab.value = value.tab
    }
  )
  const contribution = defineUrlContribution({
    id: 'settings-tab',
    queryKeys: ['tab'],
    parse,
    initialize,
    serialize: () => ({ tab: tab.value }),
  })
  const adapter = {
    captureSearch: vi.fn(() => search),
    publish: vi.fn<UrlAdapter['publish']>(),
  }
  const runtime = createUrlRegistryService(() => [contribution])
  return { ...runtime, contribution, adapter, parse, initialize, tab }
}

describe('url extension', () => {
  it('captures and initializes once, then publishes signal changes without parsing', async () => {
    const f = fixture()
    try {
      const started = f.service.start(f.adapter)
      expect(f.service.start(f.adapter)).toBe(started)
      await started

      expect(f.tab.value).toBe('project')
      expect(f.adapter.publish).toHaveBeenLastCalledWith({ tab: 'project' })

      f.adapter.captureSearch.mockReturnValue('?tab=external')
      f.tab.value = 'keybindings'

      expect(f.adapter.publish).toHaveBeenLastCalledWith({
        tab: 'keybindings',
      })
      expect(f.adapter.captureSearch).toHaveBeenCalledTimes(1)
      expect(f.parse).toHaveBeenCalledTimes(1)
      expect(f.initialize).toHaveBeenCalledTimes(1)
    } finally {
      f.dispose()
    }
  })

  it('retains parsed data while initialization waits and suppresses early publication', async () => {
    const ready = Promise.withResolvers<undefined>()
    const f = fixture()
    f.initialize.mockImplementation(async (value) => {
      await ready.promise
      f.tab.value = value.tab
    })
    try {
      const started = f.service.start(f.adapter)
      f.adapter.captureSearch.mockReturnValue('?tab=external')
      f.tab.value = 'transient'
      expect(f.adapter.publish).not.toHaveBeenCalled()

      ready.resolve(undefined)
      await started

      expect(f.tab.value).toBe('project')
      expect(f.adapter.captureSearch).toHaveBeenCalledTimes(1)
      expect(f.adapter.publish).toHaveBeenCalledTimes(1)
      expect(f.adapter.publish).toHaveBeenCalledWith({ tab: 'project' })
    } finally {
      f.dispose()
    }
  })

  it('accepts incoming-only contributions without publishing', async () => {
    const initialize = vi.fn()
    const contribution = defineUrlContribution({
      id: 'prompt',
      queryKeys: ['prompt'],
      parse: (params) => ({ text: params.get('prompt') ?? '' }),
      initialize,
    })
    const f = fixture('?prompt=make+a+gear')
    const runtime = createUrlRegistryService(() => [contribution])
    try {
      await runtime.service.start(f.adapter)
      expect(initialize).toHaveBeenCalledWith(
        { text: 'make a gear' },
        expect.any(AbortSignal)
      )
      expect(f.adapter.publish).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
      f.dispose()
    }
  })

  it('publishes defaults without initializing an absent property', async () => {
    const f = fixture('')
    try {
      await f.service.start(f.adapter)
      expect(f.initialize).not.toHaveBeenCalled()
      expect(f.adapter.publish).toHaveBeenCalledWith({ tab: 'user' })
    } finally {
      f.dispose()
    }
  })

  it('cancels pending initialization and prevents publication after disposal', async () => {
    const ready = Promise.withResolvers<undefined>()
    const state = signal('original')
    let initializationSignal: AbortSignal | undefined
    const contribution = defineUrlContribution({
      id: 'tab',
      queryKeys: ['tab'],
      parse: (params) => ({ tab: params.get('tab') ?? '' }),
      initialize: async (value, signal) => {
        initializationSignal = signal
        await ready.promise
        if (!signal.aborted) state.value = value.tab
      },
      serialize: () => ({ tab: state.value }),
    })
    const f = fixture()
    const runtime = createUrlRegistryService(() => [contribution])
    const started = runtime.service.start(f.adapter)
    runtime.dispose()
    ready.resolve(undefined)
    await started

    expect(initializationSignal?.aborted).toBe(true)
    expect(state.value).toBe('original')
    expect(f.adapter.publish).not.toHaveBeenCalled()
    f.dispose()
  })

  it('stops watching application signals when disposed', async () => {
    const f = fixture()
    await f.service.start(f.adapter)
    f.dispose()
    f.tab.value = 'plugins'
    expect(f.adapter.publish).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate ownership before initializing application state', async () => {
    const f = fixture()
    const runtime = createUrlRegistryService(() => [
      f.contribution,
      { ...f.contribution, id: 'other-tab' },
    ])
    await expect(runtime.service.start(f.adapter)).rejects.toThrow(
      'Duplicate URL query key: tab'
    )
    expect(f.adapter.captureSearch).not.toHaveBeenCalled()
    expect(f.initialize).not.toHaveBeenCalled()
    f.dispose()
    runtime.dispose()
  })

  it('parses all contributions before initializing, so malformed input changes no state', async () => {
    const f = fixture()
    const failure = new Error('Invalid settings tab')
    const contribution = defineUrlContribution({
      id: 'invalid',
      queryKeys: ['invalid'],
      parse: () => failure,
      initialize: f.initialize,
    })
    const runtime = createUrlRegistryService(() => [
      f.contribution,
      contribution,
    ])
    await expect(runtime.service.start(f.adapter)).rejects.toBe(failure)
    expect(f.initialize).not.toHaveBeenCalled()
    expect(f.adapter.publish).not.toHaveBeenCalled()
    runtime.dispose()
    f.dispose()
  })

  it('collects registry contributions lazily and isolates their parser inputs', async () => {
    const f = fixture('?tab=project&keep=yes')
    const parse = vi.fn((params: URLSearchParams) => {
      params.delete('tab')
      return { keep: params.get('keep') ?? '' }
    })
    const contribution = defineUrlContribution({
      id: 'keep',
      queryKeys: ['keep'],
      parse,
      initialize: vi.fn(),
      // Only declared keys can be published, even if a serializer returns more.
      serialize: () => ({ keep: 'retained', unowned: 'ignored' }),
    })
    const registry = new Registry()
    registry.configure([
      urlRegistryItem,
      defineRegistryItem({
        provides: [
          provide(urlContributionsValueSpec, contribution),
          provide(urlContributionsValueSpec, f.contribution),
        ],
      }),
    ])
    try {
      expect(parse).not.toHaveBeenCalled()
      await registry.get(urlService).start(f.adapter)
      expect(f.tab.value).toBe('project')
      expect(f.adapter.publish).toHaveBeenCalledWith({
        tab: 'project',
        keep: 'retained',
      })
      registry[Symbol.dispose]()
      f.tab.value = 'plugins'
      expect(f.adapter.publish).toHaveBeenCalledTimes(1)
    } finally {
      registry[Symbol.dispose]()
      f.dispose()
    }
  })
})

describe('browser URL adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('preserves the current path, unrelated fields, and history state without navigating', () => {
    const adapter = createBrowserUrlAdapter(window, false)
    window.history.replaceState({ key: 'router-key' }, '', '/home?tab=user')
    expect(adapter.captureSearch()).toBe('?tab=user')
    window.history.replaceState(
      { key: 'new-router-key' },
      '',
      '/file/new?tab=user&keep=yes#anchor'
    )
    const replace = vi.spyOn(window.history, 'replaceState')
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const previousLength = window.history.length
    adapter.publish({ tab: 'project' })
    adapter.publish({ tab: 'project' })

    expect(window.location.pathname).toBe('/file/new')
    expect(window.location.search).toBe('?tab=project&keep=yes')
    expect(window.location.hash).toBe('#anchor')
    expect(window.history.state).toEqual({ key: 'new-router-key' })
    expect(window.history.length).toBe(previousLength)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('captures and publishes desktop hash-route query fields', () => {
    window.history.replaceState(
      null,
      '',
      '/index.html?outer=yes#/file/model?tab=user&keep=yes#anchor'
    )
    const adapter = createBrowserUrlAdapter(window, true)
    expect(adapter.captureSearch()).toBe('?tab=user&keep=yes')
    adapter.publish({ tab: 'project', keep: undefined })
    expect(window.location.search).toBe('?outer=yes')
    expect(window.location.hash).toBe('#/file/model?tab=project#anchor')
  })
})
