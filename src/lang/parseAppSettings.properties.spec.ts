import { join } from 'node:path'
import { parseAppSettings, serializeConfiguration } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fc from 'fast-check'
import { stringify } from 'smol-toml'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType

beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

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

// Property tests use the real Wasm parser, so they belong to the integration
// project (.spec.ts), even though the unit property command selects .test.ts.
describe('parseAppSettings properties', () => {
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
        expect(
          parseAppSettings(stringify(configuration), wasmInstance)
        ).toEqual(configuration)
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
          expect(
            parseAppSettings(stringify(configuration), wasmInstance)
          ).toEqual(configuration)
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
          expect(
            parseAppSettings(`[settings.app]\n${key} = ${value}`, wasmInstance)
          ).toEqual({ settings: { app: { stream_idle_mode: timeout } } })
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
            }),
            wasmInstance
          )
        ).toEqual({ settings: { plugins: { telemetry: false } } })
      }),
      propertyOptions
    )
  })

  it('keeps normalized settings stable through the production serializer', () => {
    fc.assert(
      fc.property(extensions, fc.boolean(), (other, telemetry) => {
        const parsed = parseAppSettings(
          stringify({
            settings: { app: other, plugins: { telemetry, ...other } },
          }),
          wasmInstance
        )
        if (parsed instanceof Error) throw parsed
        const serialized = serializeConfiguration(parsed, wasmInstance)
        if (serialized instanceof Error) throw serialized
        expect(parseAppSettings(serialized, wasmInstance)).toEqual(parsed)
      }),
      propertyOptions
    )
  })
})
