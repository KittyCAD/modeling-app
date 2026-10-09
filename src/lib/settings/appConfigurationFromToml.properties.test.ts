import { appConfigurationFromToml } from '@src/lib/settings/appConfigurationFromToml'
import fc from 'fast-check'
import { parse as parseToml, stringify } from 'smol-toml'
import { describe, expect, it } from 'vitest'

function parseAppSettings(toml: string) {
  const configuration = appConfigurationFromToml(
    parseToml(toml, { integersAsBigInt: false })
  )
  if (configuration instanceof Error) throw configuration
  return configuration
}

const propertyOptions = { numRuns: 100, seed: 20261005 }
const scalar = fc.oneof(fc.boolean(), fc.integer(), fc.string())
const extensionValue = fc.oneof(
  scalar,
  fc.array(scalar, { maxLength: 5 }),
  fc.record({ enabled: fc.boolean(), label: fc.string() })
)
const extensions = fc.dictionary(
  fc.stringMatching(/^custom_[a-z]{1,12}$/),
  extensionValue,
  { maxKeys: 5 }
)

describe('appConfigurationFromToml properties', () => {
  it('preserves extension values across all four flattening boundaries', () => {
    fc.assert(
      fc.property(extensions, (other) => {
        const configuration = {
          settings: {
            ...other,
            app: { ...other, appearance: { ...other } },
            modeling: { ...other },
          },
        }
        expect(parseAppSettings(stringify(configuration))).toEqual(
          configuration
        )
      }),
      propertyOptions
    )
  })

  it('preserves explicit recognized values, including false and default enum values', () => {
    fc.assert(
      fc.property(
        fc.record({
          theme: fc.constantFrom('light', 'dark', 'system'),
          base_unit: fc.constantFrom('mm', 'cm', 'm', 'in', 'ft', 'yd'),
          camera_projection: fc.constantFrom('perspective', 'orthographic'),
          camera_orbit: fc.constantFrom('spherical', 'trackball'),
          highlight_edges: fc.boolean(),
          enable_ssao: fc.boolean(),
          show_scale_grid: fc.boolean(),
          fixed_size_grid: fc.boolean(),
          backface_color: fc.string(),
        }),
        ({ theme, ...modeling }) => {
          const configuration = {
            settings: { app: { appearance: { theme } }, modeling },
          }
          expect(parseAppSettings(stringify(configuration))).toEqual(
            configuration
          )
        }
      ),
      propertyOptions
    )
  })

  it('normalizes both timeout keys and numeric strings throughout the u32 range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4294967295 }),
        fc.constantFrom('stream_idle_mode', 'streamIdleMode'),
        fc.boolean(),
        (timeout, key, asString) => {
          const value = asString ? `"${timeout}"` : `${timeout}`
          expect(parseAppSettings(`[settings.app]\n${key} = ${value}`)).toEqual(
            { settings: { app: { stream_idle_mode: timeout } } }
          )
        }
      ),
      propertyOptions
    )
  })

  it('ignores arbitrary unknown root values without changing settings', () => {
    fc.assert(
      fc.property(extensions, (other) => {
        expect(
          parseAppSettings(
            stringify({
              ...other,
              settings: { plugins: { telemetry: false } },
            })
          )
        ).toEqual({ settings: { plugins: { telemetry: false } } })
      }),
      propertyOptions
    )
  })

  it('keeps normalized settings stable through TOML serialization', () => {
    fc.assert(
      fc.property(extensions, fc.boolean(), (other, telemetry) => {
        const parsed = parseAppSettings(
          stringify({
            settings: { app: other, plugins: { telemetry, ...other } },
          })
        )
        const serialized = stringify(parsed)
        expect(parseAppSettings(serialized)).toEqual(parsed)
      }),
      propertyOptions
    )
  })
})
