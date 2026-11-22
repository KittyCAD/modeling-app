import {
  parsePluginPreferences,
  serializePluginPreferences,
  type PluginPreferences,
} from '@src/lib/communityPlugins/persistence'
import { pluginStorageFixture } from '@src/lib/communityPlugins/testSupport'
import { requireSuccess } from '@src/lib/editors/testViews'
import fc from 'fast-check'
import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'

const id = '650c2238-e165-4707-b67d-045eebae7cdb'
const preferences = (contents = 'source'): PluginPreferences => ({
  version: 1,
  installations: [
    {
      id,
      pluginId: 'hello',
      name: 'Hello',
      enabled: true,
      source: { kind: 'snapshot', contents },
    },
  ],
  grants: [{ installationId: id, permissions: ['ui.notify'] }],
  settings: [],
})

describe('installed plugin preferences', () => {
  it('preserves exact snapshot text, including TOML delimiters and Unicode', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (source) => {
        const original = preferences(source)
        const serialized = serializePluginPreferences(original)
        const parsedToml = parseToml(serialized)
        expect(parsedToml.installations).toEqual([
          {
            id,
            plugin_id: 'hello',
            name: 'Hello',
            enabled: true,
            source: { kind: 'snapshot', contents: source },
          },
        ])
        expect(parsePluginPreferences(serialized)).toEqual(original)
      })
    )
  })

  it.each([
    'version = 2\ninstallations = []\ngrants = []',
    'version = 1\ninstallations = []\n[[grants]]\ninstallation_id = "missing"\npermissions = ["ui.notify"]',
    'broken = [',
  ])(
    'fails closed for unsupported or corrupt stored preferences',
    async (contents) => {
      const fixture = pluginStorageFixture(contents)
      expect(await fixture.storage.load()).toBeInstanceOf(Error)
      expect(fixture.contents).toBe(contents)
    }
  )

  it('rejects duplicate installation identities and unsupported grants', () => {
    const duplicate = preferences()
    expect(
      parsePluginPreferences(
        serializePluginPreferences({
          ...duplicate,
          installations: [
            ...duplicate.installations,
            ...duplicate.installations,
          ],
        })
      )
    ).toBeInstanceOf(Error)
    expect(
      parsePluginPreferences(
        serializePluginPreferences(duplicate).replace(
          'ui.notify',
          'network.request'
        )
      )
    ).toBeInstanceOf(Error)
  })

  it('detects stale writes without overwriting another window', async () => {
    const fixture = pluginStorageFixture()
    const first = requireSuccess(await fixture.storage.load())
    const second = requireSuccess(await fixture.storage.load())
    requireSuccess(
      await fixture.storage.save(preferences('first'), first.token)
    )
    expect(
      await fixture.storage.save(preferences('second'), second.token)
    ).toBeInstanceOf(Error)
    expect(
      requireSuccess(await fixture.storage.load()).preferences.installations[0]
        .source
    ).toEqual({ kind: 'snapshot', contents: 'first' })
  })
})
