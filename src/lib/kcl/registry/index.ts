import { renderCommands } from '@src/lib/kcl/registry/renderCommands'
import { acquireKclExecutionPolicy } from '@src/lib/kcl/modeling/executionPolicy'
import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'
import {
  kclExecutionSettingsExtension,
  kclExecutionSettingsFactory,
} from '@src/lib/kcl/scene/executionSettingsRegistry'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { factory, contribute } from 'plankton'
import { signal, effect, untracked, batch } from '@preact/signals-core'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import {
  executorCapabilityFacet,
  observations as executorInputs,
} from '@src/lib/executors/registry/contract'
import {
  createKclViewExecution,
  type KclViewExecution,
} from '@src/lib/kcl/modeling/viewExecution'
import { createKclExecution } from '@src/lib/kcl/execution/executor'
import { KclScene } from '@src/lib/kcl/modeling/KclScene'
import { openKclScene } from '@src/lib/kcl/scene/open'
import { createKclSession } from '@src/lib/kcl/modeling/session'
import { createScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr } from '@src/lib/trap'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import { uuidv4 } from '@src/lib/utils'
import { observations as authInputs } from '@src/registry/contracts/auth'
import { observations as settingsInputs } from '@src/registry/contracts/settings'
import { observations as wasmInputs } from '@src/registry/contracts/wasm'
import {
  readKclFileExtensions,
  readKclVersion,
} from '@src/lib/kcl/execution/nativeInputs'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'

/**
 * Contributes KCL Code syntax, execution, and a Modeling mode for KCL documents.
 * Views lease the editor's shared executor for source snapshots, and separately
 * own their connection, native context, and camera through their mode contexts.
 */
const extension = factory({
  key: 'kcl',
  dependencies: {
    render: renderCommands,
    nativeSettings: kclExecutionSettingsFactory,
    sources: projectSourcesExtension,
    settingsInput: settingsInputs,
    auth: authInputs,
    wasmInput: wasmInputs,
    executorsInput: executorInputs,
  },
  create: ({
    render,
    nativeSettings,
    sources,
    settingsInput,
    auth,
    wasmInput,
    executorsInput,
  }) => {
    const getWasm = () =>
      wasmInput.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const execution = createKclExecution((contents, context) => {
      const extensions = readKclFileExtensions(getWasm())
      const captured = sources.capture({
        document: { src: context.src || undefined, contents },
        unnamedPath: 'main.kcl',
        signal: context.signal,
        include: async (path) =>
          (await extensions).some((extension) =>
            path.toLowerCase().endsWith(extension)
          ),
      })
      return Promise.all([captured, extensions]).then(([snapshot]) => snapshot)
    }, sources.revision)
    const modelingView = defineEditorView(({ editor, onDispose }) => {
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
          const version = await readKclVersion(
            executor.result(execution.capability).peek().requested?.contents ??
              executor.editor.contents.peek(),
            wasm
          )
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
        () =>
          viewExecution?.refresh(
            getAutomaticallyRenderEnabledFromSettings(settings.current.peek())
          ),
        () =>
          viewExecution?.state.peek().running ?? executor.output.peek().running
      )
      onDispose(session.dispose)
      viewExecution = createKclViewExecution(
        executor,
        execution.capability,
        session,
        () => settingsRevision.value,
        () => nativeSettings.configuration.peek()
      )
      onDispose(viewExecution.dispose)
      onDispose(
        acquireKclExecutionPolicy(
          executor,
          execution.capability,
          viewExecution,
          () =>
            getAutomaticallyRenderEnabledFromSettings(settings.current.value, {
              reactive: true,
            }),
          () => settingsRevision.value
        )
      )
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
      const requestRender = () => executor.run(execution.capability)
      onDispose(render.attach(editor, requestRender))
      return { executor, session, viewExecution, render: requestRender }
    })({
      id: 'kcl.modeling',
      label: 'Modeling',
      matches: ({ languageId }) => languageId === 'kcl',
      priority: 1000,
      Component: KclScene,
    })
    return {
      items: [
        contribute(executorCapabilityFacet, () => execution.capability),
        contribute(editorViewsFacet, () => modelingView),
        contribute(editorLanguagesFacet, () => ({
          id: 'kcl',
          matches: '.kcl' as const,
        })),

        contribute(codeEditorsExtensionFacet, () => ({
          id: 'editors.kcl',
          matches: ({ languageId }) => languageId === 'kcl',
          extensions: [kcl(), editorKclHighlight],
        })),
      ],
    }
  },
})

export default [
  // The legacy file route needs these inputs even with project-shell editing off.
  kclExecutionSettingsExtension,
  withProjectShellFeature(extension, 'kcl'),
]
