import { computed, signal } from '@preact/signals-core'
import { selectCommand } from '@src/lib/commandUtils'
import {
  isExtensionARelevantExtension,
  toProjectRelativePath,
} from '@src/lib/paths'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { reportRejection } from '@src/lib/trap'
import { observations as commandsObservations } from '@src/registry/contracts/commands'
import {
  type ProjectExplorerRowContextMenuItem,
  type ProjectExplorerRowContextMenuItemContext,
  projectExplorerProjectMenuItemsFacet,
  projectExplorerRowContextMenuItemsFacet,
} from '@src/registry/contracts/projectExplorer'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import {
  extension as defineExtension,
  contribute,
  type InputOf,
  type Extension,
} from 'plankton'
const importInCurrentFileExtension: Extension = defineExtension({
  dependencies: { wasm: wasmObservations, commands: commandsObservations },
  key: 'project-explorer.import-in-current-file',
  create: ({ wasm: wasmInputs, commands: commandsInputs }) => {
    const importExtensions = signal<string[]>([])
    let disposed = false
    let wasmRevision = 0
    let stopWasmSubscription: (() => void) | undefined

    // Resolve dependencies after the registry graph has been constructed.
    void Promise.resolve()
      .then(() => {
        if (disposed) return
        stopWasmSubscription = wasmInputs.wasmPromiseFacet.subscribe(
          (wasmPromise) => {
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
                if (!disposed && revision === wasmRevision)
                  reportRejection(error)
              })
          }
        )
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
          selectCommand(commandsInputs.commandSystemService.required(), {
            name: 'Import',
            groupId: 'code',
            argDefaultValues: {
              path: toProjectRelativePath(
                context.project.path,
                context.row.path
              ),
            },
          })
        },
      }
    })
    return {
      items: [
        contribute(
          projectExplorerRowContextMenuItemsFacet,
          () => importItem.value,
          {
            key: 'import-in-current-file',
          }
        ),
      ],
      dispose: () => {
        disposed = true
        stopWasmSubscription?.()
      },
    }
  },
})
const _projectExplorerProjectMenuItemsContribution: InputOf<
  typeof projectExplorerProjectMenuItemsFacet
> = {
  id: 'reveal-in-file-explorer.project-menu',
  order: 100,
  label: 'Reveal in file explorer',
  dataTestId: 'project-sidebar-reveal-in-file-explorer',
  isVisible: ({ projectPath }) =>
    Boolean(projectPath) && canRevealInFileExplorer(),
  onSelect: ({ projectPath }) => revealInFileExplorer(projectPath),
} satisfies InputOf<typeof projectExplorerProjectMenuItemsFacet>
const _projectExplorerRowContextMenuItemsContribution: InputOf<
  typeof projectExplorerRowContextMenuItemsFacet
> = {
  id: 'reveal-in-file-explorer.row-context-menu',
  order: 100,
  label: 'Reveal in file explorer',
  dataTestId: 'context-menu-reveal-in-file-explorer',
  isVisible: ({ row }) => !row.isFake && canRevealInFileExplorer(),
  onSelect: ({ row }) => revealInFileExplorer(row.path),
} satisfies InputOf<typeof projectExplorerRowContextMenuItemsFacet>
const projectExplorerExtension = [
  importInCurrentFileExtension,
  contribute(
    projectExplorerProjectMenuItemsFacet,
    () => _projectExplorerProjectMenuItemsContribution,
    {
      key: 'reveal-in-file-explorer.project-menu',
    }
  ),
  contribute(
    projectExplorerRowContextMenuItemsFacet,
    () => _projectExplorerRowContextMenuItemsContribution,
    {
      key: 'reveal-in-file-explorer.row-context-menu',
    }
  ),
]
export default projectExplorerExtension
