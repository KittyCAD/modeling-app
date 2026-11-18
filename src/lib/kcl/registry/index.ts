import {
  kclExecutionSettingsExtension,
  kclExecutionSettingsFactory,
} from '@src/lib/kcl/scene/executionSettingsRegistry'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { factory, contribute } from 'plankton'
import { computed } from '@preact/signals-core'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { initialiseWasm, relevantFileExtensions } from '@src/lang/wasmUtils'
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
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import { openKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'

import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr } from '@src/lib/trap'
import { observations as authInputs } from '@src/registry/contracts/auth'
import { observations as settingsInputs } from '@src/registry/contracts/settings'
import { observations as wasmInputs } from '@src/registry/contracts/wasm'

/**
 * Contributes KCL Code syntax, execution, and a Modeling mode for KCL documents.
 * The mode's context creates a distinct executor per view, so views share editor
 * text/history while each owns its connection, native model, and camera.
 */
const extension = factory({
  key: 'kcl',
  dependencies: {
    nativeSettings: kclExecutionSettingsFactory,
    sources: projectSourcesExtension,
    settingsInput: settingsInputs,
    auth: authInputs,
    wasmInput: wasmInputs,
    executorsInput: executorInputs,
  },
  create: ({
    nativeSettings,
    sources,
    settingsInput,
    auth,
    wasmInput,
    executorsInput,
  }) => {
    let fallbackWasm: ReturnType<typeof initialiseWasm> | undefined
    const getWasm = () =>
      wasmInput.wasmPromiseFacet.value ?? (fallbackWasm ??= initialiseWasm())
    const settingsRevision = nativeSettings.revision(
      () =>
        settingsInput.settingsService.required().current.value.modeling
          .useLocalRenderer.currentSignal.value
    )
    const execution = createKclExecution(
      (executor) => {
        const settings = settingsInput.settingsService.required()
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
              token: auth.authService.current.value?.token.peek(),
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
      computed(() => ({
        sources: sources.revision.value,
        settings: settingsRevision.value,
      }))
    )
    const modelingView = defineEditorView(({ editor, onDispose }) => {
      const executors = executorsInput.executorsService.required()
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
