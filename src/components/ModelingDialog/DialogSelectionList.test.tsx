import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SelectionReference } from '@src/lib/selections'
import type {
  EnginePrimitiveSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'

const mocks = vi.hoisted(() => ({
  getSelectionReferences: vi.fn(),
  removeReferenceFromSelections:
    vi.fn<
      (selections: Selections, reference: SelectionReference) => Selections
    >(),
  kclManager: {
    artifactGraph: new Map(),
    engineCommandManager: {},
    engineSceneGenerationSignal: { value: 0 },
    wasmInstancePromise: Promise.resolve({}),
  },
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: () => null,
}))

vi.mock('@src/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
}))

vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({ kclManager: mocks.kclManager }),
}))

vi.mock('@src/lib/selections', () => ({
  getSelectionReferences: mocks.getSelectionReferences,
  getSelectionTypeDisplayText: () => '1 edge',
  isDefaultPlaneSelection: () => false,
  isEnginePrimitiveSelection: (selection: { type?: string }) =>
    selection.type === 'enginePrimitive',
  removeReferenceFromSelections: mocks.removeReferenceFromSelections,
}))

import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'
import { useSingletons } from '@src/lib/boot'

function DialogSelections({
  selectionRanges,
  onChange,
}: {
  selectionRanges: Selections
  onChange?: (selections: Selections) => void
}) {
  const { kclManager } = useSingletons()
  return (
    <DialogSelectionList
      kclManager={kclManager}
      wasmPromise={kclManager.wasmInstancePromise}
      selectionRanges={selectionRanges}
      onChange={onChange}
    />
  )
}

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
    mocks.getSelectionReferences.mockResolvedValue([])
    mocks.removeReferenceFromSelections.mockReset()
  })

  test.each([
    { scenario: 'no KCL reference is available', error: undefined },
    {
      scenario: 'reference lookup fails',
      error: new Error('Unable to resolve selection references.'),
    },
  ])('keeps individual removal available when $scenario', async ({ error }) => {
    if (error) mocks.getSelectionReferences.mockRejectedValue(error)
    const onChange = vi.fn()
    await act(async () => {
      render(
        <Suspense>
          <DialogSelections
            selectionRanges={{ graphSelections: [], otherSelections: [first] }}
            onChange={onChange}
          />
        </Suspense>
      )
      await mocks.kclManager.wasmInstancePromise
    })

    if (error)
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
    mocks.removeReferenceFromSelections.mockImplementation(
      (selections, reference) => ({
        ...selections,
        otherSelections: selections.otherSelections.filter(
          (selection) => selection !== reference.enginePrimitiveSelection
        ),
      })
    )
    await act(async () => {
      render(
        <Suspense>
          <DialogSelections
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
    expect(edges).toHaveLength(2)
    expect(within(edges[0]).getByRole('tooltip')).toHaveTextContent('firstEdge')
    expect(within(edges[1]).getByRole('tooltip')).toHaveTextContent(
      'secondEdge'
    )
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
