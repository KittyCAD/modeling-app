import { isErr } from '@src/lib/trap'
import { isArray, isRecord } from '@src/lib/utils'
import { parse, stringify } from 'smol-toml'

/** A versioned app composition request, independent of extension code or settings. */
export interface AppManifest {
  readonly schemaVersion: 1
  readonly selection:
    | {
        readonly kind: 'preset'
        readonly base: 'zoo:default'
        readonly add: readonly string[]
        readonly exclude: readonly string[]
      }
    | { readonly kind: 'explicit'; readonly include: readonly string[] }
}

/** The host supplies bundled availability and the shell's mandatory entrypoints. */
export interface AppManifestCatalog {
  readonly availableIds: readonly string[]
  readonly defaultIds: readonly string[]
  readonly requiredIds: readonly string[]
}

/** An ordered selection only; resolving a manifest never imports or activates code. */
export interface ResolvedAppComposition {
  readonly extensionIds: readonly string[]
}

function unknownField(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string
): Error | undefined {
  const key = Object.keys(value).find((key) => !allowed.includes(key))
  return key === undefined
    ? undefined
    : new Error(`Unknown app manifest field: ${location}${key}`)
}

function parseIds(value: unknown, location: string): readonly string[] | Error {
  if (!isArray(value)) {
    return new Error(`${location} must be an array of extension IDs.`)
  }
  const ids: string[] = []
  for (const id of value) {
    if (
      typeof id !== 'string' ||
      !/^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9._-]*$/.test(id)
    ) {
      return new Error(
        `${location} must contain namespaced extension IDs, such as zoo:runtime.`
      )
    }
    if (ids.includes(id)) {
      return new Error(`Duplicate extension ID in ${location}: ${id}`)
    }
    ids.push(id)
  }
  return ids
}

/** Parse TOML at the boundary, preserving a typed distinction between selection modes. */
export function parseAppManifest(contents: string): AppManifest | Error {
  let document: unknown
  try {
    document = parse(contents)
  } catch (cause) {
    return new Error(
      `Unable to parse app manifest TOML: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    )
  }
  if (!isRecord(document))
    return new Error('An app manifest must be a TOML table.')
  const rootError = unknownField(
    document,
    ['schema-version', 'base', 'extensions'],
    ''
  )
  if (rootError) return rootError
  if (document['schema-version'] !== 1) {
    return new Error('App manifest schema-version must be 1.')
  }
  const extensions = document.extensions ?? {}
  if (!isRecord(extensions))
    return new Error('extensions must be a TOML table.')

  if (document.base !== undefined) {
    if (document.base !== 'zoo:default') {
      return new Error('The only supported app manifest base is zoo:default.')
    }
    const fieldError = unknownField(
      extensions,
      ['add', 'exclude'],
      'extensions.'
    )
    if (fieldError) return fieldError
    const add = parseIds(extensions.add ?? [], 'extensions.add')
    if (isErr(add)) return add
    const exclude = parseIds(extensions.exclude ?? [], 'extensions.exclude')
    if (isErr(exclude)) return exclude
    const conflict = add.find((id) => exclude.includes(id))
    if (conflict)
      return new Error(`Extension is both added and excluded: ${conflict}`)
    return {
      schemaVersion: 1,
      selection: { kind: 'preset', base: 'zoo:default', add, exclude },
    }
  }

  const fieldError = unknownField(extensions, ['include'], 'extensions.')
  if (fieldError) return fieldError
  const include = parseIds(extensions.include, 'extensions.include')
  if (isErr(include)) return include
  return { schemaVersion: 1, selection: { kind: 'explicit', include } }
}

/** Serialize canonical TOML; comments and input formatting are not retained. */
export function serializeAppManifest(manifest: AppManifest): string {
  const selection = manifest.selection
  return selection.kind === 'preset'
    ? stringify({
        'schema-version': manifest.schemaVersion,
        base: selection.base,
        extensions: {
          add: [...selection.add],
          exclude: [...selection.exclude],
        },
      })
    : stringify({
        'schema-version': manifest.schemaVersion,
        extensions: { include: [...selection.include] },
      })
}

/** Resolve against host metadata, without filesystem access or runtime service reads. */
export function resolveAppManifest(
  manifest: AppManifest,
  catalog: AppManifestCatalog
): ResolvedAppComposition | Error {
  const available = new Set(catalog.availableIds)
  const { selection } = manifest
  const requested =
    selection.kind === 'preset'
      ? [...catalog.defaultIds, ...selection.add, ...selection.exclude]
      : selection.include
  for (const id of [...requested, ...catalog.requiredIds]) {
    if (!available.has(id))
      return new Error(`Extension is not available in this app build: ${id}`)
  }
  const selected =
    selection.kind === 'preset'
      ? [...new Set([...catalog.defaultIds, ...selection.add])].filter(
          (id) => !selection.exclude.includes(id)
        )
      : [...selection.include]
  const missing = catalog.requiredIds.filter((id) => !selected.includes(id))
  if (missing.length > 0) {
    return new Error(
      `App composition is missing required extensions: ${missing.join(', ')}`
    )
  }
  return { extensionIds: selected }
}
