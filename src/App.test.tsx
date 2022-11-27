import React from 'react'
import { render, screen } from '@testing-library/react'
import App from './App'

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
  render(<App />)
  const linkElement = screen.getByText(/reset/i)
  expect(linkElement).toBeInTheDocument()
})
