import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { getSortFunction } from '@src/lib/sorting'
import { routerService } from '@src/registry/contracts/router'
import {
  defineUrlContribution,
  urlContributionsValueSpec,
  urlService,
} from '@src/registry/contracts/url'
import routerRegistryItem from '@src/registry/extensions/router'
import { RouterServiceSync } from '@src/registry/extensions/router/RouterServiceSync'
import urlRegistryItem, {
  createBrowserUrlAdapter,
} from '@src/registry/extensions/url'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createBrowserRouter,
  createHashRouter,
  Link,
  RouterProvider,
} from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

it.each([false, true])(
  'keeps sorting after library navigation and reload (hash router: %s)',
  async (hashRouter) => {
    window.history.replaceState(
      null,
      '',
      hashRouter ? '/index.html?outer=yes#/home' : '/home'
    )

    async function openApp() {
      const registry = new Registry()
      // A sorting consumer of the URL contract; the production migration is stacked above this PR.
      const sort = signal('modified:desc')
      const parse = vi.fn(
        (params: URLSearchParams) => params.get('sort_by') ?? undefined
      )
      registry.configure([
        routerRegistryItem,
        urlRegistryItem,
        defineRegistryItem({
          provides: [
            provide(
              urlContributionsValueSpec,
              defineUrlContribution({
                id: 'project-sorting',
                queryKeys: ['sort_by'],
                parse,
                initialize: (value) => {
                  sort.value = value
                },
                serialize: () => ({ sort_by: sort.value }),
              })
            ),
          ],
        }),
      ])
      await registry
        .get(urlService)
        .start(createBrowserUrlAdapter(window, hashRouter))

      function ProjectList() {
        useSignals()
        const projects = [
          { name: 'alpha', modified: 30 },
          { name: 'zebra', modified: 10 },
        ].toSorted(getSortFunction(sort.value))
        return (
          <>
            <RouterServiceSync router={registry.get(routerService)} />
            <button
              onClick={() => {
                sort.value = 'name'
              }}
            >
              Sort by name
            </button>
            <Link to="/library/local?keep=yes#details">Open library</Link>
            <ol aria-label="Projects">
              {projects.map((project) => (
                <li key={project.name}>{project.name}</li>
              ))}
            </ol>
          </>
        )
      }

      const createRouter = hashRouter ? createHashRouter : createBrowserRouter
      const router = createRouter([{ path: '*', element: <ProjectList /> }])
      const view = render(<RouterProvider router={router} />)
      return {
        parse,
        close: () => {
          view.unmount()
          router.dispose()
          registry[Symbol.dispose]()
        },
      }
    }

    let app = await openApp()
    try {
      expect(
        screen.getAllByRole('listitem').map((item) => item.textContent)
      ).toEqual(['alpha', 'zebra'])
      fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
      await waitFor(() => {
        expect(
          screen.getAllByRole('listitem').map((item) => item.textContent)
        ).toEqual(['zebra', 'alpha'])
      })

      fireEvent.click(screen.getByRole('link', { name: 'Open library' }))
      await waitFor(() => {
        expect(
          hashRouter
            ? window.location.hash
            : window.location.pathname +
                window.location.search +
                window.location.hash
        ).toBe(
          `${hashRouter ? '#' : ''}/library/local?keep=yes&sort_by=name#details`
        )
      })
      expect(app.parse).toHaveBeenCalledTimes(1)
      if (hashRouter) expect(window.location.search).toBe('?outer=yes')

      // A reload creates fresh application state from the current address bar.
      app.close()
      app = await openApp()
      expect(
        screen.getAllByRole('listitem').map((item) => item.textContent)
      ).toEqual(['zebra', 'alpha'])
    } finally {
      app.close()
    }
  }
)
