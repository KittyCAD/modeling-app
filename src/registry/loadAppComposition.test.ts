import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCLIArgs } from '@src/commandLineArgs'
import { isErr } from '@src/lib/trap'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import { loadAppStartupComposition } from '@src/registry/loadAppComposition'
import { selectElectronPlugins } from '@src/registry/electronPlugins'
import { afterAll, describe, expect, it } from 'vitest'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'app-composition-'))
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

function load(contents: string) {
  const filename = 'app config.toml'
  fs.writeFileSync(path.join(directory, filename), contents)
  return loadAppStartupComposition(
    parseCLIArgs(['electron', '--app-config', filename]),
    directory
  )
}

describe('disk app configuration', () => {
  it('keeps performance recording mandatory when this build enables it', () => {
    const result = load(
      'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:interactionPerformance"]'
    )
    if (import.meta.env.VITE_INTERACTION_PERFORMANCE === '1') {
      expect(result).toBeInstanceOf(Error)
    } else {
      expect(result).toEqual({
        registryItemIds: defaultRegistryItemIds.filter(
          (id) => id !== 'zoo:interactionPerformance'
        ),
      })
    }
  })

  it('preserves the current composition when no config was supplied', () => {
    expect(
      loadAppStartupComposition(parseCLIArgs(['electron']), directory)
    ).toEqual({ registryItemIds: defaultRegistryItemIds })
  })

  it('reads a relative path with spaces against the launch directory', () => {
    const result = load(
      'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:commandBar", "zoo:slicer"]'
    )
    expect(result).toEqual({
      registryItemIds: defaultRegistryItemIds.filter(
        (id) => id !== 'zoo:commandBar' && id !== 'zoo:slicer'
      ),
    })
    if (isErr(result)) throw result
    expect(selectElectronPlugins(result.registryItemIds)).toEqual([])
  })

  it('keeps both native slicer entrypoints in the default composition', () => {
    expect(
      selectElectronPlugins(defaultRegistryItemIds).map(
        (plugin) => plugin.pluginId
      )
    ).toEqual(['slicer', 'slicer'])
  })

  it.each([
    ['--app-config'],
    ['--app-config='],
    ['--app-config', 'a.toml', '--app-config', 'b.toml'],
  ])('rejects empty or repeated configuration paths: %s', (...flags) => {
    expect(
      loadAppStartupComposition(parseCLIArgs(['electron', ...flags]), directory)
    ).toEqual(new Error('Pass exactly one TOML file with --app-config <path>.'))
  })

  it('reports missing files with their resolved path', () => {
    const missing = path.join(directory, 'missing.toml')
    const result = loadAppStartupComposition(
      parseCLIArgs(['electron', `--app-config=${missing}`]),
      directory
    )
    expect(result).toBeInstanceOf(Error)
    if (isErr(result)) expect(result.message).toContain(missing)
  })

  it.each([
    'not TOML [',
    'schema-version = 9',
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nadd = ["acme:unknown"]',
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:settings"]',
  ])(
    'rejects invalid configurations without falling back to defaults',
    (contents) => {
      const result = load(contents)
      expect(result).toBeInstanceOf(Error)
      if (isErr(result))
        expect(result.message).toContain(
          path.join(directory, 'app config.toml')
        )
    }
  )
})
