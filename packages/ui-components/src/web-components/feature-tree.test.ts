import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerFeatureTree, type ZooFeatureTree } from './feature-tree'
import type { ZooFeatureTreeRow } from './feature-tree-row'

registerFeatureTree()
afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function settle(tree: ZooFeatureTree) {
  await tree.updateComplete
  await Promise.all(
    [...tree.querySelectorAll('zoo-feature-tree-row')].map(
      (row) => row.updateComplete
    )
  )
  await Promise.resolve()
}

async function mount() {
  const tree = document.createElement('zoo-feature-tree')
  tree.innerHTML = `
    <zoo-feature-tree-row node-id="part" label="Part">
      <zoo-feature-tree-row slot="children" node-id="sketch" label="Sketch">
        <zoo-feature-tree-row slot="children" node-id="profile" label="Profile"></zoo-feature-tree-row>
      </zoo-feature-tree-row>
      <zoo-feature-tree-row slot="children" node-id="extrude" label="Extrude">
        <button slot="actions">Hide</button><button slot="actions">Menu</button>
      </zoo-feature-tree-row>
    </zoo-feature-tree-row>
    <zoo-feature-tree-row node-id="fillet" label="Fillet" disabled></zoo-feature-tree-row>
    <zoo-feature-tree-row node-id="extrude2" label="Extrude002"></zoo-feature-tree-row>`
  tree.expandedIds = ['part', 'sketch']
  tree.selectedIds = ['extrude']
  document.body.append(tree)
  await settle(tree)
  const row = (id: string) =>
    tree.querySelector<ZooFeatureTreeRow>(`[node-id="${id}"]`)!
  return { tree, row }
}

function key(
  target: HTMLElement,
  value: string,
  options: KeyboardEventInit = {}
) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...options,
    })
  )
}

describe('feature tree', () => {
  it('mirrors branch navigation in RTL and responds to direction changes', async () => {
    const { tree, row } = await mount()
    tree.style.direction = 'rtl'
    row('part').focus()
    key(row('part'), 'ArrowLeft')
    expect(document.activeElement).toBe(row('sketch'))
    row('extrude').focus()
    key(row('extrude'), 'ArrowRight')
    expect(document.activeElement).toBe(row('part'))
    const expand = vi.fn()
    tree.addEventListener('zoo-expand', expand)
    key(row('part'), 'ArrowRight')
    expect(expand.mock.calls[0][0].detail).toEqual({
      nodeId: 'part',
      expanded: false,
    })
    tree.expandedIds = []
    await settle(tree)
    key(row('part'), 'ArrowLeft')
    expect(expand.mock.calls[1][0].detail).toEqual({
      nodeId: 'part',
      expanded: true,
    })
    tree.style.direction = 'ltr'
    key(row('part'), 'ArrowRight')
    expect(expand.mock.calls[2][0].detail).toEqual({
      nodeId: 'part',
      expanded: true,
    })
  })
  it('shares behavior in HUD mode and derives connector ends from sibling structure', async () => {
    const { tree, row } = await mount()
    tree.appearance = 'hud'
    await settle(tree)
    expect(row('part').appearance).toBe('hud')
    expect(row('part').nested).toBe(false)
    expect(row('sketch').nested).toBe(true)
    expect(row('sketch').lastSibling).toBe(false)
    expect(row('extrude').lastSibling).toBe(true)
    expect(row('profile').lastSibling).toBe(true)
    expect(row('part').shadowRoot!.querySelector('.junction')).not.toBeNull()
    const expand = vi.fn()
    tree.addEventListener('zoo-expand', expand)
    row('part')
      .shadowRoot!.querySelector<HTMLButtonElement>('[part="disclosure"]')!
      .click()
    expect(expand.mock.calls[0][0].detail).toEqual({
      nodeId: 'part',
      expanded: false,
    })
    const removed = row('extrude')
    removed.remove()
    await Promise.resolve()
    await settle(tree)
    expect(row('sketch').lastSibling).toBe(true)
    tree.appearance = 'default'
    await settle(tree)
    expect(row('part').shadowRoot!.querySelector('.junction')).toBeNull()
    expect(row('part').getAttribute('aria-expanded')).toBe('true')
  })
  it('exposes hierarchy and uses one Tab stop without nested selection buttons', async () => {
    const { tree, row } = await mount()
    expect(tree.getAttribute('role')).toBe('tree')
    expect(row('profile').getAttribute('aria-level')).toBe('3')
    expect(row('extrude').getAttribute('aria-posinset')).toBe('2')
    expect(row('part').getAttribute('aria-expanded')).toBe('true')
    expect(row('profile').hasAttribute('aria-expanded')).toBe(false)
    expect(row('extrude').getAttribute('aria-selected')).toBe('true')
    expect([...tree.querySelectorAll('[tabindex="0"]')]).toEqual([
      row('extrude'),
    ])
    expect(
      row('extrude').shadowRoot!.querySelector('button[part="content"]')
    ).toBeNull()
    expect(row('extrude').querySelector('button')!.tabIndex).toBe(-1)
    row('extrude').label = 'Renamed extrusion'
    await row('extrude').updateComplete
    expect(row('extrude').getAttribute('aria-label')).toBe('Renamed extrusion')
  })

  it('moves focus independently of selection, and emits controlled selection requests', async () => {
    const { tree, row } = await mount()
    const selected = vi.fn()
    tree.addEventListener('zoo-selection-change', selected)
    row('extrude').focus()
    key(row('extrude'), 'ArrowUp')
    expect(document.activeElement).toBe(row('profile'))
    expect(tree.selectedIds).toEqual(['extrude'])
    expect(selected).not.toHaveBeenCalled()
    key(row('profile'), ' ')
    expect(selected.mock.calls[0][0].detail).toEqual({
      nodeId: 'profile',
      selectedIds: ['profile'],
    })
    expect(tree.selectedIds).toEqual(['extrude'])
    key(row('profile'), 'Home')
    expect(document.activeElement).toBe(row('part'))
    key(row('part'), 'End')
    expect(document.activeElement).toBe(row('extrude2'))
  })

  it('requests expansion, navigates parent/child, and recovers focus after external collapse', async () => {
    const { tree, row } = await mount()
    const expanded = vi.fn()
    tree.addEventListener('zoo-expand', expanded)
    row('part').focus()
    key(row('part'), 'ArrowRight')
    expect(document.activeElement).toBe(row('sketch'))
    key(row('sketch'), 'ArrowLeft')
    expect(expanded.mock.calls[0][0].detail).toEqual({
      nodeId: 'sketch',
      expanded: false,
    })
    expect(tree.expandedIds).toEqual(['part', 'sketch'])
    row('profile').focus()
    tree.expandedIds = ['part']
    await settle(tree)
    expect(document.activeElement).toBe(row('sketch'))
    expect(row('profile').tabIndex).toBe(-1)
    key(row('sketch'), 'ArrowLeft')
    expect(document.activeElement).toBe(row('part'))
  })

  it('supports incremental typeahead and repeated-letter cycling across visible rows', async () => {
    const { tree, row } = await mount()
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    row('part').focus()
    key(row('part'), 'e')
    expect(document.activeElement).toBe(row('extrude'))
    key(row('extrude'), 'x')
    expect(document.activeElement).toBe(row('extrude'))
    // Reset the search after its idle timeout, then cycle matching initials.
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    key(row('extrude'), 'e')
    expect(document.activeElement).toBe(row('extrude2'))
    key(row('extrude2'), 'e')
    expect(document.activeElement).toBe(row('extrude'))
    tree.expandedIds = []
    await settle(tree)
    vi.spyOn(Date, 'now').mockReturnValue(3000)
    key(row('part'), 's')
    expect(document.activeElement).not.toBe(row('sketch'))
    vi.restoreAllMocks()
  })

  it('toggles multiple selection and prevents selection of disabled features', async () => {
    const { tree, row } = await mount()
    tree.multiselect = true
    await settle(tree)
    const selected = vi.fn()
    tree.addEventListener('zoo-selection-change', selected)
    key(row('profile'), ' ')
    expect(selected.mock.calls[0][0].detail.selectedIds).toEqual([
      'extrude',
      'profile',
    ])
    key(row('extrude'), ' ')
    expect(selected.mock.calls[1][0].detail.selectedIds).toEqual([])
    key(row('fillet'), 'Enter')
    expect(selected).toHaveBeenCalledTimes(2)
  })

  it('enters and cycles supplementary actions with F2 and returns with Escape', async () => {
    const { tree, row } = await mount()
    const [hide, menu] = row('extrude').querySelectorAll('button')
    const selected = vi.fn()
    tree.addEventListener('zoo-selection-change', selected)
    row('extrude').focus()
    key(row('extrude'), 'F2')
    expect(document.activeElement).toBe(hide)
    key(hide, 'F2')
    expect(document.activeElement).toBe(menu)
    hide.click()
    expect(selected).not.toHaveBeenCalled()
    key(menu, 'Escape')
    expect(document.activeElement).toBe(row('extrude'))
  })

  it('reports keyboard context-menu requests and releases rows when removed', async () => {
    const { tree, row } = await mount()
    const context = vi.fn()
    tree.addEventListener('zoo-context-menu', context)
    key(row('extrude'), 'F10', { shiftKey: true })
    expect(context.mock.calls[0][0].detail.nodeId).toBe('extrude')
    const removed = row('extrude')
    removed.focus()
    removed.remove()
    await Promise.resolve()
    await removed.updateComplete
    expect(removed.treeItem).toBe(false)
    expect(document.activeElement).toBe(row('part'))
    expect(removed.hasAttribute('role')).toBe(false)
    expect(removed.querySelector('button')!.hasAttribute('tabindex')).toBe(
      false
    )
  })
})
