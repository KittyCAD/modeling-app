/* eslint-disable no-restricted-imports -- Shared with Vite before app aliases exist. */
import { isErr } from '../lib/trap'
import { isArray, isRecord } from '../lib/utils'
import { parse, stringify } from 'smol-toml'
import { posix } from '@chainner/node-path'

/** Omitted project/version select the configuration Project's own immutable version. */
export interface ProjectExtensionSource {
  readonly kind: 'project'
  readonly projectId?: string
  readonly versionId?: string
  readonly entrypoint: string
  readonly sha256?: string
}

/** A versioned app composition request, independent of extension code or settings. */
export interface AppManifest {
  readonly schemaVersion: 1
  readonly sources?: Readonly<Record<string, ProjectExtensionSource>>
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

function parseSources(
  value: unknown
): Readonly<Record<string, ProjectExtensionSource>> | Error {
  if (!isRecord(value))
    return new Error('sources must be a table of namespaced extension IDs.')
  const ids = parseIds(Object.keys(value), 'sources')
  if (isErr(ids)) return ids
  if (ids.length > 16)
    return new Error('At most 16 authored sources may be declared.')
  const sources: Record<string, ProjectExtensionSource> = {}
  for (const id of ids) {
    if (id.startsWith('zoo:'))
      return new Error(
        'Authored sources cannot use the reserved zoo: namespace.'
      )
    const entry = value[id]
    if (!isRecord(entry)) return new Error(`Invalid source: ${id}`)
    const unknown = unknownField(
      entry,
      ['kind', 'project_id', 'version_id', 'entrypoint', 'sha256'],
      `sources.${id}.`
    )
    if (unknown) return unknown
    if (
      entry.kind !== 'project' ||
      typeof entry.entrypoint !== 'string' ||
      entry.entrypoint.length > 4096 ||
      !/\.zds\.[jt]s$/i.test(entry.entrypoint) ||
      entry.entrypoint.includes('\\') ||
      entry.entrypoint.includes('\0') ||
      posix.isAbsolute(entry.entrypoint) ||
      /^[a-z]:/i.test(entry.entrypoint) ||
      posix.normalize(entry.entrypoint) !== entry.entrypoint ||
      entry.entrypoint.startsWith('../')
    )
      return new Error(
        `Source ${id} requires kind = "project" and a relative .zds.ts or .zds.js entrypoint.`
      )
    if (
      entry.project_id !== undefined &&
      (typeof entry.project_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          entry.project_id
        ))
    )
      return new Error(`Source ${id} requires a Project UUID.`)
    if (
      (entry.version_id !== undefined &&
        (typeof entry.version_id !== 'string' ||
          !entry.version_id.trim() ||
          entry.version_id.length > 256)) ||
      (entry.project_id !== undefined && entry.version_id === undefined)
    )
      return new Error(
        `Source ${id} requires an exact version_id when project_id is specified.`
      )
    if (
      entry.sha256 !== undefined &&
      (typeof entry.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(entry.sha256))
    )
      return new Error(`Source ${id} requires a hexadecimal SHA-256 digest.`)
    sources[id] = {
      kind: 'project',
      entrypoint: entry.entrypoint,
      ...(typeof entry.project_id === 'string'
        ? { projectId: entry.project_id }
        : {}),
      ...(typeof entry.version_id === 'string'
        ? { versionId: entry.version_id }
        : {}),
      ...(typeof entry.sha256 === 'string'
        ? { sha256: entry.sha256.toLowerCase() }
        : {}),
    }
  }
  return sources
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
    ['schema-version', 'base', 'extensions', 'sources'],
    ''
  )
  if (rootError) return rootError
  if (document['schema-version'] !== 1) {
    return new Error('App manifest schema-version must be 1.')
  }
  const sources = parseSources(document.sources ?? {})
  if (isErr(sources)) return sources
  const sourceFields = Object.keys(sources).length ? { sources } : {}
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
      ...sourceFields,
      selection: { kind: 'preset', base: 'zoo:default', add, exclude },
    }
  }

  const fieldError = unknownField(extensions, ['include'], 'extensions.')
  if (fieldError) return fieldError
  const include = parseIds(extensions.include, 'extensions.include')
  if (isErr(include)) return include
  return {
    schemaVersion: 1,
    ...sourceFields,
    selection: { kind: 'explicit', include },
  }
}

/** Serialize canonical TOML; comments and input formatting are not retained. */
export function serializeAppManifest(manifest: AppManifest): string {
  const selection = manifest.selection
  const sourceFields =
    manifest.sources && Object.keys(manifest.sources).length
      ? {
          sources: Object.fromEntries(
            Object.entries(manifest.sources).map(([id, source]) => [
              id,
              {
                kind: source.kind,
                entrypoint: source.entrypoint,
                ...(source.projectId ? { project_id: source.projectId } : {}),
                ...(source.versionId ? { version_id: source.versionId } : {}),
                ...(source.sha256 ? { sha256: source.sha256 } : {}),
              },
            ])
          ),
        }
      : {}
  return selection.kind === 'preset'
    ? stringify({
        'schema-version': manifest.schemaVersion,
        ...sourceFields,
        base: selection.base,
        extensions: {
          add: [...selection.add],
          exclude: [...selection.exclude],
        },
      })
    : stringify({
        'schema-version': manifest.schemaVersion,
        ...sourceFields,
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
