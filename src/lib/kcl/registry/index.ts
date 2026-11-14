import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { initialiseWasm, relevantFileExtensions } from '@src/lang/wasmUtils'
import {
  codeEditorsExtensionValueSpec,
  editorLanguagesValueSpec,
  editorsService,
  editorViewsValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import {
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
import { createSceneExecutionSettings } from '@src/lib/scene/settings'
import { createKclSceneSettings } from '@src/lib/kcl/settings'
import { loadKclSources } from '@src/lib/kcl/sources'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr } from '@src/lib/trap'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

/** KCL syntax and executor-backed Modeling share editor classification, not scene ownership. */
const extension = defineRegistryItemFactory(({ services, valueSpecs }) => {
  let fallbackWasm: ReturnType<typeof initialiseWasm> | undefined
  const getWasm = () =>
    valueSpecs.get(wasmPromiseValueSpec) ?? (fallbackWasm ??= initialiseWasm())
  const nativeSettings = createSceneExecutionSettings(
    () => services.get(settingsService).current.value
  )
  const settingsRevision = nativeSettings.revision(
    () =>
      services.get(settingsService).current.value.modeling.useLocalRenderer
        .currentSignal.value
  )
  const execution = createKclExecution(
    (executor) => {
      const settings = services.get(settingsService)
      const preferences = createKclSceneSettings(() => settings.current.value)
      const session = createKclSession(
        async (size, signal, onDisconnect) => {
          const wasm = getWasm()
          const version = getKclLanguageVersion(
            executor.editor.contents.peek(),
            await wasm
          )
          return openKclScene({
            wasm,
            settings,
            nativeSettings,
            preferences: preferences.current,
            token: services.optional(authService)?.token.peek(),
            presentation: settings.current.peek().modeling.useLocalRenderer
              .current
              ? 'local'
              : 'streamed',
            kclVersion: isErr(version) ? undefined : version,
            size,
            signal,
            onDisconnect,
          })
        },
        () => executor.refresh()
      )
      return {
        ...session,
        dispose: () => {
          session.dispose()
          preferences.dispose()
        },
      }
    },
    async (contents, context) => {
      const extensions = relevantFileExtensions(await getWasm())
      return loadKclSources(
        contents,
        context,
        services.optional(projectSessionService),
        services.get(editorsService).editors.peek(),
        services.optional(fileOperationsService),
        (path) =>
          extensions.some((extension) => path.toLowerCase().endsWith(extension))
      )
    },
    computed(() => ({
      project: services.optional(projectSessionService)?.currentProject.value,
      settings: settingsRevision.value,
      buffers: services.get(editorsService).editors.value.map((editor) => ({
        src: editor.src.value,
        contents: editor.contents.value,
      })),
    }))
  )
  return {
    id: 'kcl',
    provides: [
      provide(executorCapabilityValueSpec, execution.capability),
      provide(
        editorViewsValueSpec,
        defineEditorView(({ editor, onDispose }) => {
          const executors = services.get(executorsService)
          const executor = executors.createExecutor(editor)
          if (isErr(executor)) return executor
          onDispose(() => executors.closeExecutor(executor.id))
          return { executor, session: execution.getSession(executor) }
        })({
          id: 'kcl.modeling',
          label: 'Modeling',
          matches: ({ languageId }) => languageId === 'kcl',
          priority: 1000,
          Component: KclScene,
        })
      ),
      provide(editorLanguagesValueSpec, {
        id: 'kcl',
        matches: '.kcl',
      }),

      provide(codeEditorsExtensionValueSpec, {
        id: 'editors.kcl',
        matches: ({ languageId }) => languageId === 'kcl',
        extensions: [kcl(), editorKclHighlight],
      }),
    ],
  }
}, 'kcl')

export default withProjectShellFeature(extension, 'kcl')
