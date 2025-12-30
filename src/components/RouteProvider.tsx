import { isCodeTheSame } from '@src/lib/codeEditor'
import type { ReactNode } from 'react'
import { createContext, useEffect, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigation,
  useRouteLoaderData,
} from 'react-router-dom'
import toast from 'react-hot-toast'

import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { fsManager } from '@src/lang/std/fileSystemManager'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import { PATHS, getStringAfterLastSeparator } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import {
  kclManager,
  engineCommandManager,
  sceneInfra,
  settingsActor,
} from '@src/lib/singletons'
import { trap } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import { kclEditorActor } from '@src/machines/kclEditorMachine'
import { useSelector } from '@xstate/react'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  useAuthNavigation()
  const loadedProject = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const [first, setFirstState] = useState(true)
  const [settingsPath, setSettingsPath] = useState<string | undefined>(
    undefined
  )
  const navigation = useNavigation()
  const navigate = useNavigate()
  const location = useLocation()
  const livePathsToWatch = useSelector(
    kclEditorActor,
    (state) => state.context.livePathsToWatch
  )

  useEffect(() => {
    // On initialization, the react-router-dom does not send a 'loading' state event.
    // it sends an idle event first.
    const pathname = first ? location.pathname : navigation.location?.pathname
    const isHome = pathname === PATHS.HOME
    const isFile =
      pathname?.includes(PATHS.FILE) &&
      pathname?.substring(pathname?.length - 4) === '.kcl'
    if (isHome) {
      markOnce('code/willLoadHome')
    } else if (isFile) {
      markOnce('code/willLoadFile')
    }
    setFirstState(false)
  }, [first, navigation, location.pathname])

  useEffect(() => {
    if (!window.electron) return
    getAppSettingsFilePath(window.electron).then(setSettingsPath).catch(trap)
  }, [])

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
      // The mlEphantManagerMachine will set a special exception in kclManager.
      // Why not pull the actor context in here? Because this RouteProvider
      // is very high in the context tree, higher than mlEphant's.
      if (kclManager.mlEphantManagerMachineBulkManipulatingFileSystem) return

      const isCurrentFile = loadedProject?.file?.path === path
      if (isCurrentFile) {
        if (window.electron) {
          // Your current file is changed, read it from disk and write it into the code manager and execute the AST,
          // unless the change was initiated by us (the currently running instance).
          const code = await window.electron.readFile(path, {
            encoding: 'utf-8',
          })

          const lastWrittenCode = kclManager.lastWrite?.code
          if (!lastWrittenCode || !isCodeTheSame(lastWrittenCode, code)) {
            // Nothing written out yet by ourselves, or it's not the same as the current file content
            // -> this must be an external change -> re-execute.
            kclManager.updateCodeStateEditor(code)

            toast('Reloading file from disk')
            // If we can use emojis this looks nice:
            // toast('Reloading file from disk', { icon: '📁' })

            await kclManager.executeCode()

            // Only reset camera if we're not in sketch mode, in sketch mode we always want to keep ortho camera
            const isInSketchMode =
              kclManager.modelingState?.matches('Sketch') ||
              kclManager.modelingState?.matches('sketchSolveMode')
            if (!isInSketchMode) {
              await resetCameraPosition({
                sceneInfra,
                engineCommandManager,
                settingsActor,
              })
            }
          }
        }
      } else {
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
    livePathsToWatch
  )

  useFileSystemWatcher(
    async (eventType: string, path: string) => {
      // If there is a projectPath but it no longer exists it means
      // it was externally removed. If we let the code past this condition
      // execute it will recreate the directory due to code in
      // loadAndValidateSettings trying to recreate files. I do not
      // wish to change the behavior in case anything else uses it.
      // Go home.
      if (loadedProject?.project?.path) {
        if (!(await fsManager.exists(loadedProject?.project?.path))) {
          navigate(PATHS.HOME)
          return
        }
      }

      // Only reload if there are changes. Ignore everything else.
      if (eventType !== 'change') return

      // Note: currently settings are watched, reloaded even if it was initiated by us (e.g. by a user changing some settings),
      // writeCausedByAppCheckedInFileTreeFileSystemWatcher is not used here.
      const data = await loadAndValidateSettings(
        kclManager.wasmInstancePromise,
        loadedProject?.project?.path
      )
      settingsActor.send({
        type: 'Set all settings',
        settings: data.settings,
        doNotPersist: true,
      })
    },
    [settingsPath, loadedProject?.project?.path].filter(
      (x: string | undefined) => x !== undefined
    )
  )

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
    </RouteProviderContext.Provider>
  )
}
