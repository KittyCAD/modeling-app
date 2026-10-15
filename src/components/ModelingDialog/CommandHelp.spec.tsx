import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

it('shows the command description and configured-site docs link on demand', () => {
  const description = 'A description from the command.'
  render(<CommandHelp command={{ name: 'Extrude', description }} />)

  expect(screen.getByText(description)).not.toBeVisible()
  fireEvent.click(screen.getByText('Help'))
  expect(screen.getByText(description)).toBeVisible()
  expect(screen.getByRole('link', { name: 'KCL docs' })).toHaveAttribute(
    'href',
    withSiteBaseURL(
      `/docs/kcl-std/functions/${STD_LIB_COMMANDS.extrude.qualName.replaceAll('::', '-')}`
    )
  )
})

it('omits help when the command has no description or stdlib reference', () => {
  const { container } = render(
    <CommandHelp command={{ name: 'Unmapped command' }} />
  )
  expect(container).toBeEmptyDOMElement()
})
