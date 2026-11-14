import { factory } from './algebra'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  contribute,
  createPlugin,
  Facet,
  plugins,
  provide,
  Registry,
  type Signal,
  service,
} from '@kittycad/registry/next'
import { expect, it } from 'vitest'

it('tracks optional services directly as providers appear, change, and disappear', async () => {
  const registry = new Registry()
  const session = service<{ readonly text: Signal<string> }>('session')
  const first = signal('First document')
  const second = signal('Second document')
  function CurrentDocument() {
    useSignals()
    const model = registry.optional(session)
    return (
      <output aria-label="Current document">
        {model?.text.value ?? 'No document'}
      </output>
    )
  }
  const view = render(<CurrentDocument />)
  const output = screen.getByLabelText('Current document')
  try {
    expect(output).toHaveTextContent('No document')
    await act(async () => {
      await registry.configure([provide(session, { text: first })])
    })
    expect(output).toHaveTextContent('First document')
    act(() => {
      first.value = 'Edited document'
    })
    expect(output).toHaveTextContent('Edited document')
    await act(async () => {
      await registry.configure([provide(session, { text: second })])
    })
    expect(output).toHaveTextContent('Second document')
    act(() => {
      first.value = 'Stale document'
    })
    expect(output).toHaveTextContent('Second document')
    await act(async () => {
      await registry.configure([])
    })
    expect(output).toHaveTextContent('No document')
  } finally {
    view.unmount()
    await registry.dispose()
  }
})

it('keeps document state live while a plugin is disabled and enabled through the public Plankton API', async () => {
  const registry = new Registry()
  const document = service<{ readonly text: Signal<string>; edit(): void }>(
    'document'
  )
  const panels = new Facet('panels', (values: readonly string[]) => values)
  await registry.configure([
    factory({
      key: 'document-owner',
      create: () => {
        const text = signal('original')
        return {
          items: [
            provide(document, {
              text,
              edit: () => {
                text.value = 'edited'
              },
            }),
          ],
        }
      },
    }),
    createPlugin({
      id: 'search',
      title: 'Search',
      description: 'Search panel',
      items: [contribute(panels, () => 'Search panel')],
    }),
  ])
  const original = registry.required(document)
  function Workspace() {
    useSignals()
    const model = registry.required(document)
    return (
      <>
        <output aria-label="Document">{model.text.value}</output>
        <button onClick={() => model.edit()}>Edit</button>
        <div>{registry.observe(panels).value.join(', ') || 'No panels'}</div>
      </>
    )
  }
  const view = render(<Workspace />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(await screen.findByText('edited')).toBeInTheDocument()
  const controller = registry.required(registry.get(plugins)[0].service)
  await act(async () => {
    await controller.disable()
  })
  expect(screen.getByText('No panels')).toBeInTheDocument()
  expect(screen.getByLabelText('Document')).toHaveTextContent('edited')
  expect(registry.required(document)).toBe(original)
  await act(async () => {
    await controller.enable()
  })
  expect(screen.getByText('Search panel')).toBeInTheDocument()
  expect(screen.getByLabelText('Document')).toHaveTextContent('edited')
  view.unmount()
  await registry.dispose()
})
