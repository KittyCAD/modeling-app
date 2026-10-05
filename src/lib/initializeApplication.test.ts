import type { App } from '@src/lib/app'
import {
  initializeApplication,
  restoreApplicationDestination,
} from '@src/lib/initializeApplication'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { openProjectIntent } from '@src/registry/contracts/projectSession'
import { openSettingsIntent } from '@src/registry/extensions/settings/overlay'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readInitialUrl: vi.fn(),
  formatUrl: vi.fn(),
  navigate: vi.fn(),
  dispatch: vi.fn(async () => undefined),
  accept: vi.fn(),
}))

function fakeApp(): App {
  return {
    registry: {
      get: (service: unknown) =>
        service === appLaunchService
          ? { accept: mocks.accept }
          : service === appNavigationService
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
  it('hands off launch work without blocking React on command readiness', async () => {
    const pending = Promise.withResolvers<undefined>()
    mocks.accept.mockReturnValueOnce(pending.promise)
    const search =
      '?cmd=set-layout&groupId=application&layoutId=zookeeper&ttc-prompt=make+a+gear&pool=alpha'
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'home' },
      search,
      hash: '',
    })
    await initializeApplication(fakeApp())
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({
      destination: { type: 'home' },
      urlState: { search, hash: '' },
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
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    pending.resolve(undefined)
  })

  it('uses owned startup dispatch and stops before later effects on cancellation', async () => {
    const abort = new AbortController()
    const dispatch = vi.fn(async () => {
      abort.abort()
      return undefined as never
    })
    await expect(
      restoreApplicationDestination(
        fakeApp(),
        {
          type: 'launch',
          destination: { type: 'home' },
          additionalIntents: [{ intent: openSettingsIntent, input: {} }],
          search: '?pool=alpha',
          hash: '',
        },
        { dispatch, signal: abort.signal, projectUrl: true }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(showHomeIntent, {
      startup: {
        additionalIntents: [{ intent: openSettingsIntent, input: {} }],
        search: '?pool=alpha',
        hash: '',
      },
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('dispatches the initial project intent without React Router', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket/main.kcl' },
      search: '?pool=alpha',
      hash: '#section',
    })
    const app = fakeApp()
    await initializeApplication(app, {
      requestUrl: 'https://app.zoo.dev/file/%2Fprojects%2Fbracket%2Fmain.kcl',
      usesHashRouter: false,
    })

    expect(mocks.dispatch).toHaveBeenCalledWith(openProjectIntent, {
      target: '/projects/bracket/main.kcl',
      startup: { search: '?pool=alpha', hash: '#section' },
    })
  })

  it('retains the desktop choice before restoring its destination', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'index' },
      search: '?ask-open-desktop=true',
      hash: '',
    })

    await initializeApplication(fakeApp(), {
      requestUrl: 'https://app.zoo.dev/?ask-open-desktop=true',
      usesHashRouter: false,
    })

    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({ request: { askOpenDesktop: true } })
    )
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('projects a typed home transition after home state is ready', async () => {
    mocks.readInitialUrl.mockReturnValue({
      type: 'launch',
      destination: { type: 'home' },
      search: '?pool=alpha',
      hash: '',
      shouldProjectUrl: true,
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
    await initializeApplication(fakeApp())

    expect(mocks.dispatch).toHaveBeenCalledWith(openSettingsIntent, {
      tab: 'project',
    })
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, openProjectIntent, {
      target: '/projects/bracket',
      startup: {
        additionalIntents: [
          { intent: openSettingsIntent, input: { tab: 'project' } },
        ],
        search: '?tab=project',
        hash: '',
      },
    })
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, openSettingsIntent, {
      tab: 'project',
    })
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

    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
