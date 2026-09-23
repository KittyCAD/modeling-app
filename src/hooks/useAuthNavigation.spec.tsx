import { signal } from '@preact/signals-core'
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  createBrowserRouter,
  createHashRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  isDesktop: vi.fn(() => true),
  generateSignInUrl: vi.fn(() => 'https://accounts.example/sign-in'),
}))

vi.mock('@src/lib/boot', () => ({ useApp: mocks.useApp }))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@src/lib/isMobile', () => ({ isMobile: () => false }))
vi.mock('@src/routes/utils', () => ({
  generateSignInUrl: mocks.generateSignInUrl,
}))

import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { createAppLaunchService } from '@src/lib/appLaunch'
import { createAppNavigationService } from '@src/lib/appNavigation'
import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { createAppUrlService } from '@src/registry/extensions/router'
import { AppUrlServiceSync } from '@src/registry/extensions/router/RouterServiceSync'

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) {
    dispose()
  }
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function AuthProbe() {
  useAuthNavigation()
  const location = useLocation()
  return (
    <>
      <AppUrlServiceSync appUrl={mocks.useApp().registry.get(appUrlService)} />
      <output>
        {location.pathname}
        {location.search}
      </output>
    </>
  )
}

function harness({ loggedIn = true, pending = false } = {}) {
  const authState = signal(loggedIn ? 'loggedIn' : 'loggedOut')
  const launchPending = signal(pending)
  const showHome = vi.fn(async () => undefined)
  const appUrl = createAppUrlService()
  mocks.useApp.mockReturnValue({
    auth: {
      useAuthState: () => {
        const state = authState.value
        return { matches: (expected: string) => state === expected }
      },
    },
    registry: {
      get: (service: unknown) => {
        if (service === appLaunchService) {
          return { pending: launchPending }
        }
        if (service === appNavigationService) {
          return { showHome }
        }
        if (service === appUrlService) {
          return appUrl
        }
        return undefined
      },
    },
  })
  return { authState, launchPending, showHome }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isDesktop.mockReturnValue(true)
  window.history.replaceState(null, '', '/signin')
})

describe('authentication navigation with pending launch work', () => {
  test.each([
    { fails: false, usesHashRouter: false },
    { fails: true, usesHashRouter: false },
    { fails: false, usesHashRouter: true },
    { fails: true, usesHashRouter: true },
  ])(
    'preserves completed launches and only falls back home on failure ($fails), hash router: $usesHashRouter',
    async ({ fails, usesHashRouter }) => {
      vi.stubGlobal('electron', usesHashRouter ? {} : undefined)
      const isLoggedIn = signal(true)
      const appUrl = createAppUrlService()
      const resolvedProject: ResolvedProjectOpen = {
        kind: 'resolved',
        projectName: 'gear',
        projectPath: '/projects/gear',
        initialEditorPath: '/projects/gear/main.kcl',
        project: {
          name: 'gear',
          path: '/projects/gear',
          children: [],
          kcl_file_count: 1,
          directory_count: 0,
          metadata: null,
          default_file: '/projects/gear/main.kcl',
          readWriteAccess: true,
        },
        file: { name: 'main.kcl', path: '/projects/gear/main.kcl' },
        canonicalTarget: '/projects/gear/main.kcl',
      }
      const showHome = vi.fn(async () => {
        await appUrl.navigate('/home')
      })
      const navigation = createAppNavigationService({
        resolveProjectOpen: async () => resolvedProject,
        openResolvedProject: async () => ({
          kind: 'opened',
          data: { project: resolvedProject.project, code: '' },
        }),
        projectOpened: () => appUrl.navigate('/file/gear', { replace: true }),
        showHome,
      })
      const prepared = Promise.withResolvers<undefined>()
      const error = new Error('Unable to open project')
      const reportError = vi.fn()
      const launch = createAppLaunchService({
        isLoggedIn,
        isDesktop: true,
        navigation,
        execute: async (_, execution) => {
          await prepared.promise
          if (fails) {
            return Promise.reject(error)
          }
          await execution.openProject({ target: '/projects/gear/main.kcl' })
        },
        chooseWeb: async () => undefined,
        reportError,
      })
      mocks.useApp.mockReturnValue({
        auth: {
          useAuthState: () => ({
            matches: (expected: string) => expected === 'loggedIn',
          }),
        },
        registry: {
          get: (service: unknown) => {
            if (service === appLaunchService) {
              return launch
            }
            if (service === appNavigationService) {
              return navigation
            }
            if (service === appUrlService) {
              return appUrl
            }
            return undefined
          },
        },
      })
      const search = '?ttc-prompt=make+a+gear'
      window.history.replaceState(
        null,
        '',
        `${usesHashRouter ? '/#' : ''}/signin${search}`
      )
      const createRouter = usesHashRouter
        ? createHashRouter
        : createBrowserRouter
      const router = createRouter([{ path: '*', element: <AuthProbe /> }])
      disposals.push(launch.dispose, () => router.dispose())
      const accepted = launch.accept({
        destination: { type: 'project', target: '/projects/gear/main.kcl' },
        urlState: { search, hash: '' },
        request: { askOpenDesktop: false, zookeeperPrompt: 'make a gear' },
        remainingSearch: '',
      })
      render(<RouterProvider router={router} />)
      expect(screen.getByRole('status')).toHaveTextContent(`/signin${search}`)

      // Router navigation resolves before RouterProvider's transition commits.
      // Completing the launch updates its signal while React still sees /signin.
      await act(async () => {
        prepared.resolve(undefined)
        await accepted
      })

      expect(launch.pending.value).toBe(false)
      expect(showHome).toHaveBeenCalledTimes(fails ? 1 : 0)
      expect(reportError).toHaveBeenCalledTimes(fails ? 1 : 0)
      expect(router.state.location.pathname).toBe(
        fails ? '/home' : '/file/gear'
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        fails ? '/home' : '/file/gear'
      )

      if (!fails) {
        await act(async () => {
          await appUrl.navigate('/signin')
        })
        expect(showHome).toHaveBeenCalledOnce()
        expect(router.state.location.pathname).toBe('/home')
        expect(screen.getByRole('status')).toHaveTextContent('/home')
      }
    }
  )

  test('keeps a signed-out launch query through sign-in and lets its owner resume', async () => {
    const state = harness({ loggedIn: false, pending: true })
    const search = '?cmd=set-layout&groupId=application&ttc-prompt=make+a+gear'
    render(
      <MemoryRouter initialEntries={[`/file/gear${search}`]}>
        <AuthProbe />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(`/signin${search}`)
    )
    act(() => {
      state.authState.value = 'loggedIn'
    })
    expect(state.showHome).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(search)
  })

  test('leaves sign-in when a pending launch fails before it can navigate', async () => {
    const state = harness({ pending: true })
    render(
      <MemoryRouter initialEntries={['/signin?ttc-prompt=hello']}>
        <AuthProbe />
      </MemoryRouter>
    )
    expect(state.showHome).not.toHaveBeenCalled()
    act(() => {
      state.launchPending.value = false
    })
    await waitFor(() => expect(state.showHome).toHaveBeenCalledOnce())
  })

  test('takes a normal signed-in entry to home when no launch is pending', () => {
    const state = harness()
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <AuthProbe />
      </MemoryRouter>
    )
    expect(state.showHome).toHaveBeenCalledOnce()
  })
})
