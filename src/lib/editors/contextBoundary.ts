/**
 * Mode providers and cleanup callbacks can capture `EditorsService`. Letting
 * them close an editor or change its mode could trigger more setup or cleanup
 * before the current callback has finished acquiring or releasing resources.
 *
 * The `EditorsService` implementation shares one guard across its documents and views.
 * `createEditorModes` and `watchEditorCapabilities` wrap their setup and registered
 * `onDispose` callbacks in `run`. During those callbacks,
 * `assertCanManageEditors` rejects service calls that open or close editors or
 * change their source, language, or selected mode, including for other editors.
 *
 * `createCodeSurface` uses the same guard for Code extension factories and cleanup.
 *
 * The guard lasts only until the callback returns. It does not intercept
 * deferred work or direct changes to an editor's CodeMirror document.
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
