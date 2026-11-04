import { FilePaneEmptyState } from '@src/components/FilePaneEmptyState'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('offers the open action and keeps its phrase steady across rerenders', () => {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99)
  const open = vi.fn()
  const { rerender } = render(<FilePaneEmptyState icon="code" onOpen={open} />)
  const phrase = screen.getByRole('heading').textContent
  fireEvent.click(screen.getByRole('button', { name: 'Open a file' }))
  expect(open).toHaveBeenCalledOnce()
  rerender(<FilePaneEmptyState icon="code" onOpen={open} />)
  expect(screen.getByRole('heading')).toHaveTextContent(phrase)
})

it('can show an invitation without an unavailable open action', () => {
  render(<FilePaneEmptyState icon="code" />)
  expect(screen.getByRole('heading')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
