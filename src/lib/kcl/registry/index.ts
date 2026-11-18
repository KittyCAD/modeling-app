import { inputs, observe, observeService } from '@src/registry/inputs'
import { factory, contribute } from 'plankton'
import { observations as settingsInput } from '@src/registry/contracts/settings'
import { observations as authInput } from '@src/registry/contracts/auth'
import { observations as executorsInput } from '@src/lib/executors/registry/contract'
import { observations as wasmInput } from '@src/registry/contracts/wasm'
import { observations as filesInput } from '@src/registry/contracts/fileOperations'
import { observations as commandsInput } from '@src/registry/contracts/commands'
import {
  keymapService,
  keymapScopesFacet,
} from '@src/registry/contracts/keymap'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { observations as featuresInput } from '@src/registry/contracts/userFeatures'
import { observations as projectInput } from '@src/lib/projectSession/next/contract'
import { observations as modelingInput } from '@src/lib/kcl/registry/contract'
import {
  kclExecutionSettingsFactory,
  kclExecutionSettingsExtension,
} from '@src/lib/kcl/scene/executionSettingsRegistry'
import { streamedSketchPresentation } from '@src/lib/kcl/sketch/streamPresentation'
import { MachineManager } from '@src/lib/MachineManager'
import { modelingInteractionViewsFacet } from '@src/lib/kcl/registry/contract'
import { createActiveSelection } from '@src/lib/kcl/selection'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { modelingStatusItemsFacet } from '@src/lib/kcl/registry/contract'
import { defaultModelingStatusItems } from '@src/lib/kcl/statusItems'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { computed, effect, signal } from '@preact/signals-core'
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
import { KclSceneLoader as KclScene } from '@src/lib/kcl/KclSceneLoader'
import { deferMachineHost } from '@src/lib/kcl/machine/deferred'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr, reportRejection } from '@src/lib/trap'
const keymapInput = inputs({
  keymapService: observeService(keymapService),
  keymapScopesFacet: observe(keymapScopesFacet),
})
const machinesInput = inputs({
  machineManagerService: observeService(machineManagerService),
})
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
    commandsInput: commandsInput,
    keymapInput: keymapInput,
    machinesInput: machinesInput,
    featuresInput: featuresInput,
    projectInput: projectInput,
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
    commandsInput,
    keymapInput,
    machinesInput,
    featuresInput,
    projectInput,
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
      let machine: ReturnType<typeof deferMachineHost>
      const context: ModelingViewContext = {
        commandRouting: commandsInput.contextualCommandsService.required(),
        selection: createActiveSelection(
          () => context,
          () => context.machine?.owner.value?.selection
        ),
        interactions: createModelingInteractions(
          () => context,
          modelingInput.modelingInteractionsFacet,
          modelingInput.modelingInteractionViewsFacet,
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
        settings: settingsInput.settingsService.required(),
        executor,
        session: execution.getSession(executor),
        wasm: getWasm(),
        fileOperations: filesInput.fileOperationsService.current.value,
        measurement,
        physicalAnalysis,
        statusItems: modelingInput.modelingStatusItemsFacet,
      }
      machine = deferMachineHost(async () => {
        const { createMachineModelingHost } = await import(
          '@src/lib/kcl/machine/host'
        )
        return createMachineModelingHost(() => context, {
          commands: commandsInput.commandSystemService.required(),
          contextualCommands:
            commandsInput.contextualCommandsService.required(),
          kclExecutionSettings: nativeSettings,
          keymapTree: keymapInput.keymapService.required().keymap,
          keymapScopes: keymapInput.keymapScopesFacet,
          fileOperations: filesInput.fileOperationsService.required(),
          userFeatures: featuresInput.userFeaturesService.required(),
          machineManager:
            machinesInput.machineManagerService.current.value?.manager ??
            new MachineManager(),
          // TODO: Supply project export metadata through an explicit next-project adapter.
          // The native model and files are already captured by this view's executor.
          project: signal(undefined),
          projectPath: signal(
            projectInput.projectSessionService.current.value?.currentProject.peek()
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
    return {
      items: [
        contribute(
          modelingInteractionViewsFacet,
          () => streamedSketchPresentation
        ),
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
