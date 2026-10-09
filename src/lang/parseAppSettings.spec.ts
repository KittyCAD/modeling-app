import { join } from 'node:path'
import { parseAppSettings } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType

beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

// These assertions characterize the Rust/JS boundary before desktop settings
// move to smol-toml. In particular, parsing includes schema-specific coercion.
describe('parseAppSettings', () => {
  it.each(['', '# comment only\n', '[settings]\n'])(
    'omits an empty settings object for %j',
    (toml) => {
      expect(parseAppSettings(toml, wasmInstance)).toEqual({})
    }
  )

  it('preserves explicitly empty nested sections without filling defaults', () => {
    expect(
      parseAppSettings(
        '[settings.app.appearance]\n[settings.modeling]\n[settings.project]\n',
        wasmInstance
      )
    ).toEqual({
      settings: { app: { appearance: {} }, modeling: {}, project: {} },
    })
  })

  it('drops unknown root keys but preserves unknown settings at every nested level', () => {
    expect(
      parseAppSettings(
        `outside = "ignored"
[settings]
custom = { enabled = false, values = [1, 2], nested = { name = "plugin" } }
[settings.app]
onboarding_status = "dismissed"
libraries = [{ title = "Projects", path = "/tmp/projects", type = "directory" }]
[settings.app.appearance]
theme = "dark"
contrast = 1.25
[settings.modeling]
base_unit = "mm"
highlight_edges = false
enable_ssao = false
show_scale_grid = false
fixed_size_grid = false
backface_color = "not a color"
snap_to_grid = true
[settings.project]
directory = ""
default_project_name = "untitled"
[settings.plugins]
telemetry = false
`,
        wasmInstance
      )
    ).toEqual({
      settings: {
        custom: { enabled: false, values: [1, 2], nested: { name: 'plugin' } },
        app: {
          onboarding_status: 'dismissed',
          libraries: [
            { title: 'Projects', path: '/tmp/projects', type: 'directory' },
          ],
          appearance: { theme: 'dark', contrast: 1.25 },
        },
        modeling: {
          base_unit: 'mm',
          highlight_edges: false,
          enable_ssao: false,
          show_scale_grid: false,
          fixed_size_grid: false,
          backface_color: 'not a color',
          snap_to_grid: true,
        },
        project: { directory: '', default_project_name: 'untitled' },
        plugins: { telemetry: false },
      },
    })
  })

  it.each(['stream_idle_mode', 'streamIdleMode'])(
    'normalizes legacy values and the key %s',
    (key) => {
      for (const [value, expected] of [
        ['0', 0],
        ['4294967295', 4294967295],
        ['"1234"', 1234],
        ['true', 300000],
        ['"invalid"', 300000],
        ['"-1"', 300000],
        ['"4294967296"', 300000],
        ['false', undefined],
        ['-1', undefined],
        ['4294967296', undefined],
        ['1.5', undefined],
        ['[]', undefined],
        ['{}', undefined],
      ]) {
        expect(
          parseAppSettings(`[settings.app]\n${key} = ${value}\n`, wasmInstance),
          `${key} = ${value}`
        ).toEqual({
          settings: {
            app: expected === undefined ? {} : { stream_idle_mode: expected },
          },
        })
      }
    }
  )

  it.each([
    'settings = false',
    '[settings]\napp = false',
    '[settings]\nmodeling = []',
    '[settings.app]\nappearance = "dark"',
    '[settings.app.appearance]\ntheme = "unknown"',
    '[settings.app.appearance]\ntheme = true',
    '[settings.modeling]\nbase_unit = "invalid"',
    '[settings.modeling]\ncamera_projection = "invalid"',
    '[settings.modeling]\ncamera_orbit = "invalid"',
    '[settings.modeling]\nhighlight_edges = "false"',
    '[settings.modeling]\nbackface_color = 123',
    'broken = [',
    '[settings.plugins]\ntelemetry = true\ntelemetry = false',
    '[settings.app]\nstream_idle_mode = 1\nstreamIdleMode = 2',
  ])('throws a string rather than returning Error for %j', (toml) => {
    let failure: unknown
    try {
      parseAppSettings(toml, wasmInstance)
    } catch (cause) {
      failure = cause
    }
    expect(typeof failure).toBe('string')
    expect(failure).toEqual(expect.stringContaining('TOML parse error'))
  })

  it('uses JSON serialization for TOML dates and non-finite numbers in extension settings', () => {
    expect(
      parseAppSettings(
        '[settings.plugins]\ncreated = 2024-01-01T00:00:00Z\nnan = nan\npositive = inf\nnegative = -inf\n',
        wasmInstance
      )
    ).toEqual({
      settings: {
        plugins: {
          created: { $__toml_private_datetime: '2024-01-01T00:00:00Z' },
          nan: null,
          positive: null,
          negative: null,
        },
      },
    })
  })
})
