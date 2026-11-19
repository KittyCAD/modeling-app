import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/factory/registry/projects', () => ({
  captureFactoryProject: vi.fn(),
  listFactoryEntrypoints: vi.fn(),
}))
vi.mock('@src/lib/kcClient', () => ({ createKCClient: vi.fn() }))
vi.mock('@src/lib/billing', () => ({ billingService: {} }))

import { FactoryFilePicker, PartFields } from '@src/lib/factory/FactoryButton'
import type { FactoryPart } from '@src/lib/factory/jobs'

it('keeps multiple selected entry points when searching a nested filename', () => {
  function Picker() {
    const [selected, setSelected] = useState<string[]>([])
    return (
      <FactoryFilePicker
        paths={['main.kcl', 'parts/bracket.kcl', 'parts/hinge.kcl']}
        selected={selected}
        onChange={setSelected}
      />
    )
  }
  render(<Picker />)
  fireEvent.click(screen.getByRole('option', { name: 'main.kcl' }))
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'bracket' },
  })
  fireEvent.click(screen.getByRole('option', { name: 'parts/bracket.kcl' }))
  expect(
    screen.getByText('2 selected: main.kcl, parts/bracket.kcl')
  ).toBeVisible()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect(screen.getByRole('option', { name: 'main.kcl' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(
    screen.getByRole('option', { name: 'parts/bracket.kcl' })
  ).toHaveAttribute('aria-selected', 'true')
})

it('edits one part without changing another part specifications', () => {
  function Parts() {
    const [parts, setParts] = useState<FactoryPart[]>(
      ['main.kcl', 'part.kcl'].map((entrypoint) => ({
        entrypoint,
        material: 'Aluminum',
        finish: 'Anodized',
        quantity: 1,
        notes: '',
      }))
    )
    return (
      <>
        {parts.map((part, index) => (
          <PartFields
            key={part.entrypoint}
            part={part}
            catalog={{
              materials: ['Aluminum', 'Steel'],
              finishes: ['Anodized', 'As machined'],
            }}
            onChange={(next) =>
              setParts(
                parts.map((value, position) =>
                  position === index ? next : value
                )
              )
            }
          />
        ))}
      </>
    )
  }
  render(<Parts />)
  fireEvent.change(screen.getAllByLabelText('Quantity')[1], {
    target: { value: '25' },
  })
  fireEvent.change(screen.getAllByLabelText('material')[1], {
    target: { value: 'Steel' },
  })
  expect(screen.getAllByLabelText('Quantity')[0]).toHaveValue(1)
  expect(screen.getAllByLabelText('Quantity')[1]).toHaveValue(25)
  expect(screen.getAllByLabelText('material')[0]).toHaveValue('Aluminum')
  expect(screen.getAllByLabelText('material')[1]).toHaveValue('Steel')
})
