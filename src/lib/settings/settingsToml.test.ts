import {
  type AnySetting,
  booleanSetting,
  optionsSetting,
} from '@src/contracts/settings'
import {
  decodeSettingsToml,
  encodeSettingsToml,
} from '@src/lib/settings/settingsToml'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

const theme = optionsSetting({
  id: 'appearance.theme',
  section: 'appearance',
  title: 'Theme',
  defaultValue: 'system',
  toml: ['settings', 'app', 'appearance', 'theme'],
  options: [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ],
})

const highlightEdges = booleanSetting({
  id: 'modeling.highlightEdges',
  section: 'modeling',
  title: 'Highlight edges',
  defaultValue: true,
  toml: ['settings', 'modeling', 'highlight_edges'],
})

const definitions: AnySetting[] = [theme, highlightEdges]

describe('decodeSettingsToml', () => {
  it('reads values from the nested tables the schema describes', () => {
    const decoded = decodeSettingsToml(
      `[settings.app.appearance]
theme = "dark"

[settings.modeling]
highlight_edges = false
`,
      definitions
    )

    expect(decoded.overrides).toEqual({
      'appearance.theme': 'dark',
      'modeling.highlightEdges': false,
    })
    expect(decoded.rejected).toEqual([])
  })

  it('leaves an unset setting absent rather than defaulting it', () => {
    const decoded = decodeSettingsToml('[settings.modeling]\n', definitions)
    expect('modeling.highlightEdges' in decoded.overrides).toBe(false)
  })

  it('rejects one bad value without losing the others', () => {
    const decoded = decodeSettingsToml(
      `[settings.app.appearance]
theme = "solarized"

[settings.modeling]
highlight_edges = true
`,
      definitions
    )

    expect(decoded.overrides).toEqual({ 'modeling.highlightEdges': true })
    expect(decoded.rejected).toEqual(['appearance.theme'])
  })

  it('ignores keys it does not own', () => {
    const decoded = decodeSettingsToml(
      `[settings.meta]
id = "9f1c"

[cloud."zoo.dev"]
project_id = "abc"
`,
      definitions
    )
    expect(decoded.overrides).toEqual({})
  })
})

describe('encodeSettingsToml', () => {
  it('round trips through decode', () => {
    const text = encodeSettingsToml(null, definitions, {
      'appearance.theme': 'light',
      'modeling.highlightEdges': false,
    })

    expect(decodeSettingsToml(text, definitions).overrides).toEqual({
      'appearance.theme': 'light',
      'modeling.highlightEdges': false,
    })
  })

  it('preserves keys it does not own', () => {
    const text = encodeSettingsToml(
      `[settings.meta]
id = "9f1c"

[cloud."zoo.dev"]
project_id = "abc"
`,
      definitions,
      { 'modeling.highlightEdges': false }
    )

    const table = parse(text) as Record<string, any>
    expect(table.settings.meta.id).toBe('9f1c')
    expect(table.cloud['zoo.dev'].project_id).toBe('abc')
    expect(table.settings.modeling.highlight_edges).toBe(false)
  })

  it('removes a cleared override and the table it emptied', () => {
    const text = encodeSettingsToml(
      `[settings.app.appearance]
theme = "dark"
`,
      definitions,
      {}
    )

    const table = parse(text) as Record<string, any>
    expect(table.settings).toBeUndefined()
  })

  it('keeps a table that still holds keys it does not own', () => {
    const text = encodeSettingsToml(
      `[settings.modeling]
highlight_edges = false
base_unit = "in"
`,
      definitions,
      {}
    )

    const table = parse(text) as Record<string, any>
    expect(table.settings.modeling).toEqual({ base_unit: 'in' })
  })

  it('refuses to overwrite a file it cannot parse', () => {
    expect(() =>
      encodeSettingsToml('this is not = = toml', definitions, {})
    ).toThrow()
  })
})
