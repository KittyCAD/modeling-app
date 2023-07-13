import { render, screen } from '@testing-library/react'
import { App } from './App'
import { BrowserRouter } from 'react-router-dom';

let listener: ((rect: any) => void) | undefined = undefined
;(global as any).ResizeObserver = class ResizeObserver {
  constructor(ls: ((rect: any) => void) | undefined) {
    listener = ls
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

test('renders learn react link', () => {
  render(<BrowserRouter>
    <App />
  </BrowserRouter>)
  const linkElement = screen.getByText(/Variables/i)
  expect(linkElement).toBeInTheDocument()
})
