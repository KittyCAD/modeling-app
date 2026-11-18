import { computed, signal } from '@preact/signals-core'
import { selectCommand } from '@src/lib/commandUtils'
import {
  isExtensionARelevantExtension,
  toProjectRelativePath,
} from '@src/lib/paths'
import {
  canRevealPathInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { reportRejection } from '@src/lib/trap'
import { observations as commandsObservations } from '@src/registry/contracts/commands'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import {
  type ProjectExplorerRowContextMenuItem,
  type ProjectExplorerRowContextMenuItemContext,
  projectExplorerProjectMenuItemsFacet,
  projectExplorerRowContextMenuItemsFacet,
} from '@src/registry/contracts/projectExplorer'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { factory as defineFactory, contribute, type Factory } from 'plankton'
const importInCurrentFileExtension: Factory = defineFactory({
  dependencies: { wasm: wasmObservations, commands: commandsObservations },
  key: 'project-explorer.import-in-current-file',
  create: ({ wasm: wasmInputs, commands: commandsInputs }) => {
    const importExtensions = signal<string[]>([])
    let disposed = false
    let wasmRevision = 0
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
      start: () => {
        const stop = wasmInputs.wasmPromiseFacet.subscribe((wasmPromise) => {
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
        return () => {
          disposed = true
          stop()
        }
      },
      items: [
        contribute(
          projectExplorerRowContextMenuItemsFacet,
          () => importItem.value,
          {
            key: 'import-in-current-file',
          }
        ),
      ],
    }
  },
})
const revealInFileExplorerExtension = defineFactory({
  dependencies: { fileOperations: fileOperationsObservations },
  key: 'project-explorer.reveal-in-file-explorer',
  create: ({ fileOperations }) => {
    const canRevealPath = (path: string) =>
      canRevealPathInFileExplorer(
        path,
        fileOperations.fileOperationsMountsFacet.value
      )

    return {
      items: [
        contribute(
          projectExplorerProjectMenuItemsFacet,
          () => ({
            id: 'reveal-in-file-explorer.project-menu',
            order: 100,
            label: 'Reveal in file explorer',
            dataTestId: 'project-sidebar-reveal-in-file-explorer',
            isVisible: ({ projectPath }) => canRevealPath(projectPath),
            onSelect: ({ projectPath }) => revealInFileExplorer(projectPath),
          }),
          { key: 'reveal-in-file-explorer.project-menu' }
        ),
        contribute(
          projectExplorerRowContextMenuItemsFacet,
          () => ({
            id: 'reveal-in-file-explorer.row-context-menu',
            order: 100,
            label: 'Reveal in file explorer',
            dataTestId: 'context-menu-reveal-in-file-explorer',
            isVisible: ({ row }) => !row.isFake && canRevealPath(row.path),
            onSelect: ({ row }) => revealInFileExplorer(row.path),
          }),
          { key: 'reveal-in-file-explorer.row-context-menu' }
        ),
      ],
    }
  },
})

export default [importInCurrentFileExtension, revealInFileExplorerExtension]
