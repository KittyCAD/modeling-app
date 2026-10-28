import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { Command } from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})
afterAll(() => {
  world?.commandBarActor.stop()
  world?.settingsActor.stop()
})

const viewportEdge: Selections = {
  graphSelections: [
    {
      entityRef: { type: 'edge', side_faces: ['wall', 'cap'] },
      engineTopologyFallback: { parentId: 'body', primitiveIndex: 19 },
    },
  ],
  otherSelections: [],
}
const codeSegment: Selections = {
  graphSelections: [
    {
      entityRef: {
        type: 'segment',
        segment_id: 'segment',
        path_id: 'path',
      },
    },
  ],
  otherSelections: [],
}

// Run the real validation actor so payload wrapping and command-bar transitions
// are covered without opening a browser or connecting to an engine.
describe.each(['Fillet', 'Chamfer', 'GDT Straightness'] as const)(
  '%s selection validation',
  (commandName) => {
    function setup() {
      const config = modelingMachineCommandConfig[commandName]
      if (!config || isArray(config)) throw new Error('Missing command config')
      const selectionKey =
        commandName === 'GDT Straightness' ? 'objects' : 'selection'
      const args = config.args
      const arg =
        args && 'objects' in args
          ? args.objects
          : args && 'selection' in args
            ? args.selection
            : undefined
      if (!arg || arg.inputType !== 'selection' || !arg.validation)
        throw new Error('Missing selection validation')
      const modelingActor = createActor(
        createMachine({
          context: { kclManager: world.kclManager },
        })
      ).start()
      const command: Command = {
        name: commandName,
        groupId: 'modeling',
        scopes: GLOBAL_COMMAND_SCOPES,
        needsReview: false,
        machineActor: modelingActor,
        onSubmit: vi.fn(),
        args: {
          [selectionKey]: {
            inputType: 'selection',
            required: true,
            multiple: true,
            selectionTypes: arg.selectionTypes,
            validation: arg.validation,
          },
          next: { inputType: 'string', required: true },
        },
      }
      const actor = createActor(commandBarMachine, {
        input: {
          commands: [command],
          wasmInstancePromise: Promise.resolve(world.instance),
          machineManager: world.machineManager,
        },
      }).start()
      actor.send({ type: 'Open' })
      actor.send({ type: 'Select command', data: { command } })
      const selectionArg = command.args?.[selectionKey]
      if (
        !selectionArg ||
        selectionArg.inputType !== 'selection' ||
        !selectionArg.validation
      )
        throw new Error('Missing built validation')
      return {
        actor,
        command,
        modelingActor,
        selectionKey,
        validation: selectionArg.validation,
      }
    }

    it.each([
      { name: 'viewport edge', selection: viewportEdge, accepted: true },
      { name: 'code segment', selection: codeSegment, accepted: false },
      {
        name: 'primitive viewport edge',
        selection: {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: 'edge',
              parentEntityId: 'body',
              primitiveType: 'edge',
              primitiveIndex: 19,
            },
          ],
        } satisfies Selections,
        accepted: true,
      },
    ])(
      'handles a wrapped $name submission',
      async ({ selection, accepted }) => {
        const { actor, modelingActor, selectionKey } = setup()
        try {
          actor.send({
            type: 'Submit argument',
            data: { [selectionKey]: selection },
          })
          await vi.waitFor(() => {
            expect(
              actor
                .getSnapshot()
                .matches({ 'Gathering arguments': 'Awaiting input' })
            ).toBe(true)
            expect(actor.getSnapshot().context.currentArgument?.name).toBe(
              accepted ? 'next' : selectionKey
            )
          })
          expect(
            actor.getSnapshot().context.argumentsToSubmit[selectionKey]
          ).toEqual(accepted ? selection : undefined)
        } finally {
          actor.stop()
          modelingActor.stop()
        }
      }
    )

    it('also accepts raw dialog values and ignores display-only edit selections', async () => {
      const { actor, modelingActor, validation, selectionKey } = setup()
      try {
        const context = actor.getSnapshot().context
        // Same context shape as the modeling actor, with the real manager.
        const machineContext = modelingActor.getSnapshot().context
        expect(
          await validation({ data: viewportEdge, context, machineContext })
        ).toBe(true)
        expect(
          await validation({ data: codeSegment, context, machineContext })
        ).toBe('Sketch segments cannot be used as solid-edge selections.')
        const editContext = {
          ...context,
          argumentsToSubmit: {
            nodeToEdit: [
              ['body', ''],
              [0, 'index'],
            ],
          },
        }
        expect(
          await validation({
            data: codeSegment,
            context: editContext,
            machineContext,
          })
        ).toBe(true)
        expect(
          await validation({
            data: { [selectionKey]: codeSegment },
            context: editContext,
            machineContext,
          })
        ).toBe(true)
      } finally {
        actor.stop()
        modelingActor.stop()
      }
    })
  }
)
