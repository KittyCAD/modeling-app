import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSelector } from '@xstate/react'
import { useRef } from 'react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import ModelingDialog from '@src/components/ModelingDialog/ModelingDialog'
import * as dialogArguments from '@src/components/ModelingDialog/arguments'
import { useDialogReset } from '@src/components/ModelingDialog/useDialogReset'
import type { Command } from '@src/lib/commandTypes'
import { defaultLayoutConfig } from '@src/lib/layout'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

afterEach(() => vi.restoreAllMocks())

afterAll(() => {
  world.commandBarActor.stop()
  world.settingsActor.stop()
  world.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

function Harness() {
  const actor = world.commandBarActor
  const state = useSelector(actor, (snapshot) => snapshot)
  const resetting = useDialogReset(actor)
  const containerRef = useRef<HTMLDivElement>(null)
  const settings = getOnlySettingsFromContext(
    world.settingsActor.getSnapshot().context
  )
  return (
    <div ref={containerRef}>
      {!resetting && !state.matches('Closed') && (
        <ModelingDialog
          containerRef={containerRef}
          kclManager={world.kclManager}
          commands={{
            actor,
            send: (event) => actor.send(event),
            useState: () => useSelector(actor, (snapshot) => snapshot),
          }}
          settings={{
            actor: world.settingsActor,
            current: signal(settings),
            send: (event) => world.settingsActor.send(event),
            get: () => settings,
            useSettings: () => settings,
          }}
          wasmPromise={Promise.resolve(world.instance)}
          layout={{
            signal: signal(defaultLayoutConfig),
            get: () => defaultLayoutConfig,
            set: () => {},
            reset: () => {},
            applyContributions: () => [],
          }}
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
  const actor = world.commandBarActor
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
})
