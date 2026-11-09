import '@src/lib/projectSession/next/testFeature'
import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Command } from '@src/lib/commandTypes'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { ModelingToolbar } from '@src/lib/modelingTools/ModelingToolbar'
import { createModelingTools } from '@src/lib/modelingTools/tools'
import type { ModelingTool } from '@src/lib/modelingTools/registry/contract'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest'

// Happy DOM lacks the native popover API used by the shared dropdown panel.
const popoverMethods = ['showPopover', 'hidePopover'] as const
const originalPopoverMethods = popoverMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
)
beforeAll(() => {
  for (const name of popoverMethods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: vi.fn(),
    })
})
afterAll(() => {
  popoverMethods.forEach((name, index) => {
    const original = originalPopoverMethods[index]
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

const registries: Registry[] = []
afterEach(() => {
  for (const registry of registries.splice(0)) registry[Symbol.dispose]()
})
function editor() {
  const registry = new Registry()
  registries.push(registry)
  registry.configure([editorsExtension])
  return registry.get(editorsService).createEditor()
}
const command = (name: string): Command => ({
  name,
  groupId: 'test-modeling',
  scopes: GLOBAL_COMMAND_SCOPES,
  needsReview: false,
  onSubmit() {},
})
const tool = (name: string): ModelingTool => ({
  id: name,
  command: { name, groupId: 'test-modeling' },
  group: 'Solids',
  icon: 'extrude',
})

it('opens a grouped tool with the clicked view’s latest command arguments', async () => {
  const send = vi.fn()
  const tools = createModelingTools(
    signal([tool('Extrude'), tool('Revolve')]),
    signal([command('Extrude'), command('Revolve')]),
    send
  )
  const binding = signal('original-execution')
  const first = tools.attach(
    editor(),
    () => undefined,
    () => ({ modelingTarget: binding.value })
  )
  tools.attach(
    editor(),
    () => undefined,
    () => ({ modelingTarget: 'another-editor' })
  )
  render(<ModelingToolbar tools={tools} target={first.target} />)
  fireEvent.click(screen.getByRole('button', { name: 'Solids: more tools' }))
  act(() => {
    binding.value = 'new-execution'
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Revolve' }))
  expect(send).toHaveBeenCalledWith({
    type: 'Find and select command',
    data: {
      name: 'Revolve',
      groupId: 'test-modeling',
      argDefaultValues: { modelingTarget: 'new-execution' },
    },
  })
})

it('updates availability and refuses invocation after its command, target, or contribution is withdrawn', () => {
  const send = vi.fn()
  const contributions = signal([tool('Extrude')])
  const commands = signal([command('Extrude')])
  const busy = signal<string | undefined>('Wait for execution')
  const tools = createModelingTools(contributions, commands, send)
  const attached = tools.attach(
    editor(),
    () => busy.value,
    () => ({})
  )
  render(<ModelingToolbar tools={tools} target={attached.target} />)
  expect(screen.getByRole('button', { name: 'Extrude' })).toBeDisabled()
  act(() => {
    busy.value = undefined
  })
  expect(screen.getByRole('button', { name: 'Extrude' })).toBeEnabled()
  act(() => {
    commands.value = []
  })
  expect(screen.getByRole('button', { name: 'Extrude' })).toBeDisabled()
  expect(tools.invoke('Extrude', attached.target)).toBeInstanceOf(Error)
  act(() => {
    commands.value = [command('Extrude')]
    attached.dispose()
  })
  expect(tools.invoke('Extrude', attached.target)).toBeInstanceOf(Error)
  act(() => {
    contributions.value = []
  })
  expect(
    screen.queryByRole('button', { name: 'Extrude' })
  ).not.toBeInTheDocument()
  expect(tools.invoke('Extrude', attached.target)).toBeInstanceOf(Error)
  expect(send).not.toHaveBeenCalled()
})
