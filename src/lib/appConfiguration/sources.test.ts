import { describe, expect, it } from 'vitest'
import {
  parseAppManifest,
  serializeAppManifest,
} from '@src/registry/appManifest'
import { resolveDevAccountConfig } from '@src/lib/appConfiguration/devAccount'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import { requireSuccess } from '@src/lib/editors/testViews'

const logoManifest = `schema-version = 1
base = "zoo:default"
[extensions]
exclude = ["zoo:appLogo"]
add = ["personal:logo"]
[sources."personal:logo"]
kind = "project"
entrypoint = "personal-logo.zds.ts"
`

describe('configuration Project sources', () => {
  it('selects an authored source separately from the bundled host and round-trips its declaration', () => {
    const manifest = requireSuccess(parseAppManifest(logoManifest))
    expect(manifest.sources?.['personal:logo']).toEqual({
      kind: 'project',
      entrypoint: 'personal-logo.zds.ts',
    })
    const selection = requireSuccess(
      resolveDevAccountConfig(logoManifest, defaultRegistryItemIds)
    )
    expect(selection.sourceIds).toEqual(['personal:logo'])
    expect(selection.bundledIds).not.toContain('zoo:appLogo')
    expect(selection.bundledIds).toContain('zoo:auth')
    expect(parseAppManifest(serializeAppManifest(manifest))).toEqual(manifest)
  })
  it.each([
    ['personal:logo', 'kind = "url"\nentrypoint = "logo.zds.ts"'],
    ['zoo:auth', 'kind = "project"\nentrypoint = "logo.zds.ts"'],
    ['personal:logo', 'kind = "project"\nentrypoint = "../logo.zds.ts"'],
    ['personal:logo', 'kind = "project"\nentrypoint = "/logo.zds.ts"'],
    [
      'personal:logo',
      'kind = "project"\nentrypoint = "https://example.test/logo.zds.ts"',
    ],
    [
      'personal:logo',
      'kind = "project"\nentrypoint = "logo.zds.ts"\npermissions = ["ui.notify"]',
    ],
    [
      'personal:logo',
      'kind = "project"\nentrypoint = "logo.zds.ts"\nproject_id = "019a1111-2222-7333-8444-555555555555"',
    ],
    [
      'personal:logo',
      'kind = "project"\nentrypoint = "logo.zds.ts"\nsha256 = "bad"',
    ],
  ])('rejects an unsafe or ambiguous source: %s %s', (id, source) => {
    expect(
      parseAppManifest(
        `schema-version = 1\nbase = "zoo:default"\n[sources."${id}"]\n${source}`
      )
    ).toBeInstanceOf(Error)
  })
  it('accepts a pinned external Project and rejects selected sources without their host', () => {
    const contents =
      logoManifest +
      'project_id = "019a1111-2222-7333-8444-555555555555"\nversion_id = "version-2"\nsha256 = "' +
      'a'.repeat(64) +
      '"'
    const manifest = requireSuccess(parseAppManifest(contents))
    expect(manifest.sources?.['personal:logo'].versionId).toBe('version-2')
    expect(parseAppManifest(serializeAppManifest(manifest))).toEqual(manifest)
    expect(
      resolveDevAccountConfig(
        logoManifest.replace(
          'exclude = ["zoo:appLogo"]',
          'exclude = ["zoo:appLogo", "zoo:communityPlugins"]'
        ),
        defaultRegistryItemIds
      )
    ).toBeInstanceOf(Error)
  })
})
