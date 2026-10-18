import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ArgumentHelp } from '@src/components/ModelingDialog/ArgumentHelp'

vi.mock('@src/components/Tooltip', () => ({ default: () => null }))

it('shows formatted argument help on demand and dismisses it with Escape', async () => {
  const user = userEvent.setup()
  render(<ArgumentHelp label="Length" text="Use **millimeters**." />)

  const help = screen.getByRole('button', { name: 'Help for Length' })
  expect(screen.queryByText('millimeters')).not.toBeInTheDocument()
  await user.click(help)
  expect(screen.getByText('millimeters', { selector: 'strong' })).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByText('millimeters')).not.toBeInTheDocument()
  expect(help).toHaveFocus()
})
