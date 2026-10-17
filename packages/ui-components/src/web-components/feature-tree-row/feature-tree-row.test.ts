import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerFeatureTreeRow,
  type ZooFeatureTreeRow,
} from './feature-tree-row'

registerFeatureTreeRow()

afterEach(() => {
  document.body.replaceChildren()
})

async function mount() {
  const row = document.createElement('zoo-feature-tree-row')
  row.nodeId = 'sketch-1'
  row.label = 'Sketch001'
  document.body.append(row)
  await row.updateComplete
  return row
}

function button(row: ZooFeatureTreeRow, part: string) {
  return row.shadowRoot!.querySelector<HTMLButtonElement>(`[part="${part}"]`)!
}

describe('feature tree row', () => {
  it('emits composed selection intent without changing controlled state', async () => {
    const row = await mount()
    const listener = vi.fn()
    document.body.addEventListener('zoo-select', listener, { once: true })
    button(row, 'content').click()
    expect(listener).toHaveBeenCalledOnce()
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ nodeId: 'sketch-1' })
    expect(event.composed).toBe(true)
    expect(row.selected).toBe(false)
    row.selected = true
    await row.updateComplete
    expect(button(row, 'content').getAttribute('aria-pressed')).toBe('true')
  })

  it('distinguishes leaves from branches and keeps expansion separate from selection', async () => {
    const row = await mount()
    expect(button(row, 'disclosure')).toBeNull()
    row.expanded = false
    await row.updateComplete
    const expand = vi.fn()
    const select = vi.fn()
    row.addEventListener('zoo-expand', expand)
    row.addEventListener('zoo-select', select)
    button(row, 'disclosure').click()
    expect(expand.mock.calls[0][0].detail).toEqual({
      nodeId: 'sketch-1',
      expanded: true,
    })
    expect(select).not.toHaveBeenCalled()
    expect(row.expanded).toBe(false)
    row.expanded = true
    await row.updateComplete
    expect(button(row, 'disclosure').getAttribute('aria-expanded')).toBe('true')
  })

  it('disables built-in actions while leaving slotted action ownership with the caller', async () => {
    const row = await mount()
    row.expanded = false
    row.disabled = true
    const action = document.createElement('button')
    action.slot = 'actions'
    action.textContent = 'Inspect'
    row.append(action)
    await row.updateComplete
    const select = vi.fn()
    const expand = vi.fn()
    row.addEventListener('zoo-select', select)
    row.addEventListener('zoo-expand', expand)
    button(row, 'content').click()
    button(row, 'disclosure').click()
    action.click()
    expect(select).not.toHaveBeenCalled()
    expect(expand).not.toHaveBeenCalled()
    expect(button(row, 'content').disabled).toBe(true)
    expect(button(row, 'disclosure').disabled).toBe(true)
    expect(action.disabled).toBe(false)
  })

  it('accepts a decorative disclosure icon without replacing the accessible control or HUD junction', async () => {
    const row = await mount()
    row.expanded = false
    const icon = document.createElement('span')
    icon.slot = 'disclosure-icon'
    row.append(icon)
    await row.updateComplete
    const slot = button(row, 'disclosure').querySelector('slot')!
    expect(slot.assignedElements()).toEqual([icon])
    expect(button(row, 'disclosure').getAttribute('aria-label')).toBe(
      'Expand Sketch001'
    )
    row.expanded = true
    await row.updateComplete
    expect(button(row, 'disclosure').getAttribute('aria-label')).toBe(
      'Collapse Sketch001'
    )
    row.appearance = 'hud'
    await row.updateComplete
    expect(button(row, 'disclosure').querySelector('slot')).toBeNull()
    expect(
      button(row, 'disclosure').querySelector('[part="junction"]')
    ).not.toBeNull()
  })
})
