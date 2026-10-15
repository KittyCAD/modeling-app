import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

vi.mock('@src/components/Tooltip', () => ({ default: () => null }))

it('shows the command description and configured-site docs link on demand', async () => {
  const user = userEvent.setup()
  const description = 'A description from the command.'
  render(<CommandHelp command={{ name: 'Extrude', description }} />)

  const help = screen.getByRole('button', { name: 'Command help' })
  expect(screen.queryByText(description)).not.toBeInTheDocument()
  await user.click(help)
  expect(screen.getByText(description)).toBeVisible()
  expect(screen.getByRole('link', { name: 'KCL docs' })).toHaveAttribute(
    'href',
    withSiteBaseURL(
      `/docs/kcl-std/functions/${STD_LIB_COMMANDS.extrude.qualName.replaceAll('::', '-')}`
    )
  )
  await user.keyboard('{Escape}')
  expect(screen.queryByText(description)).not.toBeInTheDocument()
  expect(help).toHaveFocus()
})

it('omits help when the command has no description or stdlib reference', () => {
  const { container } = render(
    <CommandHelp command={{ name: 'Unmapped command' }} />
  )
  expect(container).toBeEmptyDOMElement()
})
