import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { KclManager } from '@src/lang/KclManager'
import type { selectionMatchesReference } from '@src/lib/selections'
import type { EnginePrimitiveSelection } from '@src/machines/modelingSharedTypes'

const mocks = vi.hoisted(() => ({
  getSelectionReferences: vi.fn(),
  selectionMatchesReference: vi.fn<typeof selectionMatchesReference>(),
  kclManager: {
    artifactGraph: new Map(),
    engineCommandManager: {},
    engineSceneGenerationSignal: { value: 0 },
    wasmInstancePromise: Promise.resolve({}),
  } as unknown as KclManager,
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: () => null,
}))

vi.mock('@src/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
}))

vi.mock('@src/lib/selections', () => ({
  getSelectionReferences: mocks.getSelectionReferences,
  getSelectionTypeDisplayText: () => '1 edge',
  isDefaultPlaneSelection: () => false,
  isEnginePrimitiveSelection: (selection: { type?: string }) =>
    selection.type === 'enginePrimitive',
  selectionMatchesReference: mocks.selectionMatchesReference,
}))

import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'

const first: EnginePrimitiveSelection = {
  type: 'enginePrimitive',
  entityId: 'first-edge',
  parentEntityId: 'body',
  primitiveIndex: 1,
  primitiveType: 'edge',
}
const second = { ...first, entityId: 'second-edge', primitiveIndex: 2 }

describe('DialogSelectionList', () => {
  beforeEach(() => {
    mocks.getSelectionReferences.mockReset()
    mocks.selectionMatchesReference.mockReset()
  })

  test('keeps individual removal available when reference lookup fails', async () => {
    const error = new Error('Unable to resolve selection references.')
    mocks.getSelectionReferences.mockRejectedValue(error)
    const onChange = vi.fn()
    await act(async () => {
      render(
        <Suspense>
          <DialogSelectionList
            kclManager={mocks.kclManager}
            wasmPromise={mocks.kclManager.wasmInstancePromise}
            selectionRanges={{ graphSelections: [], otherSelections: [first] }}
            onChange={onChange}
          />
        </Suspense>
      )
      await mocks.kclManager.wasmInstancePromise
    })

    expect(screen.getByRole('alert')).toHaveTextContent(error.message)
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Edge from selection' })
    )
    expect(onChange).toHaveBeenCalledWith({
      graphSelections: [],
      otherSelections: [],
    })
  })

  test('lists individual references as tooltips without copy actions and removes only the chosen edge', async () => {
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
    mocks.selectionMatchesReference.mockImplementation(
      (selection, reference) => selection === reference.enginePrimitiveSelection
    )
    await act(async () => {
      render(
        <Suspense>
          <DialogSelectionList
            kclManager={mocks.kclManager}
            wasmPromise={mocks.kclManager.wasmInstancePromise}
            selectionRanges={{
              graphSelections: [],
              otherSelections: [first, second],
            }}
            onChange={onChange}
          />
        </Suspense>
      )
      await mocks.kclManager.wasmInstancePromise
    })

    const edges = screen.getAllByText('Edge')
    expect(edges.map((label) => label.textContent)).toEqual(['Edge', 'Edge'])
    expect(screen.getByText('firstEdge')).toBeInTheDocument()
    expect(screen.getByText('secondEdge')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /copy/i })
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove Edge from selection' })[0]
    )
    expect(onChange).toHaveBeenCalledWith({
      graphSelections: [],
      otherSelections: [second],
    })
  })
})
