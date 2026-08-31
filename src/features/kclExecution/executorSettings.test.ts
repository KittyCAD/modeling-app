import { describe, expect, it } from 'vitest'
import { executorSettingsJson } from '@src/features/kclExecution/executorSettings'

const values = {
  highlightEdges: true,
  enableSsao: false,
  showScaleGrid: true,
  baseUnit: 'in',
}

const parse = (json: string) =>
  JSON.parse(json) as { settings?: { modeling?: Record<string, unknown> } }

describe('the configuration KCL executes against', () => {
  it('writes the preferences kcl-lib reads, in the schema’s own names', () => {
    const settings = parse(executorSettingsJson({}, values)).settings?.modeling

    expect(settings).toEqual({
      base_unit: 'in',
      highlight_edges: true,
      enable_ssao: false,
      show_scale_grid: true,
    })
  })

  /*
   * The one setting here that changes the geometry rather than how it is drawn: a
   * file with no `@settings` annotation is measured in whatever this says.
   */
  it('carries the base unit, which decides what an unsuffixed number means', () => {
    const settings = parse(
      executorSettingsJson({}, { ...values, baseUnit: 'yd' })
    ).settings?.modeling

    expect(settings?.base_unit).toBe('yd')
  })

  /*
   * Built from the WASM defaults rather than from `{}`, so fields this app has no
   * setting for keep whatever kcl-lib considers correct.
   */
  it('keeps every default it does not have an opinion about', () => {
    const defaults = {
      settings: {
        modeling: { backface_color: '#00D5FF' },
        app: { theme: 'dark' },
      },
    }

    const result = parse(executorSettingsJson(defaults, values))

    expect(result.settings?.modeling?.backface_color).toBe('#00D5FF')
    expect((result.settings as { app?: { theme?: string } }).app?.theme).toBe(
      'dark'
    )
  })

  it('survives defaults that are not an object at all', () => {
    // What a WASM call that failed hands back. A configuration is still wanted.
    expect(
      parse(executorSettingsJson(null, values)).settings?.modeling
    ).toEqual({
      base_unit: 'in',
      highlight_edges: true,
      enable_ssao: false,
      show_scale_grid: true,
    })
  })
})
