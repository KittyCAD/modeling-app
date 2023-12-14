import { render, screen } from '@testing-library/react'
import { App } from './App'
import { describe, test, vi } from 'vitest'
import {
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from 'react-router-dom'
import { GlobalStateProvider } from './components/GlobalStateProvider'
import CommandBarProvider from 'components/CommandBar/CommandBar'
import ModelingMachineProvider from 'components/ModelingMachineProvider'
import { BROWSER_FILE_NAME } from 'Router'

let listener: ((rect: any) => void) | undefined = undefined
;(global as any).ResizeObserver = class ResizeObserver {
  constructor(ls: ((rect: any) => void) | undefined) {
    listener = ls
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('App tests', () => {
  test('Renders the modeling app screen, including "Variables" pane.', () => {
    vi.mock('react-router-dom', async () => {
      const actual = (await vi.importActual('react-router-dom')) as Record<
        string,
        any
      >
      return {
        ...actual,
        useParams: () => ({ id: BROWSER_FILE_NAME }),
        useLoaderData: () => ({ code: null }),
      }
    })
    render(
      <TestWrap>
        <App />
      </TestWrap>
    )
    const linkElement = screen.getByText(/Variables/i)
    expect(linkElement).toBeInTheDocument()

    vi.restoreAllMocks()
  })
})

function TestWrap({ children }: { children: React.ReactNode }) {
  // We have to use a memory router in the testing environment,
  // and we have to use the createMemoryRouter function instead of <MemoryRouter /> as of react-router v6.4:
  // https://reactrouter.com/en/6.16.0/routers/picking-a-router#using-v64-data-apis
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        path="/file/:id"
        element={
          <CommandBarProvider>
            <GlobalStateProvider>
              <ModelingMachineProvider>{children}</ModelingMachineProvider>
            </GlobalStateProvider>
          </CommandBarProvider>
        }
      />
    ),
    {
      initialEntries: ['/file/new'],
      initialIndex: 0,
    }
  )
  return <RouterProvider router={router} />
}
