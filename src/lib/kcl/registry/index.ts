import { kclExecutionSettingsExtension } from '@src/lib/kcl/scene/executionSettingsRegistry'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { factory, contribute } from 'plankton'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executorCapabilityFacet } from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/execution/executor'
import { KclScene } from '@src/lib/kcl/modeling/KclScene'
import { isGeometryFile } from '@src/lib/geometryViewer/formats'
import { sceneViews } from '@src/lib/kcl/modeling/sceneViews'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { observations as wasmInputs } from '@src/registry/contracts/wasm'
import { readKclFileExtensions } from '@src/lib/kcl/execution/nativeInputs'

/**
 * Contributes KCL Code syntax, execution, and a Modeling mode for KCL documents.
 * Views lease the editor's shared executor for source snapshots, and separately
 * own their connection, native context, and camera through their mode contexts.
 */
const extension = factory({
  key: 'kcl',
  dependencies: {
    scenes: sceneViews,
    sources: projectSourcesExtension,
    wasmInput: wasmInputs,
  },
  create: ({ scenes, sources, wasmInput }) => {
    const getWasm = () =>
      wasmInput.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const execution = createKclExecution(async (contents, context) => {
      const extensions = await readKclFileExtensions(getWasm())
      return sources.capture({
        document: { src: context.src || undefined, contents },
        unnamedPath: 'main.kcl',
        signal: context.signal,
        include: (path) =>
          isGeometryFile(path) ||
          extensions.some((extension) =>
            path.toLowerCase().endsWith(extension)
          ),
      })
    }, sources.revision)
    const modelingView = defineEditorView(scenes.bind(execution.capability))({
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
