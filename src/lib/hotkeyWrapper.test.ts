import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'

describe('hotkeyDisplay', () => {
  it('displays mod', async () => {
    expect(hotkeyDisplay('mod+c', 'macos')).toEqual('⌘C')
    expect(hotkeyDisplay('mod+c', 'windows')).toEqual('Ctrl+C')
    expect(hotkeyDisplay('mod+c', 'linux')).toEqual('Ctrl+C')
  })
  it('displays shift', async () => {
    expect(hotkeyDisplay('shift+c', 'macos')).toEqual('⬆C')
    expect(hotkeyDisplay('shift+c', 'windows')).toEqual('Shift+C')
    expect(hotkeyDisplay('shift+c', 'linux')).toEqual('Shift+C')
  })
  it('displays meta', async () => {
    expect(hotkeyDisplay('meta+c', 'macos')).toEqual('⌘C')
    expect(hotkeyDisplay('meta+c', 'windows')).toEqual('Win+C')
    // That's correct.  What browsers call meta is actually super.
    expect(hotkeyDisplay('meta+c', 'linux')).toEqual('Super+C')
  })
  it('displays alt', async () => {
    expect(hotkeyDisplay('alt+c', 'macos')).toEqual('⌥C')
    expect(hotkeyDisplay('alt+c', 'windows')).toEqual('Alt+C')
    expect(hotkeyDisplay('alt+c', 'linux')).toEqual('Alt+C')
  })
  it('displays ctrl', async () => {
    expect(hotkeyDisplay('ctrl+c', 'macos')).toEqual('^C')
    expect(hotkeyDisplay('ctrl+c', 'windows')).toEqual('Ctrl+C')
    expect(hotkeyDisplay('ctrl+c', 'linux')).toEqual('Ctrl+C')
  })
  it('displays multiple modifiers', async () => {
    expect(hotkeyDisplay('shift+alt+ctrl+c', 'windows')).toEqual(
      'Shift+Alt+Ctrl+C'
    )
  })
})
