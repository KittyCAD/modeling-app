import { useSignals } from '@preact/signals-react/runtime'
import { SessionExpiredDialogHost } from '@src/components/SessionExpiredDialog'
import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useApp, useSingletons } from '@src/lib/boot'
import { getStringAfterLastSeparator } from '@src/lib/paths'
import type { ReactNode } from 'react'
import { createContext } from 'react'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  useSignals()
  const app = useApp()
  const { project } = app
  const { kclManager } = useSingletons()
  useAuthNavigation()
  const loadedFile = project?.executingFileEntry.value

  useFileSystemWatcher(
    async (eventType: string, path: string) => {
      // Only reload if there are changes. Ignore everything else.
      if (eventType !== 'change') {
        return
      }

      // Earlier method, this doesn't hurt but it's not needed anymore..
      if (kclManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher) {
        kclManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = false
        return
      }

      // ZOOKEEPER BEHAVIOR EXCEPTION
      // If the changes are caused by Zookeeper, ignore. The files are bulk
      // created, but because they are created one-by-one on disk, the system
      // races between reading and execution.
      // The zookeeperManagerMachine will set a special exception in kclManager.
      // Why not pull the actor context in here? Because this RouteProvider
      // is very high in the context tree, higher than zookeeper's.
      if (kclManager.zookeeperManagerMachineBulkManipulatingFileSystem) return

      // We only react on files other than the currently-executing one here
      // because the currently-executing one is handled with its own watcher in
      // KclManager. In future, all files and folders will watch themselves.
      if (loadedFile?.path !== path) {
        const fileNameWithExtension = getStringAfterLastSeparator(path)
        // Is the file from the change event type imported into the currently opened file
        const isImportedInCurrentFile = kclManager.ast.body.some(
          (n) =>
            n.type === 'ImportStatement' &&
            ((n.path.type === 'Kcl' &&
              n.path.filename.includes(fileNameWithExtension)) ||
              (n.path.type === 'Foreign' &&
                n.path.path.includes(fileNameWithExtension)))
        )

        const isInExecStateFilenames = Object.values(
          kclManager.execState.filenames
        ).some((filename) => {
          if (
            filename &&
            filename.type === 'Local' &&
            filename.value === path
          ) {
            return true
          }

          return false
        })
        if (isImportedInCurrentFile || isInExecStateFilenames) {
          // Re execute the file you are in because an imported file was changed
          await kclManager.executeAst()
        }
      }
    },
    // This will build up for as many files you select and never remove until you exit the project to unmount the file watcher hook
    kclManager.livePathsToWatch.value
  )

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
      <SessionExpiredDialogHost />
    </RouteProviderContext.Provider>
  )
}
