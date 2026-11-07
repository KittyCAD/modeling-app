import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from '@kittycad/registry'
import { DrawingsView } from '@src/lib/drawings/DrawingsView'
import type { KclValueView } from '@rust/kcl-lib/bindings/KclValueView'
import { createDrawingsExecutorCapability } from '@src/lib/drawings/executor'
import {
  editorViewValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { createElement } from 'react'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import { loadKclProjectSources } from '@src/lib/kcl/projectSources'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Drawings evaluates paper declarations locally, independently of the engine stream. */
const extension = defineRegistryItemFactory(({ services, valueSpecs }) => {
  const capability = createDrawingsExecutorCapability(
    async (contents, context) => {
      const wasm = await valueSpecs.get(wasmPromiseValueSpec)
      if (!wasm) return new Error('KCL runtime is unavailable')
      if (context.signal.aborted)
        return new Error('Drawing execution was cancelled')
      const sources = await loadKclProjectSources(
        contents,
        context,
        services.optional(projectSessionService),
        services.optional(editorsService)?.editors.peek() ?? []
      )
      if (isErr(sources)) return sources
      const files = new Map(
        typeof sources === 'string'
          ? [[fsZds.resolve(context.src), sources]]
          : [...sources].map(([path, source]) => [fsZds.resolve(path), source])
      )
      // This binding serializes the runtime's generated KclValueView map.
      return (await wasm.evaluate_kcl_mock(contents, context.src, {
        readFile: async (path: string) => {
          if (context.signal.aborted)
            return Promise.reject(new Error('Drawing execution was cancelled'))
          const source = files.get(fsZds.resolve(path))
          return source === undefined
            ? Promise.reject(new Error(`KCL file not found: ${path}`))
            : new TextEncoder().encode(source)
        },
        exists: async (path: string) => files.has(fsZds.resolve(path)),
        getAllFiles: async () => [...files.keys()],
      })) as Record<string, KclValueView>
    }
  )
  return createZdsPlugin({
    id: 'drawings',
    title: 'Drawings',
    description: 'A paper workspace for KCL drawings.',
    items: [
      defineRegistryItem({
        provides: [
          provide(executorCapabilityValueSpec, capability),
          provide(
            editorViewValueSpec,
            defineEditorView(
              executionContext(capability, () => services.get(executorsService))
            )({
              id: 'drawings.sheet',
              label: 'Drawings',
              matches: '.kcl',

              Component: ({ context }) =>
                createElement(DrawingsView, {
                  executor: context.executor,
                  capability,
                }),
            })
          ),
        ],
      }),
    ],
  })
}, 'drawings')

export default withProjectShellFeature(extension, 'drawings')
