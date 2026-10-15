import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getDialogFields } from '@src/components/ModelingDialog/arguments'
import { useDialogSelection } from '@src/components/ModelingDialog/useDialogSelection'
import type { Command, CommandArgument } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

afterAll(() => {
  world.commandBarActor.stop()
  world.settingsActor.stop()
  world.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

function faces(...ids: string[]): Selections {
  return {
    graphSelections: ids.map((face_id) => ({
      entityRef: { type: 'face', face_id },
    })),
    otherSelections: [],
  }
}

it('updates only the chosen field and synchronizes the scene only for the active field', () => {
  const arg: CommandArgument<unknown> = {
    inputType: 'selection',
    required: false,
    selectionTypes: ['wall'],
    multiple: true,
  }
  const command: Command = {
    name: 'Test',
    groupId: 'modeling',
    scopes: GLOBAL_COMMAND_SCOPES,
    needsReview: false,
    onSubmit: () => {},
    args: { first: arg, second: arg },
  }
  const context = {
    ...world.commandBarActor.getSnapshot().context,
    selectedCommand: command,
  }
  const fields = getDialogFields(context)
  const send = vi.fn()
  const { result } = renderHook(() => {
    const [values, setValues] = useState<Record<string, unknown>>({
      second: faces('other'),
    })
    const [scene, setScene] = useState(faces('one', 'two'))
    return {
      ...useDialogSelection({
        context,
        fields,
        values,
        save: (name, value) =>
          setValues((previous) => ({ ...previous, [name]: value })),
        selectionRanges: scene,
        kclManager: world.kclManager,
        wasmPromise: world.kclManager.wasmInstancePromise,
        modelingSend: (event) => {
          send(event)
          if (
            event.type === 'Set selection' &&
            event.data.selectionType === 'completeSelection'
          )
            setScene(event.data.selection)
        },
      }),
      scene,
    }
  })

  act(() => result.current.select('second', arg))
  send.mockClear()
  act(() => result.current.update('first', faces('two')))
  expect(send).not.toHaveBeenCalled()
  expect(result.current.scene).toEqual(faces('other'))
  expect(result.current.draft.first).toEqual(faces('two'))

  act(() => result.current.select('first', arg))
  expect(result.current.scene).toEqual(faces('two'))
  act(() => result.current.update('first', faces()))
  expect(result.current.scene).toEqual(faces())
  act(() => result.current.select('second', arg))
  expect(result.current.scene).toEqual(faces('other'))
  act(() => result.current.select('first', arg))
  expect(result.current.scene).toEqual(faces())
})
