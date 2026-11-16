/* eslint-disable no-restricted-imports -- Vite loads this boundary before app aliases exist. */
import fs from 'node:fs'
import path from 'node:path'
import { isErr } from '../lib/trap'
import { parseAppManifest, resolveAppManifest } from './appManifest'
import {
  bundledRegistryItemMetadata,
  getRequiredRegistryItemIds,
  isBundledRegistryItemId,
  type BundledRegistryItemId,
} from './catalogMetadata'
import { defaultRegistryItemIds } from './defaultComposition'
import type { AppStartupComposition } from './startupComposition'

/** Shared disk boundary for Vite configuration and Desktop command-line overrides. */
export function loadAppCompositionFile(
  configPath: string,
  workingDirectory: string,
  {
    interactionPerformanceEnabled = false,
  }: { interactionPerformanceEnabled?: boolean } = {}
): AppStartupComposition | Error {
  if (configPath.trim() === '') {
    return new Error('App configuration path must name a TOML file.')
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
    requiredIds: getRequiredRegistryItemIds(interactionPerformanceEnabled),
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
