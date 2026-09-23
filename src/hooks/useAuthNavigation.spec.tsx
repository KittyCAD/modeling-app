import { signal } from '@preact/signals-core'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'

function AuthProbe() {
  useAuthNavigation()
  const location = useLocation()
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  )
}

function harness({ loggedIn = true, pending = false } = {}) {
  const authState = signal(loggedIn ? 'loggedIn' : 'loggedOut')
  const launchPending = signal(pending)
  const showHome = vi.fn(async () => undefined)
  mocks.useApp.mockReturnValue({
    auth: {
      useAuthState: () => {
        const state = authState.value
        return { matches: (expected: string) => state === expected }
      },
    },
    registry: {
      get: (service: unknown) => {
        if (service === appLaunchService) return { pending: launchPending }
        if (service === appNavigationService) return { showHome }
        return undefined
      },
    },
  })
  return { authState, launchPending, showHome }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isDesktop.mockReturnValue(true)
})

describe('authentication navigation with pending launch work', () => {
  test('keeps a signed-out launch query through sign-in and lets its owner resume', async () => {
    const state = harness({ loggedIn: false, pending: true })
    const search = '?cmd=set-layout&groupId=application&ttc-prompt=make+a+gear'
    render(
      <MemoryRouter initialEntries={['/file/gear' + search]}>
        <AuthProbe />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('/signin' + search)
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
