import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
} from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/components/Loading', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { PendingFileNavigation } from '@src/components/PendingFileNavigation'

const mainPath = '/projects/demo project/parts/main %.kcl'
const adjacentPath = '/projects/demo project/adjacent.kcl'
const route = (path: string) => `/file/${encodeURIComponent(path)}`
let router: ReturnType<typeof createBrowserRouter> | undefined

afterEach(() => {
  router?.dispose()
  window.history.replaceState(null, '', '/')
})

describe.each([
  { name: 'browser', createRouter: createBrowserRouter, prefix: '' },
  { name: 'desktop hash', createRouter: createHashRouter, prefix: '/#' },
])('$name routing', ({ createRouter, prefix }) => {
  const currentRoute = () =>
    prefix ? window.location.hash.slice(1) : window.location.pathname
  async function setup() {
    const activeFile = signal(adjacentPath)
    const unmounted = vi.fn()
    let finishLoad = () => {}
    const gate = new Promise<void>((resolve) => {
      finishLoad = resolve
    })
    let finishSupersedingLoad = () => {}
    const supersedingGate = new Promise<void>((resolve) => {
      finishSupersedingLoad = resolve
    })

    function Editor() {
      useSignals()
      useEffect(() => unmounted, [])
      return <h1>{activeFile.value}</h1>
    }

    window.history.replaceState(null, '', prefix + route(adjacentPath))
    let loadCount = 0
    const testRouter = createRouter([
      {
        path: '/file/:id/*',
        loader: async ({ params }) => {
          // The superseding loader also awaits settings and file reads before
          // it can restore the original file in the shared editor.
          if (++loadCount === 3) await supersedingGate
          // Mirror fileLoader: publish the new editor before execution finishes.
          activeFile.value = params.id ?? ''
          if (loadCount === 2) await gate
          return null
        },
        element: (
          <PendingFileNavigation>
            <Editor />
          </PendingFileNavigation>
        ),
        hydrateFallbackElement: <div>Initial load</div>,
      },
    ])
    router = testRouter
    render(<RouterProvider router={testRouter} />)
    expect(await screen.findByRole('heading')).toHaveTextContent(adjacentPath)
    return { router: testRouter, finishLoad, finishSupersedingLoad, unmounted }
  }

  it('does not expose a new active file until browser history commits', async () => {
    const { router, finishLoad, unmounted } = await setup()
    let navigation: Promise<void> | undefined
    await act(async () => {
      navigation = router.navigate(route(mainPath))
    })

    expect(currentRoute()).toBe(route(adjacentPath))
    expect(screen.getByRole('status')).toHaveTextContent('Loading file...')
    expect(screen.getByRole('heading', { hidden: true })).toHaveTextContent(
      mainPath
    )
    expect(screen.getByRole('heading', { hidden: true })).not.toBeVisible()
    expect(
      screen.getByRole('heading', { hidden: true }).parentElement
    ).toHaveAttribute('inert')
    expect(unmounted).not.toHaveBeenCalled()

    await act(async () => {
      finishLoad()
      await navigation
    })

    expect(screen.getByRole('heading')).toBeVisible()
    expect(screen.getByRole('heading')).toHaveTextContent(mainPath)
    expect(currentRoute()).toBe(route(mainPath))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('keeps a superseding file visible after an abandoned loader finishes', async () => {
    const { router, finishLoad, finishSupersedingLoad } = await setup()
    let abandonedNavigation: Promise<void> | undefined
    await act(async () => {
      abandonedNavigation = router.navigate(route(mainPath))
    })
    let nextNavigation: Promise<void> | undefined
    await act(async () => {
      nextNavigation = router.navigate(route(adjacentPath))
    })

    expect(currentRoute()).toBe(route(adjacentPath))
    expect(screen.getByRole('heading', { hidden: true })).toHaveTextContent(
      mainPath
    )
    expect(screen.getByRole('heading', { hidden: true })).not.toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Loading file...')

    await act(async () => {
      finishSupersedingLoad()
      await nextNavigation
      finishLoad()
      await abandonedNavigation
    })

    expect(currentRoute()).toBe(route(adjacentPath))
    expect(screen.getByRole('heading')).toHaveTextContent(adjacentPath)
    expect(screen.getByRole('heading')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('leaves the current file visible while loading its settings route', async () => {
    const { router, finishLoad } = await setup()
    let navigation: Promise<void> | undefined
    await act(async () => {
      navigation = router.navigate(route(adjacentPath) + '/settings')
    })
    expect(currentRoute()).toBe(route(adjacentPath))
    expect(screen.getByRole('heading')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => {
      finishLoad()
      await navigation
    })
    expect(currentRoute()).toBe(route(adjacentPath) + '/settings')
  })
})
