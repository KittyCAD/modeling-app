import UserSidebarMenu from '@src/components/UserSidebarMenu'
import { listAllEnvironmentsWithTokens } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/desktop', () => ({ listAllEnvironmentsWithTokens: vi.fn() }))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: vi.fn(() => false) }))
vi.mock('@src/hooks/usePlatform', () => ({ default: () => 'macos' }))

const actions = {
  fileOperations: testFileOperations,
  onSignOut: vi.fn(),
  onSignOutAll: vi.fn(),
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDesktop).mockReturnValue(false)
})
afterEach(cleanup)

it('opens account settings through the route supplied by the header', () => {
  const settingsBasePath = '/file/captured-file'
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <UserSidebarMenu {...actions} settingsBasePath={settingsBasePath} />
        ),
      },
    ],
    { initialEntries: ['/file/some-other-file'] }
  )
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
  expect(
    screen.queryByRole('button', { name: 'Check for updates' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /User settings/ }))
  expect(router.state.location.pathname + router.state.location.search).toBe(
    settingsBasePath + PATHS.SETTINGS_USER
  )
  expect(screen.queryByTestId('user-dropdown')).not.toBeInTheDocument()
  expect(listAllEnvironmentsWithTokens).not.toHaveBeenCalled()
})

it('shows all-environment sign out again after the account menu remounts', async () => {
  vi.mocked(isDesktop).mockReturnValue(true)
  vi.mocked(listAllEnvironmentsWithTokens).mockResolvedValue([
    'dev.zoo.dev',
    'zoo.dev',
  ])
  for (let mount = 0; mount < 2; mount++) {
    const view = render(
      <MemoryRouter>
        <UserSidebarMenu {...actions} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(
      await screen.findByRole('button', {
        name: 'Sign out of all environments',
      })
    ).toBeInTheDocument()
    view.unmount()
  }
})
