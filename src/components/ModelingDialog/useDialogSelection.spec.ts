import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { SelectionArgument } from '@src/components/ModelingDialog/arguments'
import { useDialogSelection } from '@src/components/ModelingDialog/useDialogSelection'
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

function faceSelection(entityId: string): Selections {
  return {
    graphSelections: [],
    otherSelections: [
      {
        type: 'enginePrimitive',
        entityId,
        primitiveType: 'face',
        primitiveIndex: 0,
      },
    ],
  }
}

it('clears the active collector and keeps other drafts when switching fields', () => {
  const first = faceSelection('first')
  const second = faceSelection('second')
  const arg = {
    inputType: 'selection',
    selectionTypes: ['enginePrimitiveFace'],
    multiple: true,
    required: false,
  } satisfies SelectionArgument
  const DialogLogicWithTwoSelectionFields = () => {
    const [values, setValues] = useState<Record<string, unknown>>({
      first,
      second,
    })
    const [selectionRanges, setSelectionRanges] = useState(first)
    return useDialogSelection({
      context: world.commandBarActor.getSnapshot().context,
      fields: [
        { name: 'first', arg, required: false },
        { name: 'second', arg, required: false },
      ],
      values,
      save: (name, value) =>
        setValues((previous) => ({ ...previous, [name]: value })),
      kclManager: world.kclManager,
      wasmPromise: world.kclManager.wasmInstancePromise,
      selectionRanges,
      modelingSend: (event) => {
        if (
          event.type === 'Set selection' &&
          event.data.selectionType === 'completeSelection'
        )
          setSelectionRanges(event.data.selection)
      },
    })
  }
  
  const { result } = renderHook(DialogLogicWithTwoSelectionFields)

  act(() => result.current.select('second', arg))
  expect(result.current.selectionRanges).toEqual(second)
  act(() => result.current.clear())
  expect(result.current.selectionRanges).toEqual({
    graphSelections: [],
    otherSelections: [],
  })
  expect(result.current.draft.second).toBeUndefined()
  expect(result.current.draft.first).toEqual(first)

  act(() => result.current.select('first', arg))
  expect(result.current.selectionRanges).toEqual(first)
  act(() => result.current.select('second', arg))
  expect(result.current.selectionRanges).toEqual({
    graphSelections: [],
    otherSelections: [],
  })
  expect(result.current.draft.second).toBeUndefined()
})
