import { factory, contribute } from 'plankton'
import { observations as settingsInput } from '@src/registry/contracts/settings'
import { observations as authInput } from '@src/registry/contracts/auth'
import { observations as executorsInput } from '@src/lib/executors/registry/contract'
import { observations as wasmInput } from '@src/registry/contracts/wasm'
import { observations as filesInput } from '@src/registry/contracts/fileOperations'
import { observations as modelingInput } from '@src/lib/kcl/registry/contract'
import {
  kclExecutionSettingsFactory,
  kclExecutionSettingsExtension,
} from '@src/lib/kcl/scene/executionSettingsRegistry'
import { modelingStatusItemsFacet } from '@src/lib/kcl/registry/contract'
import { defaultModelingStatusItems } from '@src/lib/kcl/statusItems'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { computed, signal } from '@preact/signals-core'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { initialiseWasm } from '@src/lang/wasmUtils'
import {
  readKclVersion,
  readKclFileExtensions,
} from '@src/lib/kcl/nativeInputs'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executorCapabilityFacet } from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr } from '@src/lib/trap'
const extension = factory({
  key: 'kcl',
  dependencies: {
    nativeSettings: kclExecutionSettingsFactory,
    sources: projectSourcesExtension,
    settingsInput: settingsInput,
    authInput: authInput,
    executorsInput: executorsInput,
    wasmInput: wasmInput,
    filesInput: filesInput,
    modelingInput: modelingInput,
  },
  create: ({
    nativeSettings,
    sources,
    settingsInput,
    authInput,
    executorsInput,
    wasmInput,
    filesInput,
    modelingInput,
  }) => {
    let fallbackWasm: ReturnType<typeof initialiseWasm> | undefined
    const getWasm = () =>
      wasmInput.wasmPromiseFacet.value ?? (fallbackWasm ??= initialiseWasm())
    const execution = createKclExecution(
      (executor) => {
        const settings = settingsInput.settingsService.required()
        const preferences = createScenePresentationPreferences(
          () => settings.current.value
        )
        const choosePresentation = (): ScenePresentation =>
          settings.current.peek().modeling.useLocalRenderer.current
            ? 'local'
            : 'streamed'
        const presentation = signal(choosePresentation())
        const settingsRevision = nativeSettings.revision(
          () => presentation.value === 'local'
        )
        const session = createKclSession(
          async (size, signal, onDisconnect) => {
            const wasm = getWasm()
            presentation.value = choosePresentation()
            const version = await readKclVersion(
              executor.editor.contents.peek(),
              wasm
            )
            return openKclScene({
              wasm,
              settings,
              nativeSettings,
              preferences,
              token: authInput.authService.current.value?.token.peek(),
              presentation: presentation.peek(),
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
          revision: computed(() => ({
            sources: sources.revision.value,
            settings: settingsRevision.value,
          })),
          dispose: () => {
            session.dispose()
            preferences.dispose()
          },
        }
      },
      async (contents, context) => {
        const extensions = await readKclFileExtensions(getWasm())
        return sources.capture({
          document: { src: context.src || undefined, contents },
          unnamedPath: 'main.kcl',
          signal: context.signal,
          include: (path) =>
            extensions.some((extension) =>
              path.toLowerCase().endsWith(extension)
            ),
        })
      },
      (session) => session.revision.value
    )
    const modelingView = defineEditorView(({ editor, onDispose }) => {
      const executors = executorsInput.executorsService.required()
      const executor = executors.createExecutor(editor)
      if (isErr(executor)) return executor
      onDispose(() => executors.closeExecutor(executor.id))
      const measurement = createMeasurementToolService()
      const physicalAnalysis = createPhysicalAnalysisService()
      onDispose(() => {
        measurement.close()
        physicalAnalysis.close()
      })
      return {
        executor,
        session: execution.getSession(executor),
        wasm: getWasm(),
        fileOperations: filesInput.fileOperationsService.current.value,
        measurement,
        physicalAnalysis,
        statusItems: modelingInput.modelingStatusItemsFacet,
      }
    })({
      id: 'kcl.modeling',
      label: 'Modeling',
      matches: ({ languageId }) => languageId === 'kcl',
      priority: 1000,
      Component: KclScene,
    })
    return {
      items: [
        ...defaultModelingStatusItems.map((item) =>
          contribute(modelingStatusItemsFacet, () => item)
        ),
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
  kclExecutionSettingsExtension,
  withProjectShellFeature(extension, 'kcl'),
]
