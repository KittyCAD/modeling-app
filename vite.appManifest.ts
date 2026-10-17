import { loadEnv } from 'vite'
import { loadAppCompositionFile } from './src/registry/readAppComposition'
import { defaultRegistryItemIds } from './src/registry/defaultComposition'

/** Read the host-only config path before serving or building any app modules. */
export async function getAppCompositionDefine(
  mode: string,
  root = process.cwd()
): Promise<Record<string, string>> {
  const environment = loadEnv(mode, root, '')
  const configPath = environment.ZOO_APP_CONFIG
  const composition =
    configPath === undefined
      ? { registryItemIds: [...defaultRegistryItemIds] }
      : loadAppCompositionFile(configPath, root, {
          interactionPerformanceEnabled:
            environment.VITE_INTERACTION_PERFORMANCE === '1',
        })
  if (composition instanceof Error) {
    return Promise.reject(
      new Error(`ZOO_APP_CONFIG: ${composition.message}`, {
        cause: composition,
      })
    )
  }
  return { __APP_STARTUP_COMPOSITION__: JSON.stringify(composition) }
}
