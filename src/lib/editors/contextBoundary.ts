/**
 * Providers acquire mode resources; commands and UI manage buffers.
 * This guards synchronous calls into this service, not arbitrary extension code or scheduled work.
 */
export function createEditorContextBoundary() {
  let depth = 0
  return {
    run<T>(callback: () => T): T {
      depth++
      try {
        return callback()
      } finally {
        depth--
      }
    },
    assertCanManageEditors() {
      if (depth)
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Fail synchronously before a contributed context can mutate editor ownership.
        throw new Error(
          'Editor management is unavailable during mode setup or cleanup'
        )
    },
  }
}
