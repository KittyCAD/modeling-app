import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useApp: vi.fn(), desktop: false }))
vi.mock('@src/lib/boot', () => ({ useApp: mocks.useApp }))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: () => mocks.desktop }))

import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import {
  createAppLaunchService,
  type AppLaunchDependencies,
} from '@src/lib/appLaunch'
import { parseLaunchRequest } from '@src/lib/launchRequest'
import type { AppLaunchService } from '@src/registry/contracts/appLaunch'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import type { NavigateFunction } from 'react-router-dom'

const disposals: (() => void)[] = []
beforeEach(() => {
  mocks.desktop = false
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function harness(loggedIn = true) {
  const isLoggedIn = signal(loggedIn)
  const choice = Promise.withResolvers<undefined>()
  const execute = vi.fn<AppLaunchDependencies['execute']>(async () => undefined)
  let navigate: NavigateFunction | undefined
  let currentSearch = ''
  const launch = createAppLaunchService({
    isLoggedIn,
    isDesktop: mocks.desktop,
    navigation: { intentRevision: signal(0), openProject: vi.fn() },
    execute,
    chooseWeb: async () => {
      await choice.promise
      const params = new URLSearchParams(currentSearch)
      params.delete('ask-open-desktop')
      await navigate?.(
        { pathname: '/', search: params.toString() },
        { replace: true }
      )
    },
    reportError: vi.fn(),
  })
  disposals.push(launch.dispose)
  mocks.useApp.mockReturnValue({
    registry: {
      get: (service: unknown) =>
        service === appLaunchService ? launch : undefined,
    },
  })
  function Probe() {
    navigate = useNavigate()
    currentSearch = useLocation().search
    return <output>{currentSearch}</output>
  }
  const renderAt = (search: string) =>
    render(
      <MemoryRouter initialEntries={['/' + search]}>
        <Probe />
        <OpenInDesktopAppHandler>
          <p>Dummy app contents</p>
        </OpenInDesktopAppHandler>
      </MemoryRouter>
    )
  return { launch, execute, choice, isLoggedIn, renderAt }
}

async function accept(launch: AppLaunchService, search: string) {
  const parsed = parseLaunchRequest(search)
  expect(parsed.request).toBeDefined()
  if (!parsed.request) return
  await launch.accept({
    destination: { type: 'index' },
    urlState: { search, hash: '' },
    ...parsed,
    request: parsed.request,
  })
}

describe('OpenInDesktopAppHandler', () => {
  test('renders children when no desktop choice was requested', () => {
    const state = harness()
    state.renderAt('')
    expect(screen.getByText('Dummy app contents')).toBeInTheDocument()
    expect(screen.queryByText('Open in desktop app')).not.toBeInTheDocument()
  })

  test('keeps the transferable query until the launch owner finishes the web choice', async () => {
    const state = harness()
    const search =
      '?ask-open-desktop&cmd=set-layout&groupId=application&ttc-prompt=make+a+gear'
    await accept(state.launch, search)
    state.renderAt(search)
    fireEvent.click(screen.getByRole('button', { name: /Continue to web app/ }))
    expect(screen.queryByText('Dummy app contents')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(search)
    expect(state.execute).not.toHaveBeenCalled()
    await act(async () => {
      state.choice.resolve(undefined)
    })
    await waitFor(() =>
      expect(screen.getByText('Dummy app contents')).toBeInTheDocument()
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '?cmd=set-layout&groupId=application&ttc-prompt=make+a+gear'
    )
    expect(state.execute).toHaveBeenCalledOnce()
  })

  test('continues a signed-out web choice without consuming the login handoff query', async () => {
    const state = harness(false)
    const search = '?ask-open-desktop&project-id=shared-model'
    await accept(state.launch, search)
    state.renderAt(search)
    fireEvent.click(screen.getByRole('button', { name: /Continue to web app/ }))
    await act(async () => {
      state.choice.resolve(undefined)
    })
    await waitFor(() =>
      expect(screen.getByText('Dummy app contents')).toBeInTheDocument()
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '?project-id=shared-model'
    )
    expect(state.execute).not.toHaveBeenCalled()
    expect(state.launch.pending.value).toBe(true)
    await act(async () => {
      state.isLoggedIn.value = true
    })
    expect(state.execute).toHaveBeenCalledOnce()
  })

  test('does not present the redundant choice in desktop', () => {
    mocks.desktop = true
    const state = harness()
    state.renderAt('?ask-open-desktop')
    expect(screen.getByText('Dummy app contents')).toBeInTheDocument()
    expect(screen.queryByText('Open in desktop app')).not.toBeInTheDocument()
  })
})
