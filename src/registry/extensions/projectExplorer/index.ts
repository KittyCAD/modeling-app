import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import {
  isExtensionARelevantExtension,
  toProjectRelativePath,
} from '@src/lib/paths'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { reportRejection } from '@src/lib/trap'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  type ProjectExplorerRowContextMenuItem,
  type ProjectExplorerRowContextMenuItemContext,
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

const importInCurrentFileExtension = defineRegistryItemFactory((ctx) => {
  const importExtensions = signal<string[]>([])
  let disposed = false
  let wasmRevision = 0
  let stopWasmSubscription: (() => void) | undefined

  // Resolve dependencies after the registry graph has been constructed.
  void Promise.resolve()
    .then(() => {
      if (disposed) return
      stopWasmSubscription = ctx.valueSpecs
        .signal(wasmPromiseValueSpec)
        .subscribe((wasmPromise) => {
          const revision = ++wasmRevision
          importExtensions.value = []
          void wasmPromise
            ?.then((wasm) => {
              if (!disposed && revision === wasmRevision) {
                importExtensions.value = [
                  'kcl',
                  ...wasm.import_file_extensions(),
                ]
              }
            })
            .catch((error) => {
              if (!disposed && revision === wasmRevision) reportRejection(error)
            })
        })
    })
    .catch(reportRejection)

  const importItem = computed<ProjectExplorerRowContextMenuItem>(() => {
    const extensions = importExtensions.value
    const isVisible = ({
      row,
      project,
      file,
      readOnly,
    }: ProjectExplorerRowContextMenuItemContext) =>
      readOnly === false &&
      !!project &&
      !!file &&
      !row.isFolder &&
      !row.isFake &&
      row.path !== file.path &&
      isExtensionARelevantExtension(row.path, extensions)

    return {
      id: 'import-in-current-file',
      label: 'Import in current file',
      dataTestId: 'context-menu-import-in-current-file',
      isVisible,
      onSelect: (context) => {
        if (!context.project || !isVisible(context)) return
        ctx.services.get(commandSystemService).send({
          type: 'Find and select command',
          data: {
            name: 'Import',
            groupId: 'code',
            argDefaultValues: {
              path: toProjectRelativePath(
                context.project.path,
                context.row.path
              ),
            },
          },
        })
      },
    }
  })

  return {
    id: 'project-explorer.import-in-current-file',
    provides: [
      provide(projectExplorerRowContextMenuItemsValueSpec, importItem, {
        key: 'import-in-current-file',
      }),
    ],
    dispose: () => {
      disposed = true
      stopWasmSubscription?.()
    },
  }
}, 'project-explorer.import-in-current-file')

const projectExplorerExtension = defineRegistryItem({
  id: 'project-explorer',
  uses: [importInCurrentFileExtension],
  provides: [
    provide(
      projectExplorerProjectMenuItemsValueSpec,
      {
        id: 'reveal-in-file-explorer.project-menu',
        order: 100,
        label: 'Reveal in file explorer',
        dataTestId: 'project-sidebar-reveal-in-file-explorer',
        isVisible: ({ projectPath }) =>
          Boolean(projectPath) && canRevealInFileExplorer(),
        onSelect: ({ projectPath }) => revealInFileExplorer(projectPath),
      },
      { key: 'reveal-in-file-explorer.project-menu' }
    ),
    provide(
      projectExplorerRowContextMenuItemsValueSpec,
      {
        id: 'reveal-in-file-explorer.row-context-menu',
        order: 100,
        label: 'Reveal in file explorer',
        dataTestId: 'context-menu-reveal-in-file-explorer',
        isVisible: ({ row }) => !row.isFake && canRevealInFileExplorer(),
        onSelect: ({ row }) => revealInFileExplorer(row.path),
      },
      { key: 'reveal-in-file-explorer.row-context-menu' }
    ),
  ],
})

export default projectExplorerExtension
