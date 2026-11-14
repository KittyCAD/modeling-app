import { kclCorrespondenceEndpointsService } from '@src/lib/kcl/correspondence/contract'
import { modelingCorrespondenceEndpoint } from '@src/lib/kcl/correspondence/modelEndpoint'
import { createActiveSelection } from '@src/lib/kcl/selection'
import { defaultModelingToolGroups } from '@src/lib/kcl/toolGroups'
import { sketchToolsValueSpec } from '@src/lib/kcl/sketch/contract'
import { circleSketchTool } from '@src/lib/kcl/sketch/tools'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import { createSketchInteraction } from '@src/lib/kcl/sketch/definition'
import { modelingInteractionsValueSpec } from '@src/lib/kcl/registry/contract'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { createModelingTools } from '@src/lib/kcl/modelingTools'
import { defaultModelingTools } from '@src/lib/kcl/toolDefinitions'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import {
  modelingToolGroupsValueSpec,
  modelingStatusItemsValueSpec,
  modelingToolsValueSpec,
} from '@src/lib/kcl/registry/contract'
import { defaultModelingStatusItems } from '@src/lib/kcl/statusItems'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { computed, effect } from '@preact/signals-core'
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
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { projectSourcesService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr, reportRejection } from '@src/lib/trap'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

/**
 * Contributes KCL Code syntax, execution, and a Modeling mode for KCL documents.
 * The mode's context creates a distinct executor per view, so views share editor
 * text/history while each owns its connection, native model, and camera.
 */
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
      const preferences = createScenePresentationPreferences(
        () => settings.current.value
      )
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
            preferences,
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
      return services.get(projectSourcesService).capture({
        document: { src: context.src || undefined, contents },
        unnamedPath: 'main.kcl',
        signal: context.signal,
        include: (path) =>
          extensions.some((extension) =>
            path.toLowerCase().endsWith(extension)
          ),
      })
    },
    computed(() => ({
      sources: services.get(projectSourcesService).revision.value,
      settings: settingsRevision.value,
    }))
  )
  return {
    id: 'kcl',
    uses: [projectSourcesExtension],
    provides: [
      ...defaultModelingToolGroups.map((group) =>
        provide(modelingToolGroupsValueSpec, group)
      ),
      provide(sketchToolsValueSpec, circleSketchTool),
      provide(
        modelingInteractionsValueSpec,
        createSketchInteraction(valueSpecs.signal(sketchToolsValueSpec))
      ),
      ...defaultModelingTools.map((tool) =>
        provide(modelingToolsValueSpec, tool)
      ),
      ...defaultModelingStatusItems.map((item) =>
        provide(modelingStatusItemsValueSpec, item)
      ),
      provide(executorCapabilityValueSpec, execution.capability),
      provide(
        editorViewsValueSpec,
        defineEditorView(({ editor, instance, onDispose }) => {
          const executors = services.get(executorsService)
          const executor = executors.createExecutor(editor)
          if (isErr(executor)) return executor
          onDispose(() => executors.closeExecutor(executor.id))
          const measurement = createMeasurementToolService()
          const physicalAnalysis = createPhysicalAnalysisService()
          onDispose(() => {
            measurement.close()
            physicalAnalysis.close()
          })
          const context: ModelingViewContext = {
            selection: createActiveSelection(() => context),
            interactions: createModelingInteractions(
              () => context,
              valueSpecs.signal(modelingInteractionsValueSpec)
            ),
            tools: createModelingTools(
              () => context,
              valueSpecs.signal(modelingToolsValueSpec),
              () =>
                services
                  .optional(userFeaturesService)
                  ?.has(EXPERIMENTAL_POINT_AND_CLICK_FLAG, false) ?? false
            ),
            settings: services.get(settingsService),
            executor,
            session: execution.getSession(executor),
            wasm: getWasm(),
            fileOperations: services.optional(fileOperationsService),
            measurement,
            physicalAnalysis,
            toolGroups: valueSpecs.signal(modelingToolGroupsValueSpec),
            statusItems: valueSpecs.signal(modelingStatusItemsValueSpec),
          }
          onDispose(
            effect(() => {
              const correspondence = services.signal(
                kclCorrespondenceEndpointsService
              ).value
              if (!correspondence) return
              const unregister = correspondence.registerModel(
                modelingCorrespondenceEndpoint(
                  instance.id,
                  context,
                  computed(
                    () =>
                      services.get(editorsService).viewState(instance).value
                        .selected?.id === 'kcl.modeling'
                  )
                )
              )
              if (isErr(unregister)) reportRejection(unregister)
              else return unregister
            })
          )
          const stopRecovery = effect(() => {
            const state = context.session.state.value
            if (state.type === 'connecting' || state.type === 'error') {
              context.tools.close()
              context.tools.error.value = undefined
              context.interactions.close().catch(reportRejection)
              context.interactions.error.value = undefined
            }
          })
          onDispose(stopRecovery)
          onDispose(context.tools.dispose)
          onDispose(context.interactions.dispose)
          return context
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
