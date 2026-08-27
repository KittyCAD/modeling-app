import { Suspense } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  getUnresolvedEnginePrimitiveSelections: (
    enginePrimitives: typeof mocks.selectionRanges.otherSelections,
    references: Array<{ enginePrimitiveSelection?: { entityId: string } }>
  ) =>
    enginePrimitives.filter(
      (selection) =>
        !references.some(
          (reference) =>
            reference.enginePrimitiveSelection?.entityId === selection.entityId
        )
    ),
  isDefaultPlaneSelection: () => false,
  isEnginePrimitiveSelection: (selection: { type?: string }) =>
    selection.type === 'enginePrimitive',
  removeEnginePrimitiveSelectionFromSelections: (
    selections: typeof mocks.selectionRanges,
    selectionToRemove: typeof mocks.unresolvedFace
  ) => ({
    graphSelections: selections.graphSelections,
    otherSelections: selections.otherSelections.filter(
      (selection) => selection.entityId !== selectionToRemove.entityId
    ),
  }),
  removeReferenceFromSelections: vi.fn(),
}))

import { SelectionReferencesPopover } from '@src/components/SelectionReferencesPopover'

describe('SelectionReferencesPopover', () => {
  beforeEach(() => {
    mocks.getSelectionReferences.mockReset()
    mocks.getSelectionReferences.mockResolvedValue([])
    mocks.send.mockReset()
  })

  test('shows and removes an engine primitive that has no KCL reference', async () => {
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading Wasm...</div>}>
          <SelectionReferencesPopover />
        </Suspense>
      )
      await mocks.wasmInstancePromise
    })

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
})
