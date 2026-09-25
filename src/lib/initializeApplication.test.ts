import type { App } from '@src/lib/app'
import { initializeApplication } from '@src/lib/initializeApplication'
import {
  appNavigationService,
  showHomeIntent,
} from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { openSettingsIntent } from '@src/registry/extensions/settings/overlay'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initIndexRoute: vi.fn(),
  initHomeRoute: vi.fn(),
  initFileRoute: vi.fn(),
  readInitialUrl: vi.fn(),
  formatUrl: vi.fn(),
  navigate: vi.fn(),
  dispatch: vi.fn(async () => undefined),
}))

vi.mock('@src/lib/routeInit', () => ({
  initIndexRoute: mocks.initIndexRoute,
  initHomeRoute: mocks.initHomeRoute,
  initFileRoute: mocks.initFileRoute,
}))

function fakeApp(): App {
  return {
    registry: {
      get: (service: unknown) =>
        service === appNavigationService
          ? { dispatch: mocks.dispatch }
          : {
              readInitialUrl: mocks.readInitialUrl,
              formatUrl: mocks.formatUrl,
              navigate: mocks.navigate,
            },
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
    expect(mocks.dispatch).toHaveBeenCalledWith(showHomeIntent, {
      startup: { search: '?pool=alpha', hash: '' },
    })
    expect(mocks.dispatch).toHaveBeenCalledBefore(mocks.navigate)
  })

  it('dispatches contributed additional intents after the primary destination', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      additionalIntents: [
        { intent: openSettingsIntent, input: { tab: 'project' } },
      ],
      search: '?tab=project',
      hash: '',
    })
    mocks.initFileRoute.mockResolvedValue({ kind: 'ready', data: {} })

    await initializeApplication(fakeApp())

    expect(mocks.dispatch).toHaveBeenCalledWith(openSettingsIntent, {
      tab: 'project',
    })
    expect(mocks.initFileRoute).toHaveBeenCalledBefore(mocks.dispatch)
  })

  it('dispatches the auth-owned sign-in intent at startup', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'sign-in' },
      search: '?from=desktop',
      hash: '',
    })

    await initializeApplication(fakeApp())

    expect(mocks.dispatch).toHaveBeenCalledWith(startSignInIntent, {
      reason: 'startup',
      startup: { search: '?from=desktop', hash: '' },
    })
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
