import {
  acceptsSettingValue,
  declaredSettings,
  parseSettingsContribution,
  readPluginSetting,
} from '@src/lib/communityPlugins/settings/schema'
import { describe, expect, it } from 'vitest'

describe('community settings schemas', () => {
  const definition = {
    fields: {
      greeting: {
        type: 'string',
        title: 'Greeting',
        default: 'Hello',
        maxLength: 10,
      },
      enabled: { type: 'boolean', title: 'Enabled', default: true },
      count: { type: 'number', title: 'Count', default: 2, min: 0, max: 10 },
    },
  }
  const contributions = [{ kind: 'settings', definition }]

  it('reads defaults and preserves explicit false, zero, and empty string overrides', () => {
    expect(readPluginSetting(contributions, 'greeting')).toBe('Hello')
    expect(readPluginSetting(contributions, 'greeting', { greeting: '' })).toBe(
      ''
    )
    expect(
      readPluginSetting(contributions, 'enabled', { enabled: false })
    ).toBe(false)
    expect(readPluginSetting(contributions, 'count', { count: 0 })).toBe(0)
    expect(readPluginSetting(contributions, 'count', { count: 100 })).toBe(2)
    expect(
      readPluginSetting(contributions, 'greeting', { greeting: false })
    ).toBe('Hello')
  })

  it.each([
    'other.greeting',
    '../greeting',
    'constructor',
    '__proto__',
    'unknown',
  ])('rejects undeclared or nonlocal keys: %s', (key) => {
    expect(readPluginSetting(contributions, key)).toBeInstanceOf(Error)
  })

  it.each([
    { type: 'string', default: 5 },
    { type: 'string', default: 'too long', maxLength: 2 },
    { type: 'number', default: NaN },
    { type: 'number', default: 3, min: 10, max: 1 },
    { type: 'html', default: '<script>' },
    { type: 'boolean', default: false, scope: 'project' },
    { type: 'string', default: 'ok', Component: { callback: 0 } },
  ])(
    'rejects invalid defaults, unsupported fields, and executable UI: %j',
    (field) => {
      expect(
        parseSettingsContribution({
          fields: { field: { title: 'Field', ...field } },
        })
      ).toBeInstanceOf(Error)
    }
  )

  it('rejects duplicate declarations and validates persisted values against the current definition', () => {
    expect(
      declaredSettings([...contributions, ...contributions])
    ).toBeInstanceOf(Error)
    expect(
      acceptsSettingValue(
        { type: 'number', title: 'Count', default: 2, min: 0 },
        -1
      )
    ).toBe(false)
  })
})
