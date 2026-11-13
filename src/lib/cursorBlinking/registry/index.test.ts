import { signal } from '@preact/signals-core'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import {
  extension as defineExtension,
  provide,
  Registry,
  type Extension,
} from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'
import cursorBlinking from '.'

async function createRegistry() {
  const current = signal(createSettings())
  // This consumer needs only reactive settings, without an actor or editor.
  const service = { current } as SettingsRegistryService
  const registry = new Registry()
  await registry.configure([
    cursorBlinking,
    defineExtension({
      create: () => ({
        items: [provide(settingsService, service)],
      }),
    }) satisfies Extension,
  ])
  registry.required(settingsService)
  return { registry, current }
}

afterEach(() => {
  document.documentElement.style.removeProperty('--cursor-color')
})

describe('global cursor blinking', () => {
  it('applies settings at the document root without an editor', async () => {
    const { registry, current } = await createRegistry()
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
      await registry.dispose()
    }
  })

  it('stops updates and restores the previous style when disposed', async () => {
    const style = document.documentElement.style
    style.setProperty('--cursor-color', 'red', 'important')
    const { registry, current } = await createRegistry()
    await Promise.resolve()
    await registry.dispose()
    current.value.textEditor.blinkingCursor.user = false
    expect(style.getPropertyValue('--cursor-color')).toBe('red')
    expect(style.getPropertyPriority('--cursor-color')).toBe('important')
  })
  it('does not start a deferred effect after acquisition rolls back', async () => {
    const registry = new Registry()
    const failure = new Error('Later acquisition failed')
    await expect(
      registry.configure([
        cursorBlinking,
        defineExtension({
          create: () => {
            throw failure
          },
        }),
      ])
    ).rejects.toBe(failure)
    const current = signal(createSettings())
    current.value.textEditor.blinkingCursor.user = false
    await registry.configure([
      provide(settingsService, { current } as SettingsRegistryService),
    ])
    expect(
      document.documentElement.style.getPropertyValue('--cursor-color')
    ).toBe('')
    await registry.dispose()
  })
})
