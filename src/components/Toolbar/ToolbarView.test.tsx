import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  ToolbarView,
  type ToolbarViewItem,
} from '@src/components/Toolbar/ToolbarView'

function action(title: string): ToolbarViewItem {
  return {
    id: title.toLowerCase(),
    title,
    description: `Use ${title} on the selected profiles.`,
    status: 'available',
    icon: 'extrude',
    links: [
      {
        label: 'Documentation',
        url: 'https://zoo.dev/docs/kcl-std/functions/std-sketch-extrude',
      },
    ],
    onClick: vi.fn(),
  }
}

it('keeps active and disabled states, modifier clicks, and rich command help in the shared toolbar', () => {
  const extrude = { ...action('Extrude'), isActive: true }
  const loft = { ...action('Loft'), disabled: true }
  render(
    <ToolbarView items={[extrude, loft]} mode="modeling" platform="linux" />
  )
  const button = screen.getByRole('button', { name: 'Extrude' })
  expect(button).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(button, { ctrlKey: true })
  expect(extrude.onClick).toHaveBeenCalledWith(
    expect.objectContaining({ ctrlKey: true })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Loft' }))
  expect(loft.onClick).not.toHaveBeenCalled()
  fireEvent.mouseOver(button)
  expect(
    screen.getByText('Use Extrude on the selected profiles.')
  ).toBeInTheDocument()
  expect(
    screen.getAllByRole('link', { name: /Open Documentation/, hidden: true })[0]
  ).toHaveAttribute('href', extrude.links[0].url)
})

it('retains split-button choices so the selected command can be invoked again', () => {
  const extrude = action('Extrude'),
    loft = action('Loft')
  render(
    <ToolbarView
      items={[{ id: 'Solids', array: [extrude, loft] }]}
      mode="modeling"
      platform="linux"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /Solids: open menu/ }))
  fireEvent.click(screen.getByRole('button', { name: /Loft/ }))
  expect(loft.onClick).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Loft' }))
  expect(loft.onClick).toHaveBeenCalledTimes(2)
  expect(extrude.onClick).not.toHaveBeenCalled()
})
