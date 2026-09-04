import type { SelectionCommandArgument } from '@src/components/ModelingDialog/ModelingDialog.logic'
import type { Command } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectionRanges: Selections = {
    graphSelections: [],
    otherSelections: [],
  }
  return {
    commands: { send: vi.fn() },
    wasmPromise: Promise.resolve({}),
    kclManager: {
      artifactGraph: new Map(),
      setSelectionFilterToDefault: vi.fn(),
    },
    modeling: {
      context: { selectionRanges },
      send: vi.fn(),
    },
    markArgumentDirty: vi.fn(),
  }
})

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: mocks.commands,
    wasmPromise: mocks.wasmPromise,
  }),
  useSingletons: () => ({ kclManager: mocks.kclManager }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => mocks.modeling,
}))
vi.mock('@src/lang/std/artifactGraph', () => ({
  coerceSelectionsToBody: vi.fn(),
}))
vi.mock('@src/lib/selections', () => ({
  canSubmitSelectionArg: vi.fn(),
  getSelectionCountByType: vi.fn(),
  getSelectionTypeDisplayText: vi.fn(),
  handleSelectionBatch: vi.fn(),
}))
vi.mock('@src/lib/kclHelpers', () => ({ stringToKclExpression: vi.fn() }))

import { useModelingDialogSelection } from '@src/components/ModelingDialog/useModelingDialogSelection'

function selectionAt(...offsets: number[]): Selections {
  return {
    graphSelections: offsets.map((offset) => ({
      codeRef: { range: [offset, offset + 5, 0], pathToNode: [] },
    })),
    otherSelections: [],
  }
}

const selectionArgument: SelectionCommandArgument = {
  inputType: 'selection',
  selectionTypes: ['segment'],
  multiple: true,
  required: false,
}

const command: Command = {
  name: 'sweep',
  groupId: 'modeling',
  needsReview: false,
  scopes: ['mode-modeling'],
  onSubmit: vi.fn(),
  args: {
    profiles: selectionArgument,
    path: selectionArgument,
  },
}

describe('modeling dialog collector actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modeling.context.selectionRanges = selectionAt(0)
    mocks.modeling.send.mockImplementation((event) => {
      mocks.modeling.context.selectionRanges = event.data.selection
    })
  })

  it.each(['remove', 'move', 'clear'] as const)(
    '%s activates an inactive collector and preserves both collectors when switching back',
    (action) => {
      const profiles = selectionAt(0)
      const path = selectionAt(10, 20)
      const commandBarContext = {
        selectedCommand: command,
        argumentsToSubmit: {},
      } as CommandBarContext
      const { result } = renderHook(() => {
        const [draftValues, setDraftValues] = useState<Record<string, unknown>>(
          {
            path,
          }
        )
        return {
          ...useModelingDialogSelection({
            commandBarContext,
            draftValues,
            setDraftValues,
            markArgumentDirty: mocks.markArgumentDirty,
          }),
          draftValues,
        }
      })

      expect(result.current.activeSelectionArgName).toBe('profiles')
      act(() => {
        if (action === 'remove') {
          result.current.removeSceneSelection(
            'path',
            'graphSelections',
            0,
            path
          )
        } else if (action === 'move') {
          result.current.moveSceneSelection(
            'path',
            'graphSelections',
            0,
            'down',
            path
          )
        } else {
          result.current.clearSceneSelection('path')
        }
      })

      const changedPath =
        action === 'remove'
          ? selectionAt(20)
          : action === 'move'
            ? selectionAt(20, 10)
            : selectionAt()
      expect(result.current.activeSelectionArgName).toBe('path')
      expect(result.current.selectionRanges).toEqual(changedPath)
      expect(result.current.draftValues.profiles).toEqual(profiles)

      act(() => {
        result.current.startSelectingArgument('profiles', selectionArgument)
      })
      expect(result.current.selectionRanges).toEqual(profiles)
      act(() => {
        result.current.startSelectingArgument('path', selectionArgument)
      })
      expect(result.current.selectionRanges).toEqual(changedPath)
    }
  )
})
