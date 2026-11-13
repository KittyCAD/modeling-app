import { createSettings } from '@src/lib/settings/initialSettings'
import { describe, expect, it } from 'vitest'

describe('layout setting commands', () => {
  it('defaults the pane behavior command to the current preference', () => {
    const settings = createSettings()
    const preference = settings.layout.paneOpenBehavior
    const config = preference.commandConfig
    if (config?.inputType !== 'options') {
      throw new Error('Missing pane behavior options command')
    }
    const getDefault = config.defaultValueFromContext
    if (!getDefault) throw new Error('Missing pane behavior command default')

    expect(getDefault(settings)).toBe('multiple')

    preference.user = 'single'
    expect(getDefault(settings)).toBe('single')

    preference.user = undefined
    expect(getDefault(settings)).toBe('multiple')
  })
})
