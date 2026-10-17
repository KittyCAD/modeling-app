import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerFeatureTree, type ZooFeatureTree } from './feature-tree'
import type { ZooFeatureTreeRow } from '../feature-tree-row/feature-tree-row'

registerFeatureTree()
afterEach(() => document.body.replaceChildren())

async function settle(tree: ZooFeatureTree) {
  await tree.updateComplete
  await Promise.resolve()
  await Promise.all(
    [...tree.querySelectorAll('zoo-feature-tree-row')].map(
      (row) => row.updateComplete
    )
  )
}

async function fixture() {
  const tree = document.createElement('zoo-feature-tree')
  tree.innerHTML = `<zoo-feature-tree-row node-id="a" label="A">
    <button slot="actions" hidden>Hidden</button>
    <span slot="actions" style="display:none"><button>Hidden parent</button></span>
    <button slot="actions" disabled>Disabled</button>
    <button slot="actions">Hide</button><button slot="actions">Menu</button>
  </zoo-feature-tree-row>`
  document.body.append(tree)
  await settle(tree)
  const row = tree.firstElementChild as ZooFeatureTreeRow
  return { tree, row, actions: [...row.querySelectorAll('button')] }
}

function key(
  target: HTMLElement,
  value: string,
  options: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...options,
  })
  target.dispatchEvent(event)
  return event
}

describe('feature tree host integration', () => {
  it('preserves native editing in contenteditable actions with printable remapped shortcuts', async () => {
    const { tree, row } = await fixture()
    const editor = document.createElement('span')
    editor.setAttribute('contenteditable', '')
    editor.slot = 'actions'
    row.append(editor)
    await settle(tree)
    tree.shortcuts = { focusActions: [{ key: 'a' }] }
    editor.focus()
    expect(key(editor, 'a').defaultPrevented).toBe(false)
    expect(key(editor, 'ArrowLeft').defaultPrevented).toBe(false)
  })
  it('exposes semantic actions independently of optional shortcuts', async () => {
    const { tree, row, actions } = await fixture()
    tree.shortcuts = false
    row.focus()
    expect(tree.focusedNodeId).toBe('a')
    expect(key(row, 'F2').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(row)
    expect(tree.focusActions()).toBe(true)
    expect(document.activeElement).toBe(actions[3])
    expect(tree.focusActions()).toBe(true)
    expect(document.activeElement).toBe(actions[4])
    expect(key(actions[4], 'Escape').defaultPrevented).toBe(false)
    expect(tree.focusRow()).toBe(true)
    expect(document.activeElement).toBe(row)
    const menu = vi.fn()
    tree.addEventListener('zoo-context-menu', menu)
    expect(tree.requestContextMenu()).toBe(true)
    expect(menu).toHaveBeenCalledOnce()
    expect(menu.mock.calls[0][0].detail.nodeId).toBe('a')
    expect(tree.selectedIds).toEqual([])
  })

  it('replaces shortcuts with exact modifiers and supports disabling individual actions', async () => {
    const { tree, row, actions } = await fixture()
    tree.shortcuts = {
      focusActions: [{ key: 'a', alt: true }],
      focusRow: [{ key: 'r', alt: true }],
      requestContextMenu: [{ key: 'm', alt: true }],
    }
    row.focus()
    expect(key(row, 'F2').defaultPrevented).toBe(false)
    expect(
      key(row, 'a', { altKey: true, shiftKey: true }).defaultPrevented
    ).toBe(false)
    expect(key(row, 'a', { altKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(actions[3])
    key(actions[3], 'r', { altKey: true })
    expect(document.activeElement).toBe(row)
    const menu = vi.fn()
    tree.addEventListener('zoo-context-menu', menu)
    expect(key(row, 'F10', { shiftKey: true }).defaultPrevented).toBe(false)
    key(row, 'm', { altKey: true })
    expect(menu).toHaveBeenCalledOnce()
    tree.shortcuts = { focusActions: [] }
    expect(key(row, 'F2').defaultPrevented).toBe(false)
    key(row, 'F10', { shiftKey: true })
    expect(menu).toHaveBeenCalledTimes(2)
  })

  it('leaves prevented/composing events and native action editing alone', async () => {
    const { tree, row, actions } = await fixture()
    row.focus()
    const prevented = new KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
      cancelable: true,
    })
    prevented.preventDefault()
    row.dispatchEvent(prevented)
    expect(document.activeElement).toBe(row)
    key(row, 'F2', { isComposing: true })
    expect(document.activeElement).toBe(row)
    tree.focusActions()
    expect(key(actions[3], 'a').defaultPrevented).toBe(false)
  })

  it('handles empty/populated transitions and reconnects without losing action ownership', async () => {
    const { tree, row, actions } = await fixture()
    row.focus()
    row.remove()
    await settle(tree)
    expect(document.activeElement).toBe(tree)
    expect(tree.tabIndex).toBe(0)
    expect(tree.focusActions()).toBe(false)
    tree.append(row)
    await settle(tree)
    expect(document.activeElement).toBe(row)
    tree.remove()
    await row.updateComplete
    expect(actions[3].hasAttribute('tabindex')).toBe(false)
    document.body.append(tree)
    await settle(tree)
    expect(row.getAttribute('role')).toBe('treeitem')
    expect(actions[3].tabIndex).toBe(-1)
    row.focus()
    expect(tree.focusActions()).toBe(true)
  })

  it('returns focus from a removed action but never steals it from an outside control', async () => {
    const { tree, row, actions } = await fixture()
    row.focus()
    tree.focusActions()
    actions[3].remove()
    await settle(tree)
    expect(document.activeElement).toBe(row)
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    row.remove()
    await settle(tree)
    expect(document.activeElement).toBe(outside)
  })

  it('dispatches one composed event across an enclosing shadow root', async () => {
    const { tree, row } = await fixture()
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    document.body.append(host)
    root.append(tree)
    await settle(tree)
    const listener = vi.fn()
    document.body.addEventListener('zoo-selection-change', listener, {
      once: true,
    })
    row.focus()
    key(row, ' ')
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toEqual({
      nodeId: 'a',
      selectedIds: ['a'],
    })
    expect(tree.selectedIds).toEqual([])
  })
})
