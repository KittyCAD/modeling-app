import fs from 'node:fs'
import path from 'node:path'
import type { ParsedArgs } from 'minimist'
import { isErr } from '@src/lib/trap'
import { parseAppManifest, resolveAppManifest } from '@src/registry/appManifest'
import {
  bundledRegistryItemMetadata,
  isBundledRegistryItemId,
  type BundledRegistryItemId,
} from '@src/registry/catalogMetadata'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import type { AppStartupComposition } from '@src/registry/startupComposition'

/** Disk access belongs to main; no manifest can name a module path or URL. */
export function loadAppStartupComposition(
  args: ParsedArgs,
  workingDirectory: string
): AppStartupComposition | Error {
  const configPath: unknown = args['app-config']
  if (configPath === undefined)
    return { registryItemIds: [...defaultRegistryItemIds] }
  if (typeof configPath !== 'string' || configPath.trim() === '') {
    return new Error('Pass exactly one TOML file with --app-config <path>.')
  }
  const absolutePath = path.resolve(workingDirectory, configPath)
  let contents: string
  try {
    contents = fs.readFileSync(absolutePath, 'utf8')
  } catch (cause) {
    return new Error(
      `Cannot read app configuration ${absolutePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    )
  }
  const manifest = parseAppManifest(contents)
  if (isErr(manifest))
    return new Error(
      `Invalid app configuration ${absolutePath}: ${manifest.message}`,
      { cause: manifest }
    )
  const resolved = resolveAppManifest(manifest, {
    availableIds: Object.keys(bundledRegistryItemMetadata),
    defaultIds: defaultRegistryItemIds,
    requiredIds: Object.entries(bundledRegistryItemMetadata)
      .filter(([, metadata]) => metadata.requiredForStartup)
      .map(([id]) => id),
  })
  if (isErr(resolved))
    return new Error(
      `Invalid app configuration ${absolutePath}: ${resolved.message}`,
      { cause: resolved }
    )
  const registryItemIds: BundledRegistryItemId[] = []
  for (const id of resolved.extensionIds) {
    if (!isBundledRegistryItemId(id))
      return new Error(`Unknown bundled extension: ${id}`)
    registryItemIds.push(id)
  }
  return { registryItemIds }
}
