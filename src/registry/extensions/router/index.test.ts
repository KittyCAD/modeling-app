import { Registry } from '@kittycad/registry'
import { routerService } from '@src/registry/contracts/router'
import routerRegistryItem, { createRouterRegistryService } from '.'
import type { Location, NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testLocation = (pathname: string): Location => ({
  pathname,
  search: '',
  hash: '',
  state: null,
  key: pathname,
})

describe('router extension', () => {
  let registry: Registry | undefined

  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    window.history.replaceState(null, '', '/')
  })

  it('provides non-nullable browser-backed fallback values', () => {
    window.history.replaceState(
      { usr: { from: 'browser' }, key: 'browser-key' },
      '',
      '/browser?tab=unit#anchor'
    )

    registry = new Registry()
    registry.configure([routerRegistryItem])

    const router = registry.get(routerService)
    const location = testLocation('/settings')
    const navigate = vi.fn()

    expect(router.location.value).toMatchObject({
      pathname: '/browser',
      search: '?tab=unit',
      hash: '#anchor',
      state: { from: 'browser' },
      key: 'browser-key',
    })
    expect(router.getLocation()).toBe(router.location.value)
    expect(router.isReady.value).toBe(false)

    void router.navigate('/home?from=fallback#top')

    expect(router.location.value).toMatchObject({
      pathname: '/home',
      search: '?from=fallback',
      hash: '#top',
      state: null,
    })

    const state = { source: 'fallback' }
    void router.navigate(
      { pathname: '/replace', search: '?x=1', hash: '#hash' },
      { replace: true, state }
    )

    expect(window.history.state).toEqual(state)
    expect(router.location.value).toMatchObject({
      pathname: '/replace',
      search: '?x=1',
      hash: '#hash',
      state,
    })

    const historyGo = vi
      .spyOn(window.history, 'go')
      .mockImplementation(() => undefined)

    void router.navigate(-1)

    expect(historyGo).toHaveBeenCalledWith(-1)
    historyGo.mockRestore()

    router.setLocation(location)
    const disposeNavigate = router.setNavigate(
      navigate as unknown as NavigateFunction
    )

    expect(router.location.value).toBe(location)
    expect(router.isReady.value).toBe(true)

    void router.navigate('/home')
    void router.navigate(-1)

    expect(navigate).toHaveBeenCalledWith('/home', undefined)
    expect(navigate).toHaveBeenCalledWith(-1)

    disposeNavigate()

    expect(router.isReady.value).toBe(false)
    void router.navigate('/fallback-again')
    expect(router.location.value.pathname).toBe('/fallback-again')
  })

  it('does not reset a newer navigate function from an older cleanup', () => {
    const router = createRouterRegistryService()
    const firstNavigate = vi.fn()
    const secondNavigate = vi.fn()

    const disposeFirstNavigate = router.setNavigate(
      firstNavigate as unknown as NavigateFunction
    )
    const disposeSecondNavigate = router.setNavigate(
      secondNavigate as unknown as NavigateFunction
    )

    disposeFirstNavigate()
    void router.navigate('/home')

    expect(firstNavigate).not.toHaveBeenCalled()
    expect(secondNavigate).toHaveBeenCalledWith('/home', undefined)
    expect(router.isReady.value).toBe(true)

    disposeSecondNavigate()

    expect(router.isReady.value).toBe(false)
    void router.navigate('/after-dispose')
    expect(router.location.value.pathname).toBe('/after-dispose')
  })
})
