import { render, screen } from '@testing-library/react'
import { App } from './App'
import { describe, test, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { GlobalStateProvider } from './components/GlobalStateProvider'
import CommandBarProvider from 'components/CommandBar'

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
        useParams: () => ({ id: 'new' }),
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
  // wrap in router and xState context
  return (
    <BrowserRouter>
      <CommandBarProvider>
        <GlobalStateProvider>{children}</GlobalStateProvider>
      </CommandBarProvider>
    </BrowserRouter>
  )
}
