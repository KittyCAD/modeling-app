import { join } from 'node:path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import {
  settingsCloudId,
  settingsLoadingFiles,
  settingsProjectFile,
  settingsProjectId,
  settingsProjectPath,
} from '@src/lib/settings/settingsLoading.fixtures'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fc from 'fast-check'
import { parse as parseToml, stringify } from 'smol-toml'
import { validate as validateUuid } from 'uuid'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

let wasmInstance: ModuleType
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})
beforeEach(() => {
  vi.spyOn(fsZds, 'getPath').mockResolvedValue('/settings-test')
})
afterEach(() => vi.restoreAllMocks())

function writtenProject(contents: Map<string, string>) {
  const toml = contents.get(settingsProjectFile)
  if (toml === undefined) throw new Error('Expected a persisted project.toml')
  return parseToml(toml, { integersAsBigInt: false })
}

describe('loadAndValidateSettings project ID initialization', () => {
  it('backfills a UUID while preserving project metadata, extensions, and settings precedence', async () => {
    const fixture = await settingsLoadingFiles(`title = "Named project"
default_file = "src/main.kcl"
custom_root = { enabled = false }
[settings.app.appearance]
theme = "light"
[settings.modeling]
base_unit = "cm"
highlight_edges = false
enable_ssao = true
[settings.plugins]
telemetry = false
[cloud."zoo.dev"]
project_id = "${settingsCloudId}"
`)
    const result = await loadAndValidateSettings(
      fixture.files,
      wasmInstance,
      settingsProjectPath
    )

    expect(result.settings.app.theme.current).toBe('dark')
    expect(result.settings.modeling.defaultUnit.current).toBe('cm')
    expect(result.settings.modeling.highlightEdges.current).toBe(false)
    expect(result.configuration.settings?.modeling?.base_unit).toBe('ft')
    const written = writtenProject(fixture.contents)
    expect(written).toMatchObject({
      title: 'Named project',
      default_file: 'src/main.kcl',
      custom_root: { enabled: false },
      settings: {
        app: { appearance: { theme: 'light' } },
        modeling: { base_unit: 'cm', highlight_edges: false },
        plugins: { telemetry: false },
      },
      cloud: { 'zoo.dev': { project_id: settingsCloudId } },
    })
    const meta = written.settings
    expect(meta).toMatchObject({ meta: { id: expect.any(String) } })
    expect(JSON.stringify(written)).not.toContain('enable_ssao')
    expect(fixture.files.writeFile).toHaveBeenCalledOnce()
  })

  it('keeps an existing UUID and leaves the original file untouched', async () => {
    const original = `# retain this comment\ntitle = "Project"\n[settings.meta]\nid = "${settingsProjectId}"`
    const fixture = await settingsLoadingFiles(original)
    await loadAndValidateSettings(fixture.files, wasmInstance, {
      projectPath: settingsProjectPath,
    })
    expect(fixture.files.writeFile).not.toHaveBeenCalled()
    expect(fixture.contents.get(settingsProjectFile)).toBe(original)
  })

  it.each([
    undefined,
    '',
    '[settings.meta]\nid = "00000000-0000-0000-0000-000000000000"',
  ])(
    'creates a stable UUID for an absent, empty, or nil-ID project: %j',
    async (toml) => {
      const fixture = await settingsLoadingFiles(toml)
      await loadAndValidateSettings(
        fixture.files,
        wasmInstance,
        settingsProjectPath
      )
      const written = writtenProject(fixture.contents)
      const serialized = fixture.contents.get(settingsProjectFile)
      expect(written).toMatchObject({
        settings: { meta: { id: expect.any(String) }, app: {}, modeling: {} },
      })
      const idMatch = serialized?.match(/id = "([^"]+)"/)
      expect(validateUuid(idMatch?.[1] ?? '')).toBe(true)
      expect(idMatch?.[1]).not.toBe('00000000-0000-0000-0000-000000000000')
      await loadAndValidateSettings(
        fixture.files,
        wasmInstance,
        settingsProjectPath
      )
      expect(fixture.contents.get(settingsProjectFile)).toBe(serialized)
      expect(fixture.files.writeFile).toHaveBeenCalledOnce()
    }
  )

  it('persists the existing TOML-to-JSON representation of extension dates', async () => {
    const fixture = await settingsLoadingFiles(
      '[settings.plugins]\ncreated = 2024-01-01T00:00:00Z'
    )
    await loadAndValidateSettings(
      fixture.files,
      wasmInstance,
      settingsProjectPath
    )
    expect(writtenProject(fixture.contents)).toMatchObject({
      settings: {
        plugins: {
          created: { $__toml_private_datetime: '2024-01-01T00:00:00Z' },
        },
      },
    })
  })

  it('rejects unrepresentable extension values without silently dropping them or writing', async () => {
    const original = '[settings.plugins]\nvalue = nan'
    const fixture = await settingsLoadingFiles(original)
    await expect(
      loadAndValidateSettings(fixture.files, wasmInstance, settingsProjectPath)
    ).rejects.toThrow('Could not serialize project configuration')
    expect(fixture.files.writeFile).not.toHaveBeenCalled()
    expect(fixture.contents.get(settingsProjectFile)).toBe(original)
  })

  it('rejects malformed project settings without rewriting them', async () => {
    const fixture = await settingsLoadingFiles('broken = [')
    await expect(
      loadAndValidateSettings(fixture.files, wasmInstance, settingsProjectPath)
    ).rejects.toThrow()
    expect(fixture.files.writeFile).not.toHaveBeenCalled()
  })

  it('propagates project read failures', async () => {
    const fixture = await settingsLoadingFiles('')
    const failure = new Error('EACCES')
    fixture.faults.read = failure
    await expect(
      loadAndValidateSettings(fixture.files, wasmInstance, settingsProjectPath)
    ).rejects.toBe(failure)
    expect(fixture.files.writeFile).not.toHaveBeenCalled()
  })

  it('propagates persistence failures without changing the file', async () => {
    const fixture = await settingsLoadingFiles('')
    const failure = new Error('Disk full')
    fixture.faults.write = failure
    await expect(
      loadAndValidateSettings(fixture.files, wasmInstance, settingsProjectPath)
    ).rejects.toBe(failure)
    expect(fixture.contents.get(settingsProjectFile)).toBe('')
  })

  it('preserves generated metadata and extension values through backfill and a second load', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.boolean(),
        fc.integer(),
        async (title, enabled, count) => {
          const fixture = await settingsLoadingFiles(
            stringify({
              title,
              default_file: 'main.kcl',
              settings: { plugins: { enabled, count } },
              cloud: { 'zoo.dev': { project_id: settingsCloudId } },
            })
          )
          await loadAndValidateSettings(
            fixture.files,
            wasmInstance,
            settingsProjectPath
          )
          const first = fixture.contents.get(settingsProjectFile)
          expect(writtenProject(fixture.contents)).toMatchObject({
            title,
            default_file: 'main.kcl',
            settings: { plugins: { enabled, count } },
            cloud: { 'zoo.dev': { project_id: settingsCloudId } },
          })
          await loadAndValidateSettings(
            fixture.files,
            wasmInstance,
            settingsProjectPath
          )
          expect(fixture.contents.get(settingsProjectFile)).toBe(first)
          expect(fixture.files.writeFile).toHaveBeenCalledOnce()
        }
      ),
      { numRuns: 100, seed: 20261005 }
    )
  })
})
