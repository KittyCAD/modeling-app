import { join } from 'node:path'
import {
  parseProjectSettings,
  serializeProjectConfiguration,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { projectConfigurationFromToml } from '@src/lib/settings/projectConfigurationFromToml'
import {
  defaultNamedView,
  defaultProjectConfiguration,
  viewId,
} from '@src/lib/settings/projectConfiguration.fixtures'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fc from 'fast-check'
import { parse as parseToml, stringify } from 'smol-toml'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

const propertyOptions = { numRuns: 100, seed: 20261005 }
const scalar = fc.oneof(fc.boolean(), fc.integer(), fc.string())
const extensions = fc.dictionary(
  fc.stringMatching(/^custom_[a-z]{1,12}$/),
  fc.oneof(
    scalar,
    fc.array(scalar, { maxLength: 5 }),
    fc.record({ enabled: fc.boolean(), label: fc.string() })
  ),
  { maxKeys: 5 }
)

describe('parseProjectSettings properties', () => {
  it('matches the smol-toml replacement across mixed metadata, views, and extension settings', () => {
    fc.assert(
      fc.property(
        extensions,
        fc.uuid(),
        fc.boolean(),
        fc.constantFrom('mm', 'cm', 'm', 'in', 'ft', 'yd'),
        fc.tuple(fc.integer(), fc.integer(), fc.integer()),
        (other, id, enabled, unit, position) => {
          const authored = id.toUpperCase()
          const toml = stringify({
            title: 'Ignored root metadata',
            settings: {
              ...other,
              meta: [authored],
              app: {
                ...other,
                stream_idle_mode: enabled,
                named_views: {
                  [authored]: {
                    name: 'Camera',
                    pivot_position: position,
                    is_ortho: enabled,
                    version: 0,
                    discarded: true,
                  },
                },
              },
              modeling: {
                ...other,
                base_unit: unit,
                highlight_edges: enabled,
                enable_ssao: enabled,
                fixed_size_grid: enabled,
              },
            },
            cloud: { 'zoo.dev': [authored], 'dev.zoo.dev': {} },
          })
          expect(
            projectConfigurationFromToml(
              parseToml(toml, { integersAsBigInt: false })
            )
          ).toEqual(parseProjectSettings(toml, wasmInstance))
        }
      ),
      propertyOptions
    )
  })

  it('preserves extension values at each flattening boundary', () => {
    fc.assert(
      fc.property(extensions, (other) => {
        const configuration = {
          settings: { ...other, meta: {}, app: other, modeling: other },
        }
        expect(
          parseProjectSettings(stringify(configuration), wasmInstance)
        ).toEqual(configuration)
      }),
      propertyOptions
    )
  })

  it('omits default booleans but preserves explicit units and optional grid values', () => {
    fc.assert(
      fc.property(
        fc.record({
          base_unit: fc.constantFrom('mm', 'cm', 'm', 'in', 'ft', 'yd'),
          highlight_edges: fc.boolean(),
          enable_ssao: fc.boolean(),
          fixed_size_grid: fc.boolean(),
          stream_idle_mode: fc.boolean(),
        }),
        ({ stream_idle_mode, ...modeling }) => {
          expect(
            parseProjectSettings(
              stringify({ settings: { app: { stream_idle_mode }, modeling } }),
              wasmInstance
            )
          ).toEqual({
            settings: {
              meta: {},
              app: stream_idle_mode ? { stream_idle_mode: true } : {},
              modeling: {
                base_unit: modeling.base_unit,
                fixed_size_grid: modeling.fixed_size_grid,
                ...(!modeling.highlight_edges
                  ? { highlight_edges: false }
                  : {}),
                ...(!modeling.enable_ssao ? { enable_ssao: false } : {}),
              },
            },
          })
        }
      ),
      propertyOptions
    )
  })

  it('normalizes project, cloud, and named-view UUIDs to hyphenated lowercase', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom('uppercase', 'simple', 'braced', 'urn'),
        (id, form) => {
          const authored =
            form === 'uppercase'
              ? id.toUpperCase()
              : form === 'simple'
                ? id.replaceAll('-', '')
                : form === 'braced'
                  ? `{${id}}`
                  : `urn:uuid:${id}`
          const configuration = {
            settings: {
              meta: { id: authored },
              app: { named_views: { [authored]: {} } },
            },
            cloud: { 'zoo.dev': { project_id: authored } },
          }
          expect(
            parseProjectSettings(stringify(configuration), wasmInstance)
          ).toEqual({
            settings: {
              meta: { id },
              app: { named_views: { [id]: defaultNamedView } },
              modeling: {},
            },
            cloud: { 'zoo.dev': { project_id: id } },
          })
        }
      ),
      propertyOptions
    )
  })

  it('preserves camera vectors and explicit named-view versions', () => {
    const coordinate = fc.double({
      min: -1e6,
      max: 1e6,
      noNaN: true,
      noDefaultInfinity: true,
    })
    fc.assert(
      fc.property(
        fc.tuple(coordinate, coordinate, coordinate),
        fc.tuple(coordinate, coordinate, coordinate, coordinate),
        fc.integer({ min: 0, max: 10 }),
        (position, rotation, version) => {
          const view = {
            ...defaultNamedView,
            pivot_position: position.map((value) => (value === 0 ? 0 : value)),
            pivot_rotation: rotation.map((value) => (value === 0 ? 0 : value)),
            version,
          }
          expect(
            parseProjectSettings(
              stringify({
                settings: { app: { named_views: { [viewId]: view } } },
              }),
              wasmInstance
            )
          ).toEqual({
            settings: {
              ...defaultProjectConfiguration.settings,
              app: { named_views: { [viewId]: view } },
            },
          })
        }
      ),
      propertyOptions
    )
  })

  it('keeps normalized settings stable through the production serializer', () => {
    fc.assert(
      fc.property(extensions, fc.uuid(), (other, id) => {
        const parsed = parseProjectSettings(
          stringify({
            settings: {
              meta: { id },
              app: other,
              modeling: other,
              plugins: other,
            },
            cloud: { 'zoo.dev': { project_id: id } },
          }),
          wasmInstance
        )
        if (parsed instanceof Error) throw parsed
        const serialized = serializeProjectConfiguration(parsed, wasmInstance)
        if (serialized instanceof Error) throw serialized
        expect(parseProjectSettings(serialized, wasmInstance)).toEqual(parsed)
      }),
      propertyOptions
    )
  })
})
