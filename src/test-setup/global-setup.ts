import type { GlobalSetupContext } from 'vitest/node'

export default function setup({ provide, config }: GlobalSetupContext) {
  // Check if snapshot update mode is enabled
  // Only update existing snapshots when mode is 'all' (triggered by -u flag)
  // 'new' mode only creates snapshots for tests that don't have any, but doesn't update existing ones
  const isUpdateSnapshots = config.snapshotOptions.updateSnapshot === 'all'

  // Provide the update flag to tests
  provide('vitest:updateSnapshots', isUpdateSnapshots)
}

declare module 'vitest' {
  export interface ProvidedContext {
    'vitest:updateSnapshots': boolean
  }
}
