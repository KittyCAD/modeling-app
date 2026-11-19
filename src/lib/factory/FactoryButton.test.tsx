import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/kcClient', () => ({ createKCClient: vi.fn() }))

import {
  FactoryButton,
  FactoryFilePicker,
  PartFields,
} from '@src/lib/factory/FactoryButton'
import { createFactoryWorkspace, type FactoryPart } from '@src/lib/factory/jobs'
import type { FactoryFormContext } from '@src/lib/factory/types'

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
  fireEvent.change(screen.getAllByLabelText('Material')[1], {
    target: { value: 'Steel' },
  })
  expect(screen.getAllByLabelText('Quantity')[0]).toHaveValue(1)
  expect(screen.getAllByLabelText('Quantity')[1]).toHaveValue(25)
  expect(screen.getAllByLabelText('Material')[0]).toHaveValue('Aluminum')
  expect(screen.getAllByLabelText('Material')[1]).toHaveValue('Steel')
})

it('corrects a rejected part without repeating successful jobs, then revises a job and starts another form', async () => {
  const workspace = createFactoryWorkspace()
  const capture = vi.fn<FactoryFormContext['capture']>(async () => ({
    files: [
      { relativePath: 'main.kcl', data: new Uint8Array([1]) },
      { relativePath: 'parts/bracket.kcl', data: new Uint8Array([2]) },
    ],
  }))
  const create = vi.fn<FactoryFormContext['requests']['create']>(
    async (part) =>
      part.entrypoint === 'parts/bracket.kcl' && part.quantity === 12
        ? {
            ok: false,
            uncertain: false,
            message: 'Adjust the bracket quantity.',
          }
        : {
            ok: true,
            id: part.entrypoint === 'main.kcl' ? 'job-one' : 'job-two',
            status: 'new',
          }
  )
  const revise = vi.fn<FactoryFormContext['requests']['revise']>(
    async (job) => ({ ok: true, id: job.id, status: 'quoting' })
  )
  const context: FactoryFormContext = {
    signedIn: true,
    ready: true,
    local: true,
    isCurrent: () => true,
    load: async () => ({
      paths: ['main.kcl', 'parts/bracket.kcl'],
      catalog: {
        materials: ['Aluminum', 'Steel'],
        finishes: ['Anodized', 'As machined'],
        addresses: [],
        shipping: {
          name: 'Recipient',
          company: '',
          phone: '202-555-0100',
          street1: '123 Example Street',
          street2: '',
          city: 'Seattle',
          state: 'WA',
          postal_code: '98101',
          country: 'US',
          is_expedited: false,
        },
      },
    }),
    capture,
    saveDelivery: vi.fn(async () => ({
      shipping_address_revision_id: 'shared-revision',
      is_expedited: false,
    })),
    requests: { create, revise },
  }
  render(<FactoryButton context={context} workspace={workspace} />)
  fireEvent.click(screen.getByRole('button', { name: 'Submit to Factory' }))
  fireEvent.click(await screen.findByRole('option', { name: 'main.kcl' }))
  fireEvent.click(screen.getByRole('option', { name: 'parts/bracket.kcl' }))
  expect(screen.getByRole('note')).toHaveTextContent(
    'duplicate this project into a cloud library'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  for (const input of screen.getAllByLabelText('Material'))
    fireEvent.change(input, { target: { value: 'Aluminum' } })
  for (const input of screen.getAllByLabelText('Finish'))
    fireEvent.change(input, { target: { value: 'Anodized' } })
  fireEvent.change(screen.getAllByLabelText('Quantity')[1], {
    target: { value: '12' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByLabelText('Recipient')).toHaveValue('Recipient')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('12 x Aluminum, Anodized')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Submit 2 Jobs' }))
  await screen.findByRole('button', { name: 'Submit to Factory (1)' })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Adjust the bracket quantity.'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByLabelText('Recipient')).toHaveValue('Recipient')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  const remainingPart = screen.getByRole('group', { name: 'parts/bracket.kcl' })
  fireEvent.change(within(remainingPart).getByLabelText('Quantity'), {
    target: { value: '5' },
  })
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit 1 Job' }))
  await screen.findByRole('button', { name: 'Submit to Factory (2)' })
  expect(capture).toHaveBeenCalledTimes(1)
  expect(context.saveDelivery).toHaveBeenCalledTimes(1)
  expect(
    create.mock.calls.map(([part]) => [part.entrypoint, part.quantity])
  ).toEqual([
    ['main.kcl', 1],
    ['parts/bracket.kcl', 12],
    ['parts/bracket.kcl', 5],
  ])
  const jobs = screen.getByRole('region', { name: 'Submitted Factory jobs' })
  const firstSummary = within(jobs).getByText('main.kcl', {
    exact: false,
    selector: 'summary',
  })
  fireEvent.click(firstSummary)
  const editor = firstSummary.parentElement!
  fireEvent.change(within(editor).getByLabelText('Quantity'), {
    target: { value: '7' },
  })
  fireEvent.click(
    within(editor).getByRole('button', { name: 'Submit Revision' })
  )
  await waitFor(() => expect(revise).toHaveBeenCalledTimes(1))
  expect(revise.mock.calls[0][0].id).toBe('job-one')
  expect(revise.mock.calls[0][1].quantity).toBe(7)
  expect(
    within(editor).getByRole('link', { name: 'View job on zoo.dev' })
  ).toHaveAttribute('href', expect.stringContaining('job=job-one'))
  await within(editor).findByText('Revision submitted.')
  fireEvent.click(screen.getByRole('button', { name: 'Add Job' }))
  expect(
    screen.getByRole('combobox', { name: 'Entry point files' })
  ).toHaveValue('')
  expect(screen.getByText('0 selected')).toBeVisible()
})
