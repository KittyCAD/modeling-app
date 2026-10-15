import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SelectionReference } from '@src/lib/selections'
import type {
  EnginePrimitiveSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'

const mocks = vi.hoisted(() => {
  const unresolvedFace = {
    type: 'enginePrimitive' as const,
    entityId: 'unresolved-face',
    parentEntityId: 'body',
    primitiveIndex: 1,
    primitiveType: 'face' as const,
  }
  const wasmInstancePromise = Promise.resolve({})

  return {
    getSelectionReferences: vi.fn(),
    removeReferenceFromSelections:
      vi.fn<
        (selections: Selections, reference: SelectionReference) => Selections
      >(),
    send: vi.fn(),
    selectionRanges: {
      graphSelections: [],
      otherSelections: [unresolvedFace],
    },
    unresolvedFace,
    wasmInstancePromise,
    kclManager: {
      artifactGraph: new Map(),
      engineCommandManager: {},
      engineSceneGenerationSignal: { value: 0 },
      wasmInstancePromise,
    },
  }
})

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: () => null,
}))

vi.mock('@src/components/Tooltip', () => ({
  default: () => null,
}))

vi.mock('@src/components/ToolbarDropdownPanel', () => ({
  ToolbarDropdownPanel: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    context: { selectionRanges: mocks.selectionRanges },
    send: mocks.send,
  }),
}))

vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({
    kclManager: mocks.kclManager,
  }),
}))

vi.mock('@src/lib/selections', () => ({
  getSelectionReferences: mocks.getSelectionReferences,
  getSelectionTypeDisplayText: () => '1 face',
  isDefaultPlaneSelection: () => false,
  isEnginePrimitiveSelection: (selection: { type?: string }) =>
    selection.type === 'enginePrimitive',
  removeReferenceFromSelections: mocks.removeReferenceFromSelections,
}))

import { SelectionReferencesList } from '@src/components/SelectionReferencesList'
import { SelectionReferencesPopover } from '@src/components/SelectionReferencesPopover'
import { useSingletons } from '@src/lib/boot'

describe('SelectionReferencesPopover', () => {
  beforeEach(() => {
    mocks.getSelectionReferences.mockReset()
    mocks.getSelectionReferences.mockResolvedValue([])
    mocks.removeReferenceFromSelections.mockReset()
    mocks.send.mockReset()
  })

  test.each([
    { scenario: 'no KCL reference is available', error: undefined },
    {
      scenario: 'reference lookup fails',
      error: new Error('Unable to resolve selection references.'),
    },
  ])('keeps individual removal available when $scenario', async ({ error }) => {
    if (error) mocks.getSelectionReferences.mockRejectedValue(error)
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading Wasm...</div>}>
          <SelectionReferencesPopover />
        </Suspense>
      )
      await mocks.wasmInstancePromise
    })

    if (error) await screen.findByText(error.message)
    const removeButton = await screen.findByRole('button', {
      name: 'Remove unresolved face from selection',
    })
    expect(screen.getByText('Unresolved face')).toBeInTheDocument()

    fireEvent.click(removeButton)

    expect(mocks.send).toHaveBeenCalledWith({
      type: 'Set selection',
      data: {
        selectionType: 'completeSelection',
        selection: {
          graphSelections: [],
          otherSelections: [],
        },
      },
    })
  })

  test('lists individual edges with details and removal in dialogs', async () => {
    const first: EnginePrimitiveSelection = {
      ...mocks.unresolvedFace,
      primitiveType: 'edge',
      entityId: 'first-edge',
    }
    const second = { ...first, entityId: 'second-edge', primitiveIndex: 2 }
    const selectionRanges: Selections = {
      graphSelections: [],
      otherSelections: [first, second],
    }
    const onChange = vi.fn()
    mocks.getSelectionReferences.mockResolvedValue([
      {
        id: first.entityId,
        label: 'Edge',
        code: 'firstEdge',
        enginePrimitiveSelection: first,
      },
      {
        id: second.entityId,
        label: 'Edge',
        code: 'secondEdge',
        enginePrimitiveSelection: second,
      },
    ])
    mocks.removeReferenceFromSelections.mockImplementation(
      (selections, reference) => ({
        ...selections,
        otherSelections: selections.otherSelections.filter(
          (selection) => selection !== reference.enginePrimitiveSelection
        ),
      })
    )
    function DialogSelections() {
      const { kclManager } = useSingletons()
      return (
        <SelectionReferencesList
          variant="dialog"
          kclManager={kclManager}
          wasmPromise={kclManager.wasmInstancePromise}
          selectionRanges={selectionRanges}
          onChange={onChange}
        />
      )
    }
    await act(async () => {
      render(
        <Suspense>
          <DialogSelections />
        </Suspense>
      )
      await mocks.wasmInstancePromise
    })

    expect(screen.getAllByText('Edge')).toHaveLength(2)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Edge selection details' })[0]
    )
    expect(screen.getByText('firstEdge')).toBeInTheDocument()
    expect(screen.queryByText('secondEdge')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove Edge from selection' })[0]
    )
    expect(onChange).toHaveBeenCalledWith({
      graphSelections: [],
      otherSelections: [second],
    })
  })
})
