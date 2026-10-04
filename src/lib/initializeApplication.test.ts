import type { App } from '@src/lib/app'
import { initializeApplication } from '@src/lib/initializeApplication'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { openProjectIntent } from '@src/registry/contracts/projectSession'
import { openSettingsIntent } from '@src/registry/extensions/settings/overlay'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

const mocks = vi.hoisted(() => ({
  readInitialUrl: vi.fn(),
  formatUrl: vi.fn(),
  navigate: vi.fn(),
  dispatch: vi.fn(async () => undefined),
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
  it.each(['loggedIn', 'loggedOut'])(
    'resolves cloud URLs only after auth is %s',
    async (authState) => {
      const actor = createActor(
        createMachine({
          initial: authState,
          states: { loggedIn: {}, loggedOut: {} },
        })
      ).start()
      const app = fakeApp()
      app.auth = { actor } as unknown as App['auth']
      mocks.readInitialUrl.mockReturnValue({
        type: 'launch',
        destination: {
          type: 'cloud-project',
          projectId: 'project',
          file: 'parts/main.kcl',
        },
        search: '?file=parts%2Fmain.kcl',
        hash: '',
      })
      mocks.formatUrl.mockReturnValue('/projects/project?file=parts%2Fmain.kcl')
      await initializeApplication(app)
      if (authState === 'loggedIn') {
        expect(mocks.dispatch).toHaveBeenCalledWith(openProjectIntent, {
          cloudProjectId: 'project',
          target: 'parts/main.kcl',
          startup: { search: '?file=parts%2Fmain.kcl', hash: '' },
        })
      } else {
        const search =
          '?returnTo=%2Fprojects%2Fproject%3Ffile%3Dparts%252Fmain.kcl'
        expect(mocks.navigate).toHaveBeenCalledWith(`/signin${search}`, {
          replace: true,
        })
        expect(mocks.dispatch).toHaveBeenCalledWith(startSignInIntent, {
          reason: 'startup',
          startup: { search, hash: '' },
        })
        expect(mocks.dispatch).not.toHaveBeenCalledWith(
          openProjectIntent,
          expect.anything()
        )
      }
      actor.stop()
    }
  )
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

  it('leaves the deferred open-in-desktop index intent untouched', async () => {
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
