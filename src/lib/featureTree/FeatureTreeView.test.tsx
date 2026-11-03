import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/components/ContextMenu', () => ({ ContextMenu: () => null }))

import { memo, StrictMode, useState } from 'react'
import type {
  ZooFeatureTree,
  ZooFeatureTreeRow,
} from '@kittycad/ui-components/web-components'
import { FEATURE_TREE_EDIT_EVENT } from '@src/lib/featureTree/registry/contract'
import {
  FeatureTree,
  FeatureTreeRow,
  FeatureTreeDivider,
  FeatureTreeNotice,
} from '@src/lib/featureTree/FeatureTreeView'

const nodes = [
  { id: 'parent', label: 'Parent' },
  { id: 'child', parentId: 'parent', label: 'Child' },
  { id: 'sibling', label: 'Sibling' },
]
function elements(container: HTMLElement) {
  return {
    tree: container.querySelector<ZooFeatureTree>('zoo-feature-tree')!,
    row: (id: string) =>
      container.querySelector<ZooFeatureTreeRow>(`[node-id="${id}"]`)!,
  }
}
afterEach(cleanup)
describe('explicit feature tree view', () => {
  it('has its hierarchy before rows mount and hides branch decorations without making them nodes', async () => {
    const view = render(
      <FeatureTree nodes={nodes} defaultExpandedIds={['parent']}>
        <FeatureTreeNotice parentId="parent">Notice</FeatureTreeNotice>
      </FeatureTree>
    )
    const { tree } = elements(view.container)
    expect(tree.nodes).toEqual(nodes)
    view.rerender(
      <FeatureTree nodes={nodes} defaultExpandedIds={['parent']}>
        <FeatureTreeRow nodeId="parent" label="Parent" />
        <FeatureTreeRow nodeId="child" label="Child" />
        <FeatureTreeNotice parentId="parent">Notice</FeatureTreeNotice>
        <FeatureTreeDivider parentId="parent" />
        <FeatureTreeRow nodeId="sibling" label="Sibling" />
      </FeatureTree>
    )
    const { row } = elements(view.container)
    await waitFor(() =>
      expect(row('child').getAttribute('aria-level')).toBe('2')
    )
    expect(row('child').parentElement).toBe(tree)
    expect(view.getByText('Notice').hidden).toBe(false)
    await act(() =>
      tree.dispatchEvent(
        new CustomEvent('zoo-expand', {
          detail: { nodeId: 'parent', expanded: false },
        })
      )
    )
    await waitFor(() => expect(row('child').hidden).toBe(true))
    expect(view.getByText('Notice').hidden).toBe(true)
    expect(view.container.querySelector('hr')!.hidden).toBe(true)
    expect(tree.nodes).toHaveLength(3)
  })

  it('uses data order when memoized rows move and keeps focus on the same identity', async () => {
    const Row = memo(({ id }: { id: string }) => (
      <FeatureTreeRow nodeId={id} label={id} />
    ))
    const first = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]
    const renderTree = (reversed: boolean) => (
      <FeatureTree nodes={reversed ? first.toReversed() : first}>
        {(reversed ? ['b', 'a'] : ['a', 'b']).map((id) => (
          <Row key={id} id={id} />
        ))}
      </FeatureTree>
    )
    const view = render(renderTree(false))
    const { tree, row } = elements(view.container)
    await waitFor(() => expect(row('a').getAttribute('role')).toBe('treeitem'))
    row('a').focus()
    view.rerender(renderTree(true))
    await waitFor(() =>
      expect(tree.nodes.map(({ id }) => id)).toEqual(['b', 'a'])
    )
    expect(tree.focusedNodeId).toBe('a')
    fireEvent.keyDown(row('a'), { key: 'ArrowUp' })
    expect(tree.focusedNodeId).toBe('b')
  })

  it('keeps user expansion through selection updates, but follows changed live defaults and prunes removed nodes', async () => {
    const content = (open: boolean, present = true, selected = false) => (
      <StrictMode>
        <FeatureTree
          nodes={present ? nodes : [nodes[2]]}
          defaultExpandedIds={open ? ['parent'] : []}
          selectedIds={selected ? ['child'] : []}
        >
          {present && (
            <>
              <FeatureTreeRow nodeId="parent" label="Parent" />
              <FeatureTreeRow nodeId="child" label="Child" />
            </>
          )}
          <FeatureTreeRow nodeId="sibling" label="Sibling" />
        </FeatureTree>
      </StrictMode>
    )
    const view = render(content(true))
    const { tree, row } = elements(view.container)
    await waitFor(() => expect(row('child').hidden).toBe(false))
    await act(() =>
      tree.dispatchEvent(
        new CustomEvent('zoo-expand', {
          detail: { nodeId: 'parent', expanded: false },
        })
      )
    )
    view.rerender(content(true, true, true))
    await waitFor(() => expect(row('child').hidden).toBe(true))
    view.rerender(content(false))
    view.rerender(content(true))
    await waitFor(() => expect(row('child').hidden).toBe(false))
    view.rerender(content(true, false))
    expect(tree.nodes.map(({ id }) => id)).toEqual(['sibling'])
    expect(tree.expandedIds).toEqual([])
  })

  it.each(['Enter', ' '])(
    'selects with %s and routes explicit editing once',
    async (key) => {
      const select = vi.fn(),
        edit = vi.fn()
      function Controlled() {
        const [selected, setSelected] = useState(false)
        return (
          <FeatureTree
            nodes={nodes}
            defaultExpandedIds={['parent']}
            selectedIds={selected ? ['child'] : []}
          >
            <FeatureTreeRow nodeId="parent" label="Parent" />
            <FeatureTreeRow
              nodeId="child"
              label="Child"
              onSelect={() => {
                select()
                setSelected(true)
              }}
              onDoubleClick={edit}
            />
            <FeatureTreeRow nodeId="sibling" label="Sibling" />
          </FeatureTree>
        )
      }
      const view = render(<Controlled />),
        { tree, row } = elements(view.container)
      await waitFor(() =>
        expect(row('child').getAttribute('role')).toBe('treeitem')
      )
      row('child').focus()
      fireEvent.keyDown(row('child'), { key })
      expect(select).toHaveBeenCalledOnce()
      expect(edit).not.toHaveBeenCalled()
      expect(tree.selectedIds).toEqual(['child'])
      await act(() =>
        tree.dispatchEvent(
          new CustomEvent(FEATURE_TREE_EDIT_EVENT, {
            detail: { nodeId: 'child' },
          })
        )
      )
      expect(select).toHaveBeenCalledTimes(2)
      expect(edit).toHaveBeenCalledOnce()
    }
  )

  it('keeps the focused representation selected when an operation and a body share source selection', async () => {
    const candidates = ['feature', 'body']
    const view = render(
      <FeatureTree
        nodes={candidates.map((id) => ({ id, label: id }))}
        selectedIds={candidates}
      >
        <FeatureTreeRow nodeId="feature" label="feature" />
        <FeatureTreeRow nodeId="body" label="body" />
      </FeatureTree>
    )
    const { tree, row } = elements(view.container)
    await waitFor(() =>
      expect(row('body').getAttribute('role')).toBe('treeitem')
    )
    row('body').focus()
    fireEvent.keyDown(row('body'), { key: ' ' })
    expect(tree.selectedIds).toEqual(['body'])
    await waitFor(() =>
      expect(row('body').getAttribute('aria-selected')).toBe('true')
    )
  })

  it('routes visibility actions once without selecting or editing the row', async () => {
    const select = vi.fn(),
      edit = vi.fn(),
      toggle = vi.fn()
    const view = render(
      <FeatureTree nodes={[{ id: 'body', label: 'Body' }]}>
        <FeatureTreeRow
          nodeId="body"
          label="Body"
          onSelect={select}
          onDoubleClick={edit}
          visibility={{ visible: true, onVisibilityChange: toggle }}
        />
      </FeatureTree>
    )
    fireEvent.click(view.getByRole('button', { name: 'Hide Body' }))
    expect(toggle).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })
})
