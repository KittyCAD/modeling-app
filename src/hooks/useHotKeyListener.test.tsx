import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import type { KclManager } from '@src/lang/KclManager'
import { platform } from '@src/lib/utils'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/utils', () => ({ platform: vi.fn(() => 'windows') }))

function setup(ctrlMultiselectOnWindows = true) {
  const manager = {
    setIsShiftDown: vi.fn(),
    setIsControlSelectionDown: vi.fn(),
  }
  const hook = renderHook(
    ({ enabled }) =>
      useHotKeyListener(manager as unknown as KclManager, enabled),
    { initialProps: { enabled: ctrlMultiselectOnWindows } }
  )
  return { manager, ...hook }
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  const event = new KeyboardEvent(type, { ...init, cancelable: true })
  window.dispatchEvent(event)
  return event
}

afterEach(() => vi.mocked(platform).mockReturnValue('windows'))

describe('selection modifiers', () => {
  it('keeps Ctrl disabled by default and preserves Shift selection', () => {
    const manager = {
      setIsShiftDown: vi.fn(),
      setIsControlSelectionDown: vi.fn(),
    }
    renderHook(() => useHotKeyListener(manager as unknown as KclManager))
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    key('keydown', { key: 'Shift', shiftKey: true, ctrlKey: true })
    expect(manager.setIsShiftDown).toHaveBeenLastCalledWith(true)
  })

  it('applies setting changes without leaving Ctrl selection stuck', () => {
    const { manager, rerender } = setup(false)
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    rerender({ enabled: true })
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(true)
    rerender({ enabled: false })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    key('keydown', { key: 'z', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
  })

  it('tracks Windows Ctrl separately and lets keyboard shortcuts propagate', () => {
    const { manager } = setup()
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(true)
    expect(manager.setIsShiftDown).not.toHaveBeenCalled()
    const shortcut = key('keydown', { key: 'z', ctrlKey: true })
    expect(shortcut.defaultPrevented).toBe(false)
    key('keyup', { key: 'Control' })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
  })

  it.each(['macos', 'linux'] as const)('keeps Ctrl unchanged on %s', (os) => {
    vi.mocked(platform).mockReturnValue(os)
    const { manager } = setup()
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
  })

  it('excludes AltGr and Windows-key chords and restores Ctrl after release', () => {
    const { manager } = setup()
    key('keydown', { key: 'Alt', ctrlKey: true, altKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    key('keyup', { key: 'Alt', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(true)
    key('keydown', { key: 'Meta', ctrlKey: true, metaKey: true })
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
  })

  it('keeps Shift held when Ctrl is released and resets both on blur', () => {
    const { manager } = setup()
    key('keydown', { key: 'Shift', shiftKey: true, ctrlKey: true })
    key('keyup', { key: 'Control', shiftKey: true })
    expect(manager.setIsShiftDown).toHaveBeenLastCalledWith(true)
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    window.dispatchEvent(new Event('blur'))
    expect(manager.setIsShiftDown).toHaveBeenLastCalledWith(false)
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
  })

  it('resets modifiers when hidden and removes listeners on unmount', () => {
    const { manager, unmount } = setup()
    key('keydown', { key: 'Control', ctrlKey: true })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(manager.setIsControlSelectionDown).toHaveBeenLastCalledWith(false)
    hidden.mockRestore()
    unmount()
    manager.setIsControlSelectionDown.mockClear()
    key('keydown', { key: 'Control', ctrlKey: true })
    expect(manager.setIsControlSelectionDown).not.toHaveBeenCalled()
  })
})
