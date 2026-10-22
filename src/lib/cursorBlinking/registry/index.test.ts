import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { afterEach, describe, expect, it } from 'vitest'
import cursorBlinking from '.'

function createRegistry() {
  const current = signal(createSettings())
  // This consumer needs only reactive settings, without an actor or editor.
  const service = { current } as SettingsRegistryService
  const registry = new Registry()
  registry.configure([
    cursorBlinking,
    defineRegistryItem({
      providesServices: [provideService(settingsService, service)],
    }),
  ])
  registry.get(settingsService)
  return { registry, current }
}

afterEach(() => {
  document.documentElement.style.removeProperty('--cursor-color')
})

describe('global cursor blinking', () => {
  it('applies settings at the document root without an editor', async () => {
    const { registry, current } = createRegistry()
    try {
      current.value.textEditor.blinkingCursor.user = false
      await Promise.resolve()
      const style = document.documentElement.style
      expect(style.getPropertyValue('--cursor-color')).toBe('transparent')
      current.value.textEditor.blinkingCursor.user = true
      expect(style.getPropertyValue('--cursor-color')).toBe('auto')

      const original = current.value
      const replacement = createSettings()
      replacement.textEditor.blinkingCursor.user = false
      current.value = replacement
      expect(style.getPropertyValue('--cursor-color')).toBe('transparent')
      original.textEditor.blinkingCursor.user = false
      original.textEditor.blinkingCursor.user = true
      expect(style.getPropertyValue('--cursor-color')).toBe('transparent')
      replacement.textEditor.blinkingCursor.user = true
      expect(style.getPropertyValue('--cursor-color')).toBe('auto')
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it('stops updates and restores the previous style when disposed', async () => {
    const style = document.documentElement.style
    style.setProperty('--cursor-color', 'red', 'important')
    const { registry, current } = createRegistry()
    await Promise.resolve()
    registry[Symbol.dispose]()
    current.value.textEditor.blinkingCursor.user = false
    expect(style.getPropertyValue('--cursor-color')).toBe('red')
    expect(style.getPropertyPriority('--cursor-color')).toBe('important')
  })

  it('does not start an effect after disposal', async () => {
    const { registry } = createRegistry()
    registry[Symbol.dispose]()
    await Promise.resolve()
    expect(
      document.documentElement.style.getPropertyValue('--cursor-color')
    ).toBe('')
  })
})
