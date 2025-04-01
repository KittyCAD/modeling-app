import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActionButton } from './ActionButton'

describe('ActionButton tests', () => {
  it('ActionButton with no iconStart or iconEnd should have even left and right padding', () => {
    render(<ActionButton Element="button">No icons</ActionButton>)
    expect(screen.getByRole('button')).toHaveClass('px-2')
  })

  it('ActionButton with iconStart should have no padding on the left', () => {
    render(
      <ActionButton Element="button" iconStart={{ icon: 'trash' }}>
        Start icon only
      </ActionButton>
    )
    expect(screen.getByRole('button')).toHaveClass('pr-2')
  })

  it('ActionButton with iconEnd should have no padding on the right', () => {
    render(
      <ActionButton Element="button" iconEnd={{ icon: 'trash' }}>
        End icon only
      </ActionButton>
    )
    expect(screen.getByRole('button')).toHaveClass('pl-2')
  })

  it('ActionButton with both icons should have no padding on either side', () => {
    render(
      <ActionButton
        Element="button"
        iconStart={{ icon: 'trash' }}
        iconEnd={{ icon: 'trash' }}
      >
        Both icons
      </ActionButton>
    )
    expect(screen.getByRole('button')).not.toHaveClass('px-2')
    expect(screen.getByRole('button')).toHaveClass('px-0')
  })
})
