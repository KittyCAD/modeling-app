import { normalizeEventKey } from '@src/registry/contracts/keymap'

export function keyboardEventToKeymapChord(event: KeyboardEvent) {
  if (isModifierKey(event.key)) {
    return null
  }

  const key = normalizeEventKey(event)
  if (!key) {
    return null
  }

  const parts: string[] = []
  const usesMod = isMacPlatform() ? event.metaKey : event.ctrlKey

  if (usesMod) {
    parts.push('mod')
  } else {
    if (event.ctrlKey) {
      parts.push('ctrl')
    }
    if (event.metaKey) {
      parts.push('meta')
    }
  }

  if (event.altKey) {
    parts.push('alt')
  }
  if (event.shiftKey) {
    parts.push('shift')
  }
  parts.push(key)

  return parts.join('+')
}

function isModifierKey(key: string) {
  return key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt'
}

function isMacPlatform() {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /mac|iphone|ipad|ipod/i.test(navigator.platform)
}
