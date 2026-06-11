import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NoExecutingFileEmptyState } from '@src/components/NoExecutingFileEmptyState'

describe('NoExecutingFileEmptyState', () => {
  it('shows a set executing file action', () => {
    render(<NoExecutingFileEmptyState />)

    expect(screen.getByText('No executing file')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Set executing file' })
    ).toBeInTheDocument()
  })
})
