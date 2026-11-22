import type { ParsedArgs } from 'minimist'
import { getEmbeddedAppComposition } from '@src/registry/embeddedComposition'
import { loadAppCompositionFile } from '@src/registry/readAppComposition'
import type { AppStartupComposition } from '@src/registry/startupComposition'

/** A Desktop CLI manifest overrides the composition embedded by Vite. */
export function loadAppStartupComposition(
  args: ParsedArgs,
  workingDirectory: string
): AppStartupComposition | Error {
  const configPath: unknown = args['app-config']
  if (configPath === undefined) return getEmbeddedAppComposition()
  if (typeof configPath !== 'string' || configPath.trim() === '') {
    return new Error('Pass exactly one TOML file with --app-config <path>.')
  }
  return loadAppCompositionFile(configPath, workingDirectory, {
    interactionPerformanceEnabled:
      import.meta.env.VITE_INTERACTION_PERFORMANCE === '1',
  })
}
