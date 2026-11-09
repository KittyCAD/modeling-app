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
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

it('keeps document state live while a plugin is disabled and enabled through the public next API', async () => {
  const registry = new Registry()
  const document = service<{ readonly text: Signal<string>; edit(): void }>(
    'document'
  )
  const panels = new Facet('panels', (values: readonly string[]) => values)
  await registry.configure([
    {
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
    },
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
