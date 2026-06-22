import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { FILE_EXT } from '@src/lib/constants'
import { PATHS, toProjectRelativePath } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

const setExecutingFileCommandInfo = {
  name: 'set-executing-file',
  groupId: 'projects',
} as const

const clearExecutingFileCommandInfo = {
  name: 'clear-executing-file',
  groupId: 'projects',
} as const

function collectKclFiles(entry: FileEntry | undefined): FileEntry[] {
  if (!entry) {
    return []
  }

  if (entry.children === null) {
    return entry.path.endsWith(FILE_EXT) ? [entry] : []
  }

  return entry.children.flatMap(collectKclFiles)
}

export function useExecutingFileCommands() {
  useSignals()
  const { commands, projectSession } = useApp()
  const navigate = useNavigate()
  const project = projectSession.openedProject.value
  const projectInfo = project?.projectIORefSignal.value
  const executingPath = project?.executingPathSignal.value?.value

  const projectCommands = useMemo<Command[]>(() => {
    const kclFiles = projectInfo?.children?.flatMap(collectKclFiles) ?? []
    const fileOptions: CommandArgumentOption<string>[] = kclFiles.map(
      (file) => {
        const relativePath = projectInfo
          ? toProjectRelativePath(projectInfo.path, file.path)
          : file.name
        return {
          name: relativePath || file.name,
          value: file.path,
          isCurrent: file.path === executingPath,
        }
      }
    )

    return [
      {
        icon: 'file',
        name: setExecutingFileCommandInfo.name,
        displayName: 'Set executing file',
        description: 'Select the KCL file to edit and run',
        groupId: setExecutingFileCommandInfo.groupId,
        needsReview: false,
        disabled: !projectInfo || fileOptions.length === 0,
        onSubmit: (record) => {
          const filePath =
            record && typeof record.filePath === 'string'
              ? record.filePath
              : undefined
          if (!filePath || !projectInfo) {
            return
          }

          projectSession
            .setExecutingEditorHandle({
              projectPath: projectInfo.path,
              filePath,
            })
            .then(() => {
              void navigate(`${PATHS.FILE}/${encodeURIComponent(filePath)}`)
            })
            .catch(reportRejection)
        },
        args: {
          filePath: {
            displayName: 'Executing file',
            inputType: 'options',
            required: true,
            options: fileOptions,
          },
        },
      },
      {
        icon: 'file',
        name: clearExecutingFileCommandInfo.name,
        displayName: 'Clear executing file',
        description: 'Clear the current executing file',
        groupId: clearExecutingFileCommandInfo.groupId,
        needsReview: false,
        disabled: !projectInfo || !executingPath,
        onSubmit: () => {
          if (!projectInfo) {
            return
          }

          projectSession
            .setExecutingEditorHandle(undefined)
            .then(() => {
              void navigate(
                `${PATHS.FILE}/${encodeURIComponent(projectInfo.path)}`
              )
            })
            .catch(reportRejection)
        },
      },
    ]
  }, [executingPath, navigate, projectInfo, projectSession])

  useEffect(() => {
    commands.send({
      type: 'Add commands',
      data: { commands: projectCommands },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: { commands: projectCommands },
      })
    }
  }, [commands, projectCommands])
}

export const findSetExecutingFileCommand = setExecutingFileCommandInfo
export const findClearExecutingFileCommand = clearExecutingFileCommandInfo
