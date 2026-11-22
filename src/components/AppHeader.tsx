import { useSignals } from '@preact/signals-react/runtime'
import { AppHeaderFrame } from '@src/components/AppHeaderFrame'
import { lspService } from '@src/lang/lsp/registry/contract'
import { useApp, useSingletons } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import type { ReactNode } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: header navigation (useNavigate).
import { useNavigate } from 'react-router-dom'

interface AppHeaderProps {
  project?: Project
  file?: FileEntry
  className?: string
  enableMenu?: boolean
  style?: React.CSSProperties
  nativeFileMenuCreated: boolean
  projectMenuChildren?: ReactNode
}

export const AppHeader = ({
  project,
  file,
  className = '',
  style,
  enableMenu = false,
  nativeFileMenuCreated,
  projectMenuChildren,
}: AppHeaderProps) => {
  useSignals()
  const app = useApp()
  const { kclManager } = useSingletons()
  const lsp = app.registry.required(lspService)
  const navigate = useNavigate()
  const executingPath = app.project?.executingPathSignal.value?.value
  const absoluteFilePath = executingPath
    ? PATHS.FILE + '/' + encodeURIComponent(executingPath)
    : undefined
  return (
    <AppHeaderFrame
      context={
        enableMenu
          ? {
              type: 'legacy-project',
              project,
              file,
              absoluteFilePath,
              projectMenuChildren,
              onProjectClose: (closedFile, projectPath, redirect) => {
                lsp.onProjectClose(closedFile, projectPath, redirect)
                if (redirect) void navigate(PATHS.HOME)
              },
              onHomeNavigate: () => kclManager.resetForFileSwitch(),
            }
          : { type: 'home' }
      }
      className={className}
      nativeFileMenuCreated={nativeFileMenuCreated}
      style={style}
    />
  )
}
