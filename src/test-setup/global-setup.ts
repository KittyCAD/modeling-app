export default function setup(context: {
  provide: (key: string, value: unknown) => void
  config: { test?: { snapshotOptions?: { updateSnapshot?: string } } }
}) {
  // Check if snapshot update mode is enabled
  // Only update existing snapshots when mode is 'all' (triggered by -u flag)
  // 'new' mode only creates snapshots for tests that don't have any, but doesn't update existing ones
  const isUpdateSnapshots =
    context.config.test?.snapshotOptions?.updateSnapshot === 'all'

  // Provide the update flag to tests
  context.provide('vitest:updateSnapshots', isUpdateSnapshots)
}

declare module 'vitest' {
  export interface ProvidedContext {
    'vitest:updateSnapshots': boolean
  }
}
