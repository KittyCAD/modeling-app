import type { App } from '@src/lib/app'
import { initializeApplication } from '@src/lib/initializeApplication'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initIndexRoute: vi.fn(),
  initHomeRoute: vi.fn(),
  initFileRoute: vi.fn(),
  readInitialUrl: vi.fn(),
  formatUrl: vi.fn(),
  navigate: vi.fn(),
  accept: vi.fn(),
}))

vi.mock('@src/lib/routeInit', () => ({
  initIndexRoute: mocks.initIndexRoute,
  initHomeRoute: mocks.initHomeRoute,
  initFileRoute: mocks.initFileRoute,
}))

function fakeApp(): App {
  return {
    registry: {
      get: () => ({
        readInitialUrl: mocks.readInitialUrl,
        formatUrl: mocks.formatUrl,
        navigate: mocks.navigate,
        accept: mocks.accept,
      }),
    },
  } as unknown as App
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('initializeApplication', () => {
  it('hands off the original link once without blocking React on command readiness', async () => {
    const pending = Promise.withResolvers<undefined>()
    mocks.accept.mockReturnValue(pending.promise)
    const search =
      '?cmd=set-layout&groupId=application&layoutId=zookeeper&ttc-prompt=make+a+gear&pool=alpha'
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'index' },
      search,
      hash: '',
    })
    await initializeApplication(fakeApp())
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({
      destination: { type: 'index' },
      urlState: { search, hash: '', overlay: undefined },
      request: {
        genericCommand: {
          name: 'set-layout',
          groupId: 'application',
          argDefaultValues: { layoutId: 'zookeeper' },
        },
        zookeeperPrompt: 'make a gear',
        askOpenDesktop: false,
      },
      remainingSearch: '?pool=alpha',
    })
    expect(mocks.initIndexRoute).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    pending.resolve(undefined)
  })

  it('dispatches the initial project intent without React Router', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket/main.kcl' },
      search: '?pool=alpha',
      hash: '#section',
    })
    mocks.initFileRoute.mockResolvedValue({ kind: 'ready', data: {} })

    const app = fakeApp()
    await initializeApplication(app, {
      requestUrl: 'https://app.zoo.dev/file/%2Fprojects%2Fbracket%2Fmain.kcl',
      usesHashRouter: false,
    })

    expect(mocks.initFileRoute).toHaveBeenCalledWith(app, {
      id: '/projects/bracket/main.kcl',
      startup: { search: '?pool=alpha', hash: '#section' },
    })
  })

  it('follows a typed project transition with structured startup URL state', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'index' },
      search: '?pool=alpha',
      hash: '',
    })
    mocks.initIndexRoute.mockResolvedValue({
      kind: 'transition',
      destination: {
        type: 'project',
        target: '/projects/demo/main.kcl',
      },
      urlState: { search: '?pool=alpha', hash: '' },
    })
    mocks.initFileRoute.mockResolvedValue({ kind: 'ready', data: {} })

    await initializeApplication(fakeApp(), {
      requestUrl: 'https://app.zoo.dev/',
      usesHashRouter: false,
    })

    expect(mocks.readInitialUrl).toHaveBeenCalledTimes(1)
    expect(mocks.initFileRoute).toHaveBeenCalledWith(expect.anything(), {
      id: '/projects/demo/main.kcl',
      startup: { search: '?pool=alpha', hash: '' },
    })
  })

  it('projects a typed home transition after home state is ready', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'index' },
      search: '?pool=alpha',
      hash: '',
    })
    mocks.initIndexRoute.mockResolvedValue({
      kind: 'transition',
      destination: { type: 'home' },
      urlState: { search: '?pool=alpha', hash: '' },
    })
    mocks.initHomeRoute.mockResolvedValue({ kind: 'ready', data: {} })
    mocks.formatUrl.mockReturnValue('/home?pool=alpha')

    await initializeApplication(fakeApp(), {
      requestUrl: 'https://app.zoo.dev/',
      usesHashRouter: false,
    })

    expect(mocks.formatUrl).toHaveBeenCalledWith({
      destination: { type: 'home' },
      search: '?pool=alpha',
      hash: '',
    })
    expect(mocks.navigate).toHaveBeenCalledWith('/home?pool=alpha', {
      replace: true,
    })
    expect(mocks.initHomeRoute).toHaveBeenCalledBefore(mocks.navigate)
  })

  it('leaves an unrecognized URL to the render-only routing shell', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'unrecognized',
      pathname: '/not-found',
      search: '',
      hash: '',
    })

    await initializeApplication(fakeApp(), {
      requestUrl: 'https://app.zoo.dev/not-found',
      usesHashRouter: false,
    })

    expect(mocks.initIndexRoute).not.toHaveBeenCalled()
    expect(mocks.initHomeRoute).not.toHaveBeenCalled()
    expect(mocks.initFileRoute).not.toHaveBeenCalled()
  })
})
