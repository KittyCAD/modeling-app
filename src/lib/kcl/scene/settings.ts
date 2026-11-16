import {
  computed,
  effect,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { KclExecutionInput } from '@src/lib/kcl/scene/settingsContract'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'

/**
 * The native configuration to execute with, plus keys for deciding when settings
 * require another execution. The keys compare contributed values, so replacing
 * a `Setting` instance with an equivalent one does not request execution.
 */
export interface SceneExecutionSettings {
  configuration: ReadonlySignal<ReturnType<typeof jsAppSettings>>
  executeRevision: ReadonlySignal<string>
  rebuildRevision: ReadonlySignal<string>
  revision: (geometryOnly: () => boolean) => ReadonlySignal<string>
}

/**
 * Read effective preferences through `getSettings` and follow the registry's
 * contributed inputs through `declarations`. `configuration` includes all native
 * settings; only the contributed inputs determine the refresh keys.
 */
export function createSceneExecutionSettings(
  getSettings: () => SettingsType,
  declarations: ReadonlySignal<readonly KclExecutionInput[]>
): SceneExecutionSettings {
  const configuration = computed(() =>
    jsAppSettings(getSettings(), { reactive: true })
  )
  const inputs = computed(() => {
    const execute: unknown[] = []
    const rebuild: unknown[] = []
    for (const input of declarations.value) {
      const value = [input.id, input.read(getSettings())]
      if (input.refresh === 'execute') execute.push(value)
      else rebuild.push(value)
    }
    return {
      execute: JSON.stringify(execute),
      rebuild: JSON.stringify(rebuild),
    }
  })
  const executeRevision = computed(() => inputs.value.execute)
  const rebuildRevision = computed(() => inputs.value.rebuild)
  return {
    configuration,
    executeRevision,
    rebuildRevision,
    revision: (geometryOnly: () => boolean) =>
      computed(() =>
        JSON.stringify([
          executeRevision.value,
          geometryOnly() ? null : rebuildRevision.value,
        ])
      ),
  }
}

/**
 * Refresh the active, connected legacy scene when a contributed KCL input changes.
 * An `execute` change reruns the model; a `rebuild-streamed` change first clears
 * the streamed scene and native cache. Local rendering handles rebuild-only
 * preferences, such as backface color, without another native execution.
 *
 * `capture` binds callbacks to the file, project, and connection receiving this
 * change. `KclManager.watchSettings` supplies those callbacks and an `isCurrent`
 * check so queued work cannot clear or execute a replacement scene. The returned
 * disposer prevents queued work from starting; it cannot abort a native operation
 * that has already started.
 */
export function observeSceneExecutionSettings({
  settings,
  active,
  connected,
  geometryOnly,
  capture,
}: {
  settings: SceneExecutionSettings
  active: () => boolean
  connected: () => boolean
  geometryOnly: () => boolean
  capture: () => {
    isCurrent: () => boolean
    execute: () => Promise<unknown>
    rebuild: (
      configuration: ReturnType<typeof jsAppSettings>
    ) => Promise<unknown>
  }
}) {
  let previousExecute = settings.executeRevision.peek()
  let previousRebuild = settings.rebuildRevision.peek()
  let pendingRebuild: Promise<boolean> | undefined
  let ownerVersion = 0
  const stop = effect(() => {
    const enabled = active()
    const hasConnection = connected()
    const execute = settings.executeRevision.value
    const rebuild = settings.rebuildRevision.value
    const needsExecution = execute !== previousExecute
    const needsRebuild = rebuild !== previousRebuild && !geometryOnly()
    // Record changes even while inactive or disconnected. Opening or reconnecting
    // a file runs its own execution; becoming active alone must not run it again.
    previousExecute = execute
    previousRebuild = rebuild
    let cancelled = false
    // Only the inputs read above should schedule this effect. Settings read by
    // `capture`, `rebuild`, or `execute` must not add refresh dependencies.
    untracked(() => {
      if (!enabled || !hasConnection) {
        ownerVersion++
        return
      }
      if (!needsExecution && !needsRebuild) return
      const owner = capture()
      const version = ownerVersion
      // `ownerVersion` rejects work queued before deactivation, disconnection,
      // or disposal, even if the same scene later becomes active again.
      const ownsScene = () => version === ownerVersion && owner.isCurrent()
      // Effect cleanup cancels the previous change's execution callback. Its
      // queued cache clear may still be needed by the newer change below.
      const isCurrent = () => !cancelled && ownsScene()
      const executeIfCurrent = () => {
        if (isCurrent()) return owner.execute()
      }
      if (needsRebuild) {
        const configuration = settings.configuration.peek()
        const clear = async () => {
          // For example, toggling edges while a backface-color clear is queued
          // must wait for that clear, rather than cancel it. Skip the clear only
          // if its backface settings are outdated or its scene is no longer current.
          if (!ownsScene() || settings.rebuildRevision.peek() !== rebuild)
            return false
          try {
            await owner.rebuild(configuration)
            return true
          } catch (error) {
            reportRejection(error)
            return false
          }
        }
        const pending = pendingRebuild ? pendingRebuild.then(clear) : clear()
        pendingRebuild = pending
        void pending
          .then((success) => {
            if (pendingRebuild === pending) pendingRebuild = undefined
            if (success) return executeIfCurrent()
          })
          .catch(reportRejection)
      } else if (pendingRebuild) {
        // Execute-only changes must wait for the queued cache clear to finish;
        // otherwise that clear could erase the model they just rendered.
        void pendingRebuild
          .then((success) => {
            if (success) return executeIfCurrent()
          })
          .catch(reportRejection)
      } else void executeIfCurrent()?.catch(reportRejection)
    })
    return () => {
      cancelled = true
    }
  })
  return () => {
    ownerVersion++
    stop()
  }
}
