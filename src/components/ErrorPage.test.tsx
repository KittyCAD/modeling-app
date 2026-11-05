import { render, screen, waitFor } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryRouter,
  type LoaderFunction,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn(async () => {}),
  isDesktop: vi.fn(() => false),
  appCheckForUpdates: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    UnsupportedBrowserFeature: 'unsupported_browser_feature',
  },
  reportClientError: mocks.reportClientError,
}))

vi.mock('@src/lib/isDesktop', () => ({
  isDesktop: mocks.isDesktop,
}))

vi.mock('@src/routes/utils', () => ({
  APP_VERSION: '1.0.0',
  getReleaseUrl: () =>
    'https://github.com/KittyCAD/modeling-app/releases/tag/v1.0.0',
}))

import { ErrorPage } from '@src/components/ErrorPage'
import { clearAutoUpdateReady, setAutoUpdateReady } from '@src/lib/autoUpdate'

function renderErrorPage(error: unknown) {
  const loader: LoaderFunction = () => {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
  const router = createMemoryRouter([
    {
      path: '/',
      loader,
      errorElement: <ErrorPage />,
      element: <></>,
    },
    {
      path: '/home',
      element: <></>,
    },
  ])

  return render(<RouterProvider router={router} />)
}

describe('ErrorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDesktop.mockReturnValue(false)
    vi.stubGlobal('electron', {
      appCheckForUpdates: mocks.appCheckForUpdates,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36'
    )
  })

  afterEach(() => {
    clearAutoUpdateReady()
    vi.unstubAllGlobals()
  })

  it('offers actionable browser recovery for iterator compatibility errors', async () => {
    const error = new TypeError(
      'this.editors.entries(...).toArray is not a function'
    )

    renderErrorPage(error)

    expect(
      await screen.findByRole('heading', {
        name: 'Your browser needs an update',
      })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: /Go Home$/ })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(
      screen.getByRole('link', { name: 'Update browser' })
    ).toHaveAttribute('href', 'https://browser-update.org/update-browser.html')
    expect(screen.queryByRole('button', { name: /Reload$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Clear Storage$/ })).toBeNull()
    await waitFor(() => {
      expect(mocks.reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'unsupported_browser_feature',
          error,
          errorName: 'UnsupportedBrowserFeature',
          extra: expect.objectContaining({
            browserName: 'Chrome',
            browserVersion: '117.0.0.0',
            missingCapability: 'Iterator.prototype.toArray',
          }),
        })
      )
    })
  })

  it('keeps generic recovery for unrelated route errors', async () => {
    renderErrorPage(new Error('unrelated failure'))

    expect(
      await screen.findByRole('heading', {
        name: 'An unexpected error occurred',
      })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /Reload$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Clear Storage$/ })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Update browser' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Check for updates' })
    ).toBeNull()
    expect(mocks.appCheckForUpdates).not.toHaveBeenCalled()
  })

  it('checks automatically and keeps desktop updates available after a route error', async () => {
    mocks.isDesktop.mockReturnValue(true)
    setAutoUpdateReady({ version: '1.2.3' })
    renderErrorPage(new Error('unrelated failure'))

    expect(
      await screen.findByRole('button', {
        name: 'Restart to update to v1.2.3',
      })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'v1.0.0' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Check for updates' })
    ).toBeNull()
    expect(mocks.appCheckForUpdates).toHaveBeenCalledOnce()
  })
})
