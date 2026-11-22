import defaultExample from '@src/registry/fixtures/app-manifests/default.toml?raw'
import explicitExample from '@src/registry/fixtures/app-manifests/explicit.toml?raw'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import { isErr } from '@src/lib/trap'
import {
  parseAppManifest,
  resolveAppManifest,
  serializeAppManifest,
  type AppManifest,
  type AppManifestCatalog,
} from '@src/registry/appManifest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const catalog: AppManifestCatalog = {
  availableIds: ['zoo:runtime', 'zoo:publish', 'zoo:codeEditor', 'acme:tool'],
  defaultIds: ['zoo:runtime', 'zoo:publish', 'zoo:codeEditor'],
  requiredIds: ['zoo:runtime'],
}

function parseManifest(contents: string): AppManifest {
  const manifest = parseAppManifest(contents)
  if (isErr(manifest)) throw manifest
  return manifest
}

function resolve(contents: string) {
  return resolveAppManifest(parseManifest(contents), catalog)
}

describe('app manifest TOML', () => {
  it('resolves the checked-in examples against the default bundled composition', () => {
    const bundledCatalog = {
      availableIds: defaultRegistryItemIds,
      defaultIds: defaultRegistryItemIds,
      requiredIds: [],
    }
    expect(
      resolveAppManifest(parseManifest(defaultExample), bundledCatalog)
    ).toEqual({
      extensionIds: defaultRegistryItemIds.filter((id) => id !== 'zoo:publish'),
    })
    expect(
      resolveAppManifest(parseManifest(explicitExample), bundledCatalog)
    ).toEqual({
      extensionIds: defaultRegistryItemIds,
    })
  })

  it('normalizes a default preset with omitted adjustments', () => {
    expect(parseManifest('schema-version = 1\nbase = "zoo:default"')).toEqual({
      schemaVersion: 1,
      selection: { kind: 'preset', base: 'zoo:default', add: [], exclude: [] },
    })
  })

  it.each([
    ['', 'schema-version'],
    ['schema-version = 2', 'schema-version'],
    ['schema-version = "1"', 'schema-version'],
    ['schema-version = 1\nbase = "missing"', 'base'],
    ['schema-version = 1\nbase = "zoo:default"\nextra = true', 'extra'],
    ['schema-version = 1\nbase = "zoo:default"\nextensions = []', 'table'],
    [
      'schema-version = 1\nbase = "zoo:default"\n[extensions]\ninclude = []',
      'include',
    ],
    ['schema-version = 1\n[extensions]\nadd = []', 'add'],
    ['schema-version = 1', 'include'],
    ['schema-version = 1\n[extensions]\ninclude = "zoo:runtime"', 'array'],
    ['schema-version = 1\n[extensions]\ninclude = [1]', 'namespaced'],
    [
      'schema-version = 1\n[extensions]\ninclude = ["https://example.com/plugin.js"]',
      'namespaced',
    ],
    [
      'schema-version = 1\n[extensions]\ninclude = ["zoo:runtime", "zoo:runtime"]',
      'Duplicate',
    ],
    [
      'schema-version = 1\nbase = "zoo:default"\n[extensions]\nadd = ["acme:tool"]\nexclude = ["acme:tool"]',
      'both',
    ],
    ['schema-version = [', 'TOML'],
  ])('rejects malformed or ambiguous manifests: %s', (contents, message) => {
    const result = parseAppManifest(contents)
    expect(result).toBeInstanceOf(Error)
    if (isErr(result)) expect(result.message).toContain(message)
  })

  it('round-trips both modes across extension selections', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...catalog.availableIds)),
        (ids) => {
          const manifests: AppManifest[] = [
            { schemaVersion: 1, selection: { kind: 'explicit', include: ids } },
            {
              schemaVersion: 1,
              selection: {
                kind: 'preset',
                base: 'zoo:default',
                add: ids,
                exclude: [],
              },
            },
            {
              schemaVersion: 1,
              selection: {
                kind: 'preset',
                base: 'zoo:default',
                add: [],
                exclude: ids,
              },
            },
          ]
          for (const manifest of manifests) {
            expect(parseManifest(serializeAppManifest(manifest))).toEqual(
              manifest
            )
          }
        }
      )
    )
  })
})

describe('app manifest resolution', () => {
  it('retains default order, removes exclusions, and appends additions once', () => {
    expect(
      resolve(`
      schema-version = 1
      base = "zoo:default"
      [extensions]
      add = ["acme:tool", "zoo:codeEditor"]
      exclude = ["zoo:publish"]
    `)
    ).toEqual({ extensionIds: ['zoo:runtime', 'zoo:codeEditor', 'acme:tool'] })
  })

  it('preserves explicit order without implicitly adding defaults', () => {
    expect(
      resolve(
        'schema-version = 1\n[extensions]\ninclude = ["acme:tool", "zoo:runtime"]'
      )
    ).toEqual({ extensionIds: ['acme:tool', 'zoo:runtime'] })
  })

  it.each([
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nadd = ["acme:missing"]',
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["acme:missing"]',
    'schema-version = 1\n[extensions]\ninclude = ["acme:missing"]',
  ])('rejects unknown IDs, including exclusions', (contents) => {
    expect(resolve(contents)).toEqual(
      new Error('Extension is not available in this app build: acme:missing')
    )
  })

  it.each([
    'schema-version = 1\nbase = "zoo:default"\n[extensions]\nexclude = ["zoo:runtime"]',
    'schema-version = 1\n[extensions]\ninclude = []',
  ])('rejects removal of mandatory host extensions', (contents) => {
    expect(resolve(contents)).toEqual(
      new Error('App composition is missing required extensions: zoo:runtime')
    )
  })

  it('reports default IDs absent from the bundled catalog', () => {
    const manifest = parseManifest('schema-version = 1\nbase = "zoo:default"')
    expect(
      resolveAppManifest(manifest, { ...catalog, availableIds: [] })
    ).toBeInstanceOf(Error)
  })
})

it('preserves selection membership and order across preset adjustments', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.constantFrom(...catalog.availableIds)),
      fc.uniqueArray(fc.constantFrom<string>('zoo:publish', 'zoo:codeEditor')),
      (requestedAdditions, exclude) => {
        const add = requestedAdditions.filter((id) => !exclude.includes(id))
        const manifest: AppManifest = {
          schemaVersion: 1,
          selection: { kind: 'preset', base: 'zoo:default', add, exclude },
        }
        const expected = catalog.defaultIds.filter(
          (id) => !exclude.includes(id)
        )
        for (const id of add) {
          if (!expected.includes(id)) expected.push(id)
        }
        expect(resolveAppManifest(manifest, catalog)).toEqual({
          extensionIds: expected,
        })
      }
    )
  )
})

it('reports mandatory IDs absent from the bundled catalog', () => {
  const manifest = parseManifest(
    'schema-version = 1\n[extensions]\ninclude = ["zoo:runtime"]'
  )
  expect(
    resolveAppManifest(manifest, { ...catalog, requiredIds: ['acme:missing'] })
  ).toEqual(
    new Error('Extension is not available in this app build: acme:missing')
  )
})
