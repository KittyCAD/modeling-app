import {
  computed,
  effect,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import { Setting } from '@src/lib/settings/Setting'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'

/** Native settings and invalidation keys consumed by legacy and executor-owned scenes. */
export interface SceneExecutionSettings {
  configuration: ReadonlySignal<ReturnType<typeof jsAppSettings>>
  executeRevision: ReadonlySignal<string>
  rebuildRevision: ReadonlySignal<string>
  revision: (geometryOnly: () => boolean) => ReadonlySignal<string>
}

/** Native configuration and refresh inputs share the effective user/project settings. */
export function createSceneExecutionSettings(
  getSettings: () => SettingsType
): SceneExecutionSettings {
  const configuration = computed(() =>
    jsAppSettings(getSettings(), { reactive: true })
  )
  const inputs = computed(() => {
    const execute: unknown[] = []
    const rebuild: unknown[] = []
    for (const [category, settings] of Object.entries(getSettings())) {
      for (const [name, setting] of Object.entries(settings)) {
        if (!(setting instanceof Setting) || !setting.sceneExecution) continue
        const input = [category, name, setting.currentSignal.value]
        if (setting.sceneExecution === 'execute') execute.push(input)
        else rebuild.push(input)
      }
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

/** Adapt the legacy active-scene lifetime to shared refresh declarations and serialized cache rebuilds. */
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
  return effect(() => {
    const enabled = active()
    const execute = settings.executeRevision.value
    const rebuild = settings.rebuildRevision.value
    const needsExecution = execute !== previousExecute
    const needsRebuild = rebuild !== previousRebuild && !geometryOnly()
    previousExecute = execute
    previousRebuild = rebuild
    let cancelled = false
    untracked(() => {
      if (!enabled || !connected() || (!needsExecution && !needsRebuild)) return
      const owner = capture()
      const isCurrent = () => !cancelled && owner.isCurrent()
      const executeIfCurrent = () => {
        if (isCurrent()) return owner.execute()
      }
      if (needsRebuild) {
        const configuration = settings.configuration.peek()
        const clear = async () => {
          if (!isCurrent()) return false
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
}
