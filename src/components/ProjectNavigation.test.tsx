import { AppLogoHeaderItem } from '@src/registry/extensions/appLogo/AppLogoHeaderItem'
import { PATHS } from '@src/lib/paths'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(cleanup)
it('contributes the logo and Home link without project services', () => {
  // The Home context needs no editor or project services.
  const router = createMemoryRouter(
    [{ path: '*', element: <AppLogoHeaderItem context={{ type: 'home' }} /> }],
    { initialEntries: ['/home'] }
  )
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('link', { name: 'Projects' }))
  expect(router.state.location.pathname).toBe(PATHS.HOME)
})

it('runs legacy project cleanup before following a custom logo Home link', () => {
  const onProjectClose = vi.fn()
  const onHomeNavigate = vi.fn()
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppLogoHeaderItem
            context={{ type: 'legacy-project', onProjectClose, onHomeNavigate }}
            label="Workshop - Home"
          >
            <span>Workshop</span>
          </AppLogoHeaderItem>
        ),
      },
    ],
    { initialEntries: ['/file/current'] }
  )
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('link', { name: 'Workshop - Home' }))
  expect(onProjectClose).toHaveBeenCalledWith(null, null, false)
  expect(onHomeNavigate).toHaveBeenCalledOnce()
  expect(router.state.location.pathname).toBe(PATHS.HOME)
})
