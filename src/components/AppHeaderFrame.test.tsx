import { AppHeaderFrame } from '@src/components/AppHeaderFrame'
import {
  type AppHeaderItemProps,
  appHeaderStartItemsFacet,
  appHeaderEndItemsFacet,
} from '@src/registry/contracts/appHeader'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { Registry, contribute, slot } from 'plankton'
import { afterEach, expect, it, vi } from 'vitest'

let registry: Registry
vi.mock('@src/lib/boot', () => ({ useApp: () => ({ registry }) }))
afterEach(async () => {
  cleanup()
  await registry.dispose()
})

it('updates both header zones when extensions are installed and removed', async () => {
  registry = new Registry()
  const contributions = slot([])
  await registry.configure([contributions])
  render(<AppHeaderFrame context={{ type: 'home' }} />)
  const start = within(screen.getByTestId('app-header-start'))
  const end = within(screen.getByTestId('app-header-end'))
  const StartItem = ({ context }: AppHeaderItemProps) => (
    <span>{context.type} navigation</span>
  )
  const EndItem = () => <button>Account</button>
  await act(async () => {
    await registry.replace(contributions, [
      contribute(appHeaderStartItemsFacet, () => ({
        id: 'navigation',
        Component: StartItem,
      })),
      contribute(appHeaderEndItemsFacet, () => ({
        id: 'account',
        Component: EndItem,
      })),
    ])
  })
  expect(start.getByText('home navigation')).toBeInTheDocument()
  expect(end.getByRole('button', { name: 'Account' })).toBeInTheDocument()
  expect(
    start.queryByRole('button', { name: 'Account' })
  ).not.toBeInTheDocument()
  await act(async () => {
    await registry.replace(contributions, [])
  })
  expect(start.queryByText('home navigation')).not.toBeInTheDocument()
  expect(end.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument()
})
