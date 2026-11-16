import { kclExecutionSettingsService } from '@src/lib/kcl/scene/executionSettingsContract'
import { kclExecutionSettingsRegistryItem } from '@src/lib/kcl/scene/executionSettingsRegistry'
import { streamedSketchPresentation } from '@src/lib/kcl/sketch/streamPresentation'
import {
  commandSystemService,
  contextualCommandsService,
} from '@src/registry/contracts/commands'
import {
  keymapService,
  keymapScopesValueSpec,
} from '@src/registry/contracts/keymap'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { MachineManager } from '@src/lib/MachineManager'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { modelingInteractionViewsValueSpec } from '@src/lib/kcl/registry/contract'
import { createActiveSelection } from '@src/lib/kcl/selection'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import { modelingInteractionsValueSpec } from '@src/lib/kcl/registry/contract'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { modelingStatusItemsValueSpec } from '@src/lib/kcl/registry/contract'
import { defaultModelingStatusItems } from '@src/lib/kcl/statusItems'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { initialiseWasm, relevantFileExtensions } from '@src/lang/wasmUtils'
import {
  codeEditorsExtensionValueSpec,
  editorLanguagesValueSpec,
  editorViewsValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import {
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclSceneLoader as KclScene } from '@src/lib/kcl/KclSceneLoader'
import { deferMachineHost } from '@src/lib/kcl/machine/deferred'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
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
  // Resolve the shared policy only when execution inputs are observed, after
  // registry setup. Keep the selected revision signal until its service changes.
  const settingsRevision = computed(() =>
    services
      .get(kclExecutionSettingsService)
      .revision(
        () =>
          services.get(settingsService).current.value.modeling.useLocalRenderer
            .currentSignal.value
      )
  )
  const execution = createKclExecution(
    (executor) => {
      const settings = services.get(settingsService)
      const nativeSettings = services.get(kclExecutionSettingsService)
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
      settings: settingsRevision.value.value,
    }))
  )
  return {
    id: 'kcl',
    uses: [projectSourcesExtension],
    provides: [
      provide(modelingInteractionViewsValueSpec, streamedSketchPresentation),
      ...defaultModelingStatusItems.map((item) =>
        provide(modelingStatusItemsValueSpec, item)
      ),
      provide(executorCapabilityValueSpec, execution.capability),
      provide(
        editorViewsValueSpec,
        defineEditorView(({ editor, onDispose }) => {
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
          let machine: ReturnType<typeof deferMachineHost>
          const context: ModelingViewContext = {
            commandRouting: services.get(contextualCommandsService),
            selection: createActiveSelection(
              () => context,
              () => context.machine?.owner.value?.selection
            ),
            interactions: createModelingInteractions(
              () => context,
              valueSpecs.signal(modelingInteractionsValueSpec),
              valueSpecs.signal(modelingInteractionViewsValueSpec),
              (id) => machine.use((host) => host.enter(id))
            ),
            tools: {
              error: signal(undefined),
              close: () => {
                void machine
                  ?.use((host) => host.closeDialog())
                  .catch(reportRejection)
              },
            },
            settings: services.get(settingsService),
            executor,
            session: execution.getSession(executor),
            wasm: getWasm(),
            fileOperations: services.optional(fileOperationsService),
            measurement,
            physicalAnalysis,
            statusItems: valueSpecs.signal(modelingStatusItemsValueSpec),
          }
          machine = deferMachineHost(async () => {
            const { createMachineModelingHost } = await import(
              '@src/lib/kcl/machine/host'
            )
            return createMachineModelingHost(() => context, {
              commands: services.get(commandSystemService),
              contextualCommands: services.get(contextualCommandsService),
              kclExecutionSettings: services.get(kclExecutionSettingsService),
              keymapTree: services.get(keymapService).keymap,
              keymapScopes: valueSpecs.signal(keymapScopesValueSpec),
              fileOperations: services.get(fileOperationsService),
              userFeatures: services.get(userFeaturesService),
              machineManager:
                services.optional(machineManagerService)?.manager ??
                new MachineManager(),
              // TODO: Supply project export metadata through an explicit next-project adapter.
              // The native model and files are already captured by this view's executor.
              project: signal(undefined),
              projectPath: signal(
                services.optional(projectSessionService)?.currentProject.peek()
                  ?.contents.path ?? ''
              ),
            })
          })
          context.machine = machine
          onDispose(() => {
            machine.dispose().catch(reportRejection)
          })
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

export default defineRegistryItem({
  id: 'kcl.extension',
  uses: [
    // The legacy file route needs these inputs even with project-shell editing off.
    kclExecutionSettingsRegistryItem,
    withProjectShellFeature(extension, 'kcl'),
  ],
})
