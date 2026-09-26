import { defineRegistryItem, Registry } from '@kittycad/registry'
import { SessionExpiredDialogHostContent } from '@src/components/SessionExpiredDialog'
import {
  clearSessionExpiredNotice,
  fetchWithSessionExpiration,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { Themes } from '@src/lib/theme'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { AppNavigationService } from '@src/registry/contracts/appNavigation'
import {
  type AuthRegistryService,
  authService,
  provideAuthSessionExpiredListener,
  startSignInIntent,
} from '@src/registry/contracts/auth'
import authRegistryItem from '@src/registry/extensions/auth'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

const sessionExpiredDialogSpecMocks = vi.hoisted<{
  app: unknown
  readEnvironmentFile: ReturnType<typeof vi.fn>
  writeEnvironmentFile: ReturnType<typeof vi.fn>
  toast: {
    error: ReturnType<typeof vi.fn>
    success: ReturnType<typeof vi.fn>
  }
  dispatch: ReturnType<typeof vi.fn>
}>(() => ({
  app: undefined,
  readEnvironmentFile: vi.fn().mockResolvedValue(''),
  writeEnvironmentFile: vi.fn().mockResolvedValue(undefined),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => sessionExpiredDialogSpecMocks.app,
}))

vi.mock('@src/lib/desktop', () => ({
  readEnvironmentFile: sessionExpiredDialogSpecMocks.readEnvironmentFile,
  writeEnvironmentFile: sessionExpiredDialogSpecMocks.writeEnvironmentFile,
}))

vi.mock('react-hot-toast', () => ({
  default: sessionExpiredDialogSpecMocks.toast,
}))

type AuthStateName = 'loggedIn' | 'sessionExpired' | 'loggedOut'
type AuthEvent = Parameters<AuthRegistryService['send']>[0]

const sentAuthEvents: AuthEvent[] = []
const originalElectron = window.electron
let expireFakeAuthSession: (() => void) | undefined
let registry: Registry | undefined

const fakeSettings = {
  useSettings: () => ({
    app: {
      theme: {
        current: Themes.Light,
      },
    },
  }),
}

const fakeUserResponse = {
  id: 'test-user-id',
  name: 'Expired Session Tester',
  email: 'expired-session@example.com',
  image: '',
  created_at: '2026-08-03T12:00:00.000Z',
  updated_at: '2026-08-03T12:00:00.000Z',
  can_train_on_data: false,
  is_onboarded: true,
  is_service_account: false,
  deletion_scheduled: false,
}

function createAuthSnapshot(stateName: AuthStateName) {
  return {
    context: {
      token: stateName === 'loggedIn' ? 'expired-token' : '',
    },
    matches: (value: string) => value === stateName,
  } as unknown as ReturnType<AuthRegistryService['useAuthState']>
}

function AuthShell() {
  const [authStateName, setAuthStateName] = useState<AuthStateName>('loggedIn')
  const auth = useMemo(
    () =>
      ({
        send: (event: AuthEvent) => {
          sentAuthEvents.push(event)
          if (event.type === 'Session expired') {
            setAuthStateName('sessionExpired')
          }
          if (event.type === 'Acknowledge session expired') {
            setAuthStateName('loggedOut')
          }
          if (event.type === 'Log in') {
            setAuthStateName('loggedIn')
          }
        },
        sessionExpiredNotice,
        clearSessionExpiredNotice,
        useAuthState: () => createAuthSnapshot(authStateName),
      }) as AuthRegistryService,
    [authStateName]
  )

  expireFakeAuthSession = () => {
    if (authStateName === 'loggedIn') {
      auth.send({ type: 'Session expired' })
    }
  }

  sessionExpiredDialogSpecMocks.app = {
    auth,
    settings: fakeSettings,
  }
  const appNavigation = {
    dispatch: sessionExpiredDialogSpecMocks.dispatch,
  } as unknown as AppNavigationService

  return (
    <>
      <SessionExpiredDialogHostContent
        auth={auth}
        appNavigation={appNavigation}
      />
      <Outlet />
    </>
  )
}

afterEach(() => {
  registry?.[Symbol.dispose]()
  registry = undefined
  clearSessionExpiredNotice()
  expireFakeAuthSession = undefined
  sentAuthEvents.length = 0
  sessionExpiredDialogSpecMocks.app = undefined
  sessionExpiredDialogSpecMocks.dispatch.mockClear()
  window.electron = originalElectron
  vi.unstubAllGlobals()
})

describe('SessionExpiredDialog', () => {
  test('dispatches sign-in after a monitored 401 expires auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.includes('/user/projects')) {
          return new Response('', { status: 401 })
        }

        return new Response(JSON.stringify(fakeUserResponse), {
          headers: {
            'content-type': 'application/json',
          },
        })
      })
    )
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-session-expired-dialog-listener',
        provides: [
          provideAuthSessionExpiredListener(
            'test-session-expired-dialog-listener',
            () => expireFakeAuthSession?.()
          ),
        ],
      }),
      authRegistryItem,
    ])
    registry.get(authService)

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <AuthShell />,
          children: [
            {
              path: '*',
              element: <div>Modeling workspace</div>,
            },
          ],
        },
      ],
      {
        initialEntries: ['/file/project/main.kcl'],
      }
    )

    render(<RouterProvider router={router} />)

    await act(async () => {
      await fetchWithSessionExpiration('/user/projects')
    })

    expect(
      await screen.findByRole('dialog', { name: /session expired/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your account may be blocked if you've seen this multiple times."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /check your account standing/i })
    ).toHaveAttribute('href', withSiteBaseURL('/account'))

    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }))

    expect(sessionExpiredDialogSpecMocks.dispatch).toHaveBeenCalledWith(
      startSignInIntent,
      { reason: 'session-expired' }
    )
    expect(sentAuthEvents).toContainEqual({ type: 'Session expired' })
    expect(sentAuthEvents).toContainEqual({
      type: 'Acknowledge session expired',
    })
  })
})
