import { toolbarHotkeyDisplay } from '@src/lib/toolbarHotkeys'
import { describe, expect, it } from 'vitest'

describe('toolbarHotkeyDisplay', () => {
  it('hides bare escape hotkeys', () => {
    expect(toolbarHotkeyDisplay('escape', 'macos')).toBeUndefined()
    expect(toolbarHotkeyDisplay(['esc'], 'windows')).toBeUndefined()
  })

  it('displays modified escape hotkeys', () => {
    expect(toolbarHotkeyDisplay('shift+escape', 'macos')).toEqual('⬆Esc')
  })

  it('displays bare escape when requested', () => {
    expect(toolbarHotkeyDisplay('escape', 'macos', { showBareEsc: true })).toBe(
      'Esc'
    )
  })

  it('displays complete keymap sequences', () => {
    expect(toolbarHotkeyDisplay(['v', '1'], 'linux')).toEqual('V 1')
    expect(toolbarHotkeyDisplay(['escape', 'r'], 'linux')).toEqual('Esc R')
  })
})
