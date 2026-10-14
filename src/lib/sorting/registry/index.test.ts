import { Registry } from '@kittycad/registry'
import { projectSortingService } from '@src/lib/sorting/registry/contract'
import { urlService } from '@src/registry/contracts/url'
import projectSorting from '@src/lib/sorting/registry'
import url, { createBrowserUrlAdapter } from '@src/registry/extensions/url'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('project sorting URL contribution', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  async function start(path: string, hashRouter = false) {
    // Opaque history state must survive URL publication; sorting does not own it.
    window.history.replaceState({ source: 'before-sort' }, '', path)
    registry = new Registry()
    registry.configure([url, projectSorting])
    const adapter = createBrowserUrlAdapter(window, hashRouter)
    const capture = vi.spyOn(adapter, 'captureSearch')
    await registry.get(urlService).start(adapter)
    return { sorting: registry.get(projectSortingService), capture }
  }

  it('leaves an absent preference absent and uses the existing default', async () => {
    const { sorting } = await start('/home?keep=yes')
    expect(sorting.sort.value).toBe('modified:desc')
    expect(window.location.search).toBe('?keep=yes')
  })

  it.each(['name', 'name:desc', 'modified', 'modified:desc'] as const)(
    'restores the supported preference %j at startup',
    async (sort) => {
      const { sorting } = await start(`/home?sort_by=${sort}&keep=yes`)
      expect(sorting.sort.value).toBe(sort)
      expect(new URL(window.location.href).searchParams.get('sort_by')).toBe(
        sort
      )
    }
  )

  it('removes an incoming empty reset parameter while preserving unrelated fields', async () => {
    const { sorting } = await start('/home?sort_by=&keep=yes')
    expect(sorting.sort.value).toBe('')
    expect(window.location.search).toBe('?keep=yes')
  })

  it.each([
    ['/home', false, '/home', ''],
    ['/index.html#/home', true, '/index.html', '#/home'],
  ] as const)(
    'returns %s to a URL without a query string when sorting resets',
    async (path, hashRouter, pathname, hash) => {
      const { sorting } = await start(path, hashRouter)
      sorting.toggle('name')
      sorting.toggle('name')
      expect(sorting.sort.value).toBe('')
      expect(window.location.pathname).toBe(pathname)
      expect(window.location.search).toBe('')
      expect(window.location.hash).toBe(hash)
    }
  )

  it('uses and publishes the default for unsupported incoming sort values', async () => {
    const { sorting } = await start('/home?sort_by=unsupported&keep=yes')
    expect(sorting.sort.value).toBe('modified:desc')
    expect(window.location.search).toBe('?sort_by=modified%3Adesc&keep=yes')
  })

  it('publishes state changes without navigation, unrelated-query loss, or reparsing', async () => {
    const { sorting, capture } = await start('/home?keep=yes#anchor')
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const initialHistoryLength = window.history.length

    sorting.toggle('name')
    expect(sorting.sort.value).toBe('name')
    expect(window.location.search).toBe('?keep=yes&sort_by=name')
    expect(window.location.hash).toBe('#anchor')
    expect(window.history.state).toEqual({ source: 'before-sort' })

    sorting.toggle('name')
    expect(sorting.sort.value).toBe('')
    expect(window.location.search).toBe('?keep=yes')

    // A later URL change is transport state, not new application input.
    window.history.replaceState(null, '', '/home?sort_by=modified')
    expect(sorting.sort.value).toBe('')
    sorting.toggle('name')
    expect(sorting.sort.value).toBe('name:desc')
    expect(window.location.search).toBe('?sort_by=name%3Adesc')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(window.history.length).toBe(initialHistoryLength)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('initializes and publishes the preference inside desktop hash routing', async () => {
    const { sorting } = await start(
      '/index.html?outer=yes#/home?sort_by=modified&keep=yes',
      true
    )
    expect(sorting.sort.value).toBe('modified')
    sorting.toggle('name')
    expect(sorting.sort.value).toBe('name:desc')
    expect(window.location.search).toBe('?outer=yes')
    expect(window.location.hash).toBe('#/home?sort_by=name%3Adesc&keep=yes')
  })
})
