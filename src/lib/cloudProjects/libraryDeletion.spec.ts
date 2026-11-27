import { createCloudLibraryDeleteCommand } from '@src/lib/cloudProjects/libraryDeletion'
import type { MachineManager } from '@src/lib/MachineManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }))

it.each([true, false])(
  'requires only confirmation when a library is already chosen (%s)',
  async (prefilled) => {
    const deleteLibrary = vi.fn(async () => {})
    const id = '7ec3e1ea-92c8-430e-b1c2-35bb26d64fb0'
    const command = createCloudLibraryDeleteCommand({
      enabled: () => true,
      libraries: () => [
        {
          id,
          name: 'Client designs',
          org_id: 'organization',
          can_manage: true,
          revision: 'revision',
        },
      ],
      projects: () => [],
      deleteLibrary,
    })
    const actor = createActor(commandBarMachine, {
      input: {
        commands: [command],
        wasmInstancePromise: Promise.resolve({} as ModuleType),
        machineManager: {} as MachineManager,
      },
    }).start()
    try {
      actor.send({
        type: 'Find and select command',
        data: {
          name: command.name,
          groupId: command.groupId,
          argDefaultValues: prefilled ? { library: id } : undefined,
        },
      })
      if (!prefilled) {
        await vi.waitFor(() =>
          expect(actor.getSnapshot().matches('Gathering arguments')).toBe(true)
        )
        actor.send({ type: 'Submit argument', data: { library: id } })
      }
      await vi.waitFor(() =>
        expect(actor.getSnapshot().matches('Review')).toBe(true)
      )
      const context = actor.getSnapshot().context
      expect(context.currentArgument).toBeUndefined()
      expect(
        typeof command.reviewMessage === 'function' &&
          command.reviewMessage(context)
      ).toBe(
        'Delete the empty cloud library "Client designs (Organization)"? This cannot be undone.'
      )
      expect(deleteLibrary).not.toHaveBeenCalled()
      actor.send({
        type: 'Submit command',
        output: { argumentsToSubmit: context.argumentsToSubmit },
      })
      await vi.waitFor(() =>
        expect(deleteLibrary).toHaveBeenCalledExactlyOnceWith(id, 'revision')
      )
    } finally {
      actor.stop()
    }
  }
)
