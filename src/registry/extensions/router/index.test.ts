import { Registry } from '@kittycad/registry'
import { appUrlService } from '@src/registry/contracts/appUrl'
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import routerRegistryItem, { createAppUrlService } from '.'

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

    const appUrl = registry.get(appUrlService)
    const location = testLocation('/settings')
    const navigate = vi.fn()

    expect(appUrl.location.value).toMatchObject({
      pathname: '/browser',
      search: '?tab=unit',
      hash: '#anchor',
      state: { from: 'browser' },
      key: 'browser-key',
    })
    expect(appUrl.getLocation()).toBe(appUrl.location.value)
    expect(appUrl.isReady.value).toBe(false)

    void appUrl.navigate('/home?from=fallback#top')

    expect(appUrl.location.value).toMatchObject({
      pathname: '/home',
      search: '?from=fallback',
      hash: '#top',
      state: null,
    })

    const state = { source: 'fallback' }
    void appUrl.navigate(
      { pathname: '/replace', search: '?x=1', hash: '#hash' },
      { replace: true, state }
    )

    expect(window.history.state).toEqual(state)
    expect(appUrl.location.value).toMatchObject({
      pathname: '/replace',
      search: '?x=1',
      hash: '#hash',
      state,
    })

    const historyGo = vi
      .spyOn(window.history, 'go')
      .mockImplementation(() => undefined)

    void appUrl.navigate(-1)

    expect(historyGo).toHaveBeenCalledWith(-1)
    historyGo.mockRestore()

    appUrl.setLocation(location)
    const disposeNavigate = appUrl.setNavigate(navigate)

    expect(appUrl.location.value).toBe(location)
    expect(appUrl.isReady.value).toBe(true)

    void appUrl.navigate('/home')
    void appUrl.navigate(-1)

    expect(navigate).toHaveBeenCalledWith('/home', undefined)
    expect(navigate).toHaveBeenCalledWith(-1)

    disposeNavigate()

    expect(appUrl.isReady.value).toBe(false)
    void appUrl.navigate('/fallback-again')
    expect(appUrl.location.value.pathname).toBe('/fallback-again')
  })

  it('does not reset a newer navigate function from an older cleanup', () => {
    const appUrl = createAppUrlService()
    const firstNavigate = vi.fn()
    const secondNavigate = vi.fn()

    const disposeFirstNavigate = appUrl.setNavigate(firstNavigate)
    const disposeSecondNavigate = appUrl.setNavigate(secondNavigate)

    disposeFirstNavigate()
    void appUrl.navigate('/home')

    expect(firstNavigate).not.toHaveBeenCalled()
    expect(secondNavigate).toHaveBeenCalledWith('/home', undefined)
    expect(appUrl.isReady.value).toBe(true)

    disposeSecondNavigate()

    expect(appUrl.isReady.value).toBe(false)
    expect(
      appUrl.readInitialUrl({
        requestUrl: 'https://app.zoo.dev/home',
        usesHashRouter: false,
      })
    ).toMatchObject({
      type: 'launch',
      destination: { type: 'home' },
    })
    void appUrl.navigate('/after-dispose')
    expect(appUrl.location.value.pathname).toBe('/after-dispose')
  })
})
