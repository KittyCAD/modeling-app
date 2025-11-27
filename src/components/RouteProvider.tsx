import { isCodeTheSame } from '@src/lib/codeEditor'
import type { ReactNode } from 'react'
import { createContext, useEffect, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigation,
  useRouteLoaderData,
} from 'react-router-dom'

import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { fsManager } from '@src/lang/std/fileSystemManager'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import { PATHS, getStringAfterLastSeparator } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { kclManager, settingsActor } from '@src/lib/singletons'
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
      if (eventType !== 'change') return

      // Try to detect file changes and overwrite the editor
      if (kclManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher) {
        kclManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = false
        return
      }

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
        if (filename && filename.type === 'Local' && filename.value === path) {
          return true
        }

        return false
      })

      const isCurrentFile = loadedProject?.file?.path === path
      if (isCurrentFile && eventType === 'change') {
        if (window.electron) {
          // Your current file is changed, read it from disk and write it into the code manager and execute the AST
          const code = await window.electron.readFile(path, {
            encoding: 'utf-8',
          })

          // Don't fire a re-execution if the kclManager already knows about this change,
          // which would be evident if we already have matching code there.
          if (!isCodeTheSame(code, kclManager.code)) {
            kclManager.updateCodeStateEditor(code)
            await kclManager.executeCode()
            await resetCameraPosition()
          }
        }
      } else if (
        (isImportedInCurrentFile || isInExecStateFilenames) &&
        eventType === 'change'
      ) {
        // Re execute the file you are in because an imported file was changed
        await kclManager.executeAst()
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
      const data = await loadAndValidateSettings(loadedProject?.project?.path)
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
