import { factory } from 'plankton'
import { batch, effect, signal, untracked } from '@preact/signals-core'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { EditorViewHost } from '@src/lib/editors/registry/contract'
import type { KclExecutionCapability } from '@src/lib/kcl/execution/executor'
import { observations as executorInputs } from '@src/lib/executors/registry/contract'
import {
  createKclViewExecution,
  type KclViewExecution,
} from '@src/lib/kcl/modeling/viewExecution'
import { openKclScene } from '@src/lib/kcl/scene/open'
import { createKclSession } from '@src/lib/kcl/modeling/session'
import { createScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import { kclExecutionSettingsFactory } from '@src/lib/kcl/scene/executionSettingsRegistry'
import { isErr } from '@src/lib/trap'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import { uuidv4 } from '@src/lib/utils'
import { observations as authInputs } from '@src/registry/contracts/auth'
import { observations as settingsInputs } from '@src/registry/contracts/settings'
import { observations as wasmInputs } from '@src/registry/contracts/wasm'
import { readKclVersion } from '@src/lib/kcl/execution/nativeInputs'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'

/** Binds engine-backed presentations to a source capability; each view owns its scene and camera. */
export const sceneViews = factory({
  key: 'kcl.scene-views',
  dependencies: {
    nativeSettings: kclExecutionSettingsFactory,
    settingsInput: settingsInputs,
    auth: authInputs,
    wasmInput: wasmInputs,
    executorsInput: executorInputs,
  },
  create: ({
    nativeSettings,
    settingsInput,
    auth,
    wasmInput,
    executorsInput,
  }) => {
    const getWasm = () =>
      wasmInput.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const bind =
      (
        capability: KclExecutionCapability,
        options: { local?: boolean; version?: KclVersion } = {}
      ) =>
      ({ editor, onDispose }: EditorViewHost) => {
        const executors = executorsInput.executorsService.required()
        const lease = executors.acquireExecutor(editor)
        if (isErr(lease)) return lease
        onDispose(lease.release)
        const { executor } = lease
        const settings = settingsInput.settingsService.required()
        const preferences = createScenePresentationPreferences(
          () => settings.current.value
        )
        onDispose(preferences.dispose)
        const choosePresentation = (): ScenePresentation =>
          options.local ||
          settings.current.value.modeling.useLocalRenderer.currentSignal.value
            ? 'local'
            : 'streamed'
        const presentation = signal(untracked(choosePresentation))
        const settingsRevision = nativeSettings.revision(
          () => presentation.value === 'local'
        )
        const viewId = uuidv4()
        let viewExecution: KclViewExecution | undefined
        const session = createKclSession(
          async (size, signal, onDisconnect) => {
            const wasm = getWasm()
            const renderer = presentation.peek()
            const version =
              options.version ??
              (await readKclVersion(executor.editor.contents.peek(), wasm))
            if (signal.aborted)
              return new Error('The KCL scene closed while opening')
            return openKclScene({
              wasm,
              settings,
              nativeSettings,
              preferences,
              token: auth.authService.current.value?.token.peek(),
              presentation: renderer,
              kclVersion: isErr(version) ? undefined : version,
              size,
              signal,
              onDisconnect: (error) => {
                if (
                  !(
                    error instanceof SceneDisconnected &&
                    error.details.reconnectRequested === true
                  )
                )
                  void reportClientError({
                    code: ClientErrorCode.EngineDisconnect,
                    message: error.message,
                    dedupeKey: `kcl-scene:${viewId}:${error.message}`,
                    extra: {
                      ...(error instanceof SceneDisconnected
                        ? error.details
                        : {}),
                      source: 'KclScene',
                      kclSourceLength: executor.editor.contents.peek().length,
                      viewId,
                      currentFileName: executor.editor.src.peek(),
                      renderer,
                    },
                  })
                onDisconnect(error)
              },
            })
          },
          () => viewExecution?.refresh(),
          () =>
            viewExecution?.state.peek().running ??
            executor.output.peek().running
        )
        onDispose(session.dispose)
        viewExecution = createKclViewExecution(
          executor,
          capability,
          session,
          () => settingsRevision.value
        )
        onDispose(viewExecution.dispose)
        onDispose(
          effect(() => {
            const renderer = choosePresentation()
            untracked(() => {
              if (presentation.peek() === renderer) return
              // Publish the renderer and replace the attempt before native execution
              // observes the new revision. All views still lease the same executor.
              batch(() => {
                presentation.value = renderer
                session.replaceScene()
              })
            })
          })
        )
        return { executor, session, viewExecution }
      }
    return { exports: { bind } }
  },
})
