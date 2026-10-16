import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import ModelingDialog from '@src/components/ModelingDialog/ModelingDialog'
import * as dialogArguments from '@src/components/ModelingDialog/arguments'
import type { Command } from '@src/lib/commandTypes'
import {
  GLOBAL_COMMAND_SCOPES,
  commandSystemService,
  type CommandSystemService,
} from '@src/registry/contracts/commands'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { commandsExtension } from '@src/registry/extensions/commands'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
const registry = new Registry()
let commands: CommandSystemService

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
  registry.configure([
    commandsExtension,
    defineRegistryItem({
      id: 'dialog-test-services',
      provides: [provideWasmPromise(Promise.resolve(world.instance))],
      providesServices: [
        provideService(machineManagerService, {
          manager: world.machineManager,
        }),
      ],
    }),
  ])
  commands = registry.get(commandSystemService)
})

afterEach(() => vi.restoreAllMocks())

afterAll(() => {
  registry[Symbol.dispose]()
  world.commandBarActor.stop()
  world.settingsActor.stop()
  world.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

function Harness() {
  useSignals()
  const session = commands.dialogSession.value
  const containerRef = useRef<HTMLDivElement>(null)
  const settings = getOnlySettingsFromContext(
    world.settingsActor.getSnapshot().context
  )
  return (
    <div ref={containerRef}>
      {session && (
        <ModelingDialog
          key={session.id}
          session={session}
          containerRef={containerRef}
          kclManager={world.kclManager}
          commands={commands}
          settings={{
            actor: world.settingsActor,
            current: signal(settings),
            send: (event) => world.settingsActor.send(event),
            get: () => settings,
            useSettings: () => settings,
          }}
          wasmPromise={Promise.resolve(world.instance)}
          selectionRanges={{ graphSelections: [], otherSelections: [] }}
          modelingSend={() => {}}
        />
      )}
    </div>
  )
}

it('keeps a failed draft, resets for another edit, and discards its pending submission', async () => {
  const onSubmit = vi.fn()
  let failReview = true
  const command = {
    name: 'Dialog test',
    groupId: 'modeling',
    scopes: GLOBAL_COMMAND_SCOPES,
    useModelingDialog: true,
    needsReview: true,
    reviewValidation: async () =>
      failReview ? new Error('The codemod could not execute.') : undefined,
    onSubmit,
    args: {
      name: { inputType: 'string', required: true },
      detail: {
        inputType: 'string',
        required: false,
        dialog: { advanced: true },
      },
    },
  } satisfies Command
  const actor = commands.actor
  actor.send({ type: 'Add commands', data: { commands: [command] } })
  const edit = (name: string) =>
    actor.send({
      type: 'Find and select command',
      data: {
        name: command.name,
        groupId: command.groupId,
        argDefaultValues: { name, nodeToEdit: name },
      },
    })
  edit('first')
  render(<Harness />)
  const name = await screen.findByRole('textbox', { name: 'Name *' })
  fireEvent.change(name, { target: { value: 'failed draft' } })
  fireEvent.click(screen.getByText('Advanced'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Detail' }), {
    target: { value: 'keep this' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await screen.findByRole('alert')
  expect(name).toHaveValue('failed draft')
  expect(screen.getByText('Advanced').parentElement).toHaveAttribute('open')
  expect(screen.getByRole('textbox', { name: 'Detail' })).toHaveValue(
    'keep this'
  )

  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const resolveArguments = dialogArguments.resolveArguments
  const resolving = vi
    .spyOn(dialogArguments, 'resolveArguments')
    .mockImplementationOnce(async (...args) => {
      await pending
      return resolveArguments(...args)
    })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(resolving).toHaveBeenCalledOnce()
  // Complete the previous submission while switching to the next edit.
  await act(async () => {
    edit('second')
    finish()
    await resolving.mock.results[0]?.value
    await Promise.resolve()
  })
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Name *' })).toHaveValue(
      'second'
    )
  )
  expect(screen.getByText('Advanced').parentElement).not.toHaveAttribute('open')

  expect(onSubmit).not.toHaveBeenCalled()
  expect(actor.getSnapshot().context.argumentsToSubmit.nodeToEdit).toBe(
    'second'
  )
  failReview = false
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: 'second',
      nodeToEdit: 'second',
      detail: undefined,
    })
  )
  expect(commands.dialogSession.peek()).toBeUndefined()
  act(() => edit('third'))
  expect(commands.dialogSession.peek()).toBeDefined()
  act(() => registry[Symbol.dispose]())
  expect(commands.dialogSession.peek()).toBeUndefined()
})
