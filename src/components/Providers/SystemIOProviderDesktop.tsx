import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { PATHS } from '@src/lib/paths'
import { systemIOActor, useSettings } from '@src/machines/appMachine'
import {
  useHasListedProjects,
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
} from '@src/machines/systemIO/hooks'
import {
  folderSnapshot,
  defaultProjectFolderNameSnapshot,
} from '@src/machines/systemIO/snapshotContext'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { commandBarActor } from '@src/machines/commandBarMachine'

export function SystemIOMachineLogicListener() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const navigate = useNavigate()
  const settings = useSettings()

  const openProjectCommand: Command = {
    icon: 'arrowRight',
    name: 'Open projecct',
    displayName: `Open project`,
    description: 'Open a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        systemIOActor.send({
          type: SystemIOMachineEvents.navigateToProject,
          data: { requestedProjectName: record.name },
        })
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => {
          const folders = folderSnapshot()
          const options: CommandArgumentOption<any>[] = []
          folders.forEach((folder) => {
            options.push({
              name: folder.name,
              value: folder.name,
              isCurrent: false,
            })
          })
          return options
        },
      },
    },
  }

  const createProjectCommand: Command = {
    icon: 'folder',
    name: 'Create project',
    displayName: `Create project`,
    description: 'Create a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        systemIOActor.send({
          type: SystemIOMachineEvents.createProject,
          data: { requestedProjectName: record.name },
        })
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'string',
        defaultValue: defaultProjectFolderNameSnapshot,
      },
    },
  }

  useEffect(() => {
    const commands = [openProjectCommand, createProjectCommand]
    commandBarActor.send({
      type: 'Add commands',
      data: {
        commands,
      },
    })
    return () => {
      commandBarActor.send({
        type: 'Remove commands',
        data: {
          commands,
        },
      })
    }
  }, [])

  // Handle global project name navigation
  useEffect(() => {
    if (!requestedProjectName.name) {
      return
    }
    let projectPathWithoutSpecificKCLFile =
      projectDirectoryPath +
      window.electron.path.sep +
      requestedProjectName.name

    const requestedPath = `${PATHS.FILE}/${encodeURIComponent(
      projectPathWithoutSpecificKCLFile
    )}`
    navigate(requestedPath)
  }, [requestedProjectName])

  // Handle global file name navigation
  useEffect(() => {
    if (!requestedFileName.file || !requestedFileName.project) {
      return
    }
    const projectPath = window.electron.join(
      projectDirectoryPath,
      requestedFileName.project
    )
    const filePath = window.electron.join(projectPath, requestedFileName.file)
    const requestedPath = `${PATHS.FILE}/${encodeURIComponent(filePath)}`
    navigate(requestedPath)
  }, [requestedFileName])

  // Reload all folders when the project directory path changes
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath:
          settings.app.projectDirectory.current || '',
      },
    })
  }, [settings.app.projectDirectory.current])

  // Implement setting the default project folder name
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.setDefaultProjectFolderName,
      data: {
        requestedDefaultProjectFolderName:
          settings.projects.defaultProjectName.current || '',
      },
    })
  }, [settings.projects.defaultProjectName.current])

  useFileSystemWatcher(
    async () => {
      // Gotcha: Chokidar is buggy. It will emit addDir or add on files that did not get created.
      // This means while the application initialize and Chokidar initializes you cannot tell if
      // a directory or file is actually created or they are buggy signals. This means you must
      // ignore all signals during initialization because it is ambiguous. Once those signals settle
      // you can actually start listening to real signals.
      // If someone creates folders or files during initialization we ignore those events!
      if (!hasListedProjects) {
        return
      }
      systemIOActor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
    },
    settings.app.projectDirectory.current
      ? [settings.app.projectDirectory.current]
      : []
  )

  return null
}
