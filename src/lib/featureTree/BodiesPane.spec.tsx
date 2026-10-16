import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  graph: new Map(),
  send: vi.fn(),
  hide: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({
    kclManager: {
      execStateSignal: {
        value: { artifactGraph: state.graph, operations: new Map() },
      },
      artifactGraph: state.graph,
      code: '',
      ast: {},
      editorState: { selection: { main: { from: 0, to: 0 } } },
    },
  }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    actor: {},
    send: state.send,
    context: { selectionRanges: { graphSelections: [] } },
  }),
}))
vi.mock('@src/lib/operations', () => ({
  getHideOpByArtifactId: () => undefined,
  onHide: state.hide,
  onDelete: state.delete,
  onUnhide: vi.fn(),
}))
vi.mock('@src/components/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: React.ReactNode }) => <>{items}</>,
  ContextMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

import type { Artifact } from '@src/lang/std/artifactGraph'
import { FeatureTree } from '@src/lib/featureTree/FeatureTreeView'
import { BodiesPaneContents } from '@src/lib/featureTree/BodiesPane'

afterEach(() => {
  cleanup()
  state.graph.clear()
  vi.clearAllMocks()
})
describe('Bodies scene tree', () => {
  it('keeps pattern copy identity in selection, visibility and delete actions', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern',
      subType: 'linear',
      sourceId: 'source',
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: { range: [0, 10, 0], pathToNode: [], nodePath: { steps: [] } },
    }
    state.graph.set(pattern.id, pattern)
    const view = render(
      <FeatureTree label="Bodies">
        <BodiesPaneContents />
      </FeatureTree>
    )
    const tree = view.container.querySelector('zoo-feature-tree')!
    expect(tree.getAttribute('aria-label')).toBe('Bodies')
    const row = view.container.querySelector('[node-id="copy-2"]')!
    expect(within(row as HTMLElement).getByText('Body 2')).toBeTruthy()
    row.dispatchEvent(
      new CustomEvent('zoo-select', { bubbles: true, composed: true })
    )
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Set selection',
        data: expect.objectContaining({
          selection: expect.objectContaining({
            engineEntityId: 'copy-2',
            patternIndex: 2,
          }),
        }),
      })
    )
    fireEvent.click(view.getByRole('button', { name: 'Hide Body 2' }))
    expect(state.hide).toHaveBeenCalledWith(
      expect.objectContaining({
        objects: expect.objectContaining({
          graphSelections: [
            expect.objectContaining({
              engineEntityId: 'copy-2',
              patternIndex: 2,
            }),
          ],
        }),
      })
    )
    fireEvent.click(view.getAllByRole('button', { name: 'Delete' })[1])
    expect(state.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        objects: expect.objectContaining({
          graphSelections: [
            expect.objectContaining({
              engineEntityId: 'copy-2',
              patternIndex: 2,
            }),
          ],
        }),
      })
    )
  })
  it('shows an empty state with no bodies', () => {
    const view = render(
      <FeatureTree label="Bodies">
        <BodiesPaneContents />
      </FeatureTree>
    )
    expect(view.getByText('No bodies')).toBeTruthy()
    expect(
      view.container.querySelectorAll('zoo-feature-tree-row')
    ).toHaveLength(0)
  })
})
