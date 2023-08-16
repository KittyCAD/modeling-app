import { render, screen } from '@testing-library/react'
import { App } from './App'
import { describe, test, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

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
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )
    const linkElement = screen.getByText(/Variables/i)
    expect(linkElement).toBeInTheDocument()

    vi.restoreAllMocks()
  })
})
