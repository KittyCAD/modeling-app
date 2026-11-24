import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { setupRecoverableTestWorld } from '@src/test-setup/recoverableTestWorld'

export type EngineTestWorld = Awaited<
  ReturnType<typeof buildTheWorldAndConnectToEngine>
>

/** Replace the entire native/engine world after interruption, retaining healthy sessions between tests. */
export function setupEngineTestWorld(
  accept: (world: EngineTestWorld) => void | Promise<void>,
  options: Parameters<typeof buildTheWorldAndConnectToEngine>[0] = {}
) {
  setupRecoverableTestWorld(
    {
      create: (signal) =>
        buildTheWorldAndConnectToEngine({ ...options, signal }),
      reusable: (world) =>
        world.engineCommandManager.isReady &&
        world.engineCommandManager.engineSessionId === world.engineSessionId,
      dispose: (world) => world.dispose(),
    },
    accept
  )
}
