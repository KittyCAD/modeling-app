import type { App } from '@src/lib/app'
import { initializeApplication } from '@src/lib/initializeApplication'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initIndexRoute: vi.fn(),
  initHomeRoute: vi.fn(),
  initFileRoute: vi.fn(),
  readInitialUrl: vi.fn(),
  navigate: vi.fn(),
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
        navigate: mocks.navigate,
      }),
    },
  } as unknown as App
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('initializeApplication', () => {
  it('dispatches the initial project intent without React Router', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket/main.kcl' },
    })
    mocks.initFileRoute.mockResolvedValue({ kind: 'ready', data: {} })

    const app = fakeApp()
    await initializeApplication(app, {
      requestUrl: 'https://app.zoo.dev/file/%2Fprojects%2Fbracket%2Fmain.kcl',
      usesHashRouter: false,
    })

    expect(mocks.initFileRoute).toHaveBeenCalledWith(app, {
      id: '/projects/bracket/main.kcl',
      requestUrl: 'https://app.zoo.dev/file/%2Fprojects%2Fbracket%2Fmain.kcl',
    })
  })

  it('follows a typed transition and projects its URL after state is ready', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'index' },
    })
    mocks.initIndexRoute.mockResolvedValue({
      kind: 'transition',
      destination: {
        type: 'project',
        target: '/projects/demo/main.kcl',
      },
      canonicalPath: '/file/%2Fprojects%2Fdemo%2Fmain.kcl?pool=alpha',
    })
    mocks.initFileRoute.mockResolvedValue({ kind: 'ready', data: {} })

    await initializeApplication(fakeApp(), {
      requestUrl: 'https://app.zoo.dev/',
      usesHashRouter: false,
    })

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/file/%2Fprojects%2Fdemo%2Fmain.kcl?pool=alpha',
      { replace: true }
    )
    expect(mocks.readInitialUrl).toHaveBeenCalledTimes(1)
    expect(mocks.initFileRoute).toHaveBeenCalledWith(expect.anything(), {
      id: '/projects/demo/main.kcl',
      requestUrl:
        'https://app.zoo.dev/file/%2Fprojects%2Fdemo%2Fmain.kcl?pool=alpha',
    })
    expect(mocks.initFileRoute).toHaveBeenCalledBefore(mocks.navigate)
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
