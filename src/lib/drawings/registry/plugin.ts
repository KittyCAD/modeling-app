import { createElement } from 'react'
import { contribute, factory } from 'plankton'
import { defineEditorView } from '@src/lib/editors/views'
import { editorViewsFacet } from '@src/lib/editors/registry/contract'
import { executionContext } from '@src/lib/executors/context'
import {
  observations as executorInputs,
  executorCapabilityFacet,
} from '@src/lib/executors/registry/contract'
import { observations as wasmInputs } from '@src/registry/contracts/wasm'
import projectSourcesExtension from '@src/lib/projectSession/registry/sources'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { readKclFileExtensions } from '@src/lib/kcl/execution/nativeInputs'
import { createDrawingsExecutorCapability } from '@src/lib/drawings/executor'
import { evaluateDrawings } from '@src/lib/drawings/evaluate'
import { DrawingsView } from '@src/lib/drawings/DrawingsView'
import { isErr } from '@src/lib/trap'

const extension = factory({
  key: 'drawings',
  dependencies: {
    executors: executorInputs,
    wasm: wasmInputs,
    sources: projectSourcesExtension,
  },
  create: ({ executors, wasm, sources }) => {
    const capability = createDrawingsExecutorCapability(
      async (contents, context) => {
        const getWasm = wasm.wasmPromiseFacet.value
        if (!getWasm) return new Error('KCL runtime is unavailable')
        const extensions = readKclFileExtensions(getWasm)
        const snapshot = await sources.capture({
          document: { src: context.src || undefined, contents },
          unnamedPath: 'main.kcl',
          signal: context.signal,
          include: async (path) =>
            (await extensions).some((extension) =>
              path.toLowerCase().endsWith(extension)
            ),
        })
        if (isErr(snapshot)) return snapshot
        return evaluateDrawings(snapshot, await getWasm, context.signal)
      },
      sources.revision
    )
    const view = defineEditorView(
      executionContext(
        capability,
        () => executors.executorsService.required(),
        () => true
      )
    )({
      id: 'drawings.sheet',
      label: 'Drawings',
      matches: '.kcl',
      Component: ({ context }) =>
        createElement(DrawingsView, { executor: context.executor, capability }),
    })
    return {
      items: [
        contribute(executorCapabilityFacet, () => capability),
        contribute(editorViewsFacet, () => view),
      ],
    }
  },
})

export default withProjectShellFeature(extension, 'drawings')
