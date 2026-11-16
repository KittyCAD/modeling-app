import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getAppCompositionDefine } from '@root/vite.appManifest'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-app-manifest-'))
let index = 0
function fixture() {
  const root = path.join(directory, String(index++))
  fs.mkdirSync(root)
  return root
}
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
beforeEach(() => {
  vi.stubEnv('ZOO_APP_CONFIG', undefined)
  vi.stubEnv('VITE_INTERACTION_PERFORMANCE', undefined)
})
afterEach(() => vi.unstubAllEnvs())

const compact =
  '# private-file-comment\nschema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:commandBar", "zoo:slicer"]'

describe('Vite app manifest definition', () => {
  it('embeds the existing default selection without configuration', async () => {
    expect(await getAppCompositionDefine('development', fixture())).toEqual({
      __APP_STARTUP_COMPOSITION__: JSON.stringify({
        registryItemIds: defaultRegistryItemIds,
      }),
    })
  })

  it('resolves a host-only path without embedding the path or raw contents', async () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'app config.toml'), compact)
    vi.stubEnv('ZOO_APP_CONFIG', 'app config.toml')
    const define = await getAppCompositionDefine('development', root)
    expect(JSON.parse(define.__APP_STARTUP_COMPOSITION__)).toEqual({
      registryItemIds: defaultRegistryItemIds.filter(
        (id) => id !== 'zoo:commandBar' && id !== 'zoo:slicer'
      ),
    })
    expect(JSON.stringify(define)).not.toContain(root)
    expect(JSON.stringify(define)).not.toContain('private-file-comment')
  })

  it('reads the path from the selected mode env file', async () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'compact.toml'), compact)
    fs.writeFileSync(
      path.join(root, '.env.production'),
      'ZOO_APP_CONFIG=compact.toml'
    )
    const production = await getAppCompositionDefine('production', root)
    expect(production.__APP_STARTUP_COMPOSITION__).not.toContain(
      'zoo:commandBar'
    )
    const development = await getAppCompositionDefine('development', root)
    expect(development.__APP_STARTUP_COMPOSITION__).toContain('zoo:commandBar')
  })

  it('lets an explicit environment variable override the env file', async () => {
    const root = fixture()
    fs.writeFileSync(
      path.join(root, '.env.development'),
      'ZOO_APP_CONFIG=missing.toml'
    )
    fs.writeFileSync(path.join(root, 'compact.toml'), compact)
    vi.stubEnv('ZOO_APP_CONFIG', path.join(root, 'compact.toml'))
    await expect(
      getAppCompositionDefine('development', root)
    ).resolves.toHaveProperty('__APP_STARTUP_COMPOSITION__')
  })

  it.each(['', 'missing.toml'])(
    'rejects an unreadable or empty configured path: %s',
    async (filename) => {
      vi.stubEnv('ZOO_APP_CONFIG', filename)
      await expect(
        getAppCompositionDefine('development', fixture())
      ).rejects.toBeInstanceOf(Error)
    }
  )

  it.each([
    'schema-version = 9',
    'schema-version = [',
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:settings"]',
  ])(
    'rejects an invalid manifest before app modules are served',
    async (contents) => {
      const root = fixture()
      fs.writeFileSync(path.join(root, 'bad.toml'), contents)
      vi.stubEnv('ZOO_APP_CONFIG', 'bad.toml')
      await expect(
        getAppCompositionDefine('development', root)
      ).rejects.toThrow('Invalid app configuration')
    }
  )

  it('applies instrumentation requirements from the build environment', async () => {
    const root = fixture()
    fs.writeFileSync(
      path.join(root, 'app.toml'),
      'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:interactionPerformance"]'
    )
    fs.writeFileSync(
      path.join(root, '.env.development'),
      'ZOO_APP_CONFIG=app.toml\nVITE_INTERACTION_PERFORMANCE=1'
    )
    await expect(getAppCompositionDefine('development', root)).rejects.toThrow(
      'zoo:interactionPerformance'
    )
  })
})
