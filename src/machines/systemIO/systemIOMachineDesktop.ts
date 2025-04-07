import { SystemIOMachineEvents, SystemIOMachineActors, SystemIOContext, NO_PROJECT_DIRECTORY} from "@src/machines/systemIO/utils"
import { systemIOMachine} from "@src/machines/systemIO/systemIOMachine"
import { setup, fromPromise, assign, assertEvent} from 'xstate'
import { mkdirOrNOOP, getProjectInfo } from "@src/lib/desktop"
import type { Project } from '@src/lib/project'

export const systemIOMachineDesktop = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(async ({input:context}:{input:SystemIOContext}) => {
      const projects = []
      const projectDirectoryPath = context.projectDirectoryPath
      if (projectDirectoryPath === NO_PROJECT_DIRECTORY) {
        // TODO
        return []
      }
      await mkdirOrNOOP(projectDirectoryPath)
      // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
      const entries = await window.electron.readdir(projectDirectoryPath)
      const { value: canReadWriteProjectDirectory } = await window.electron.canReadWriteDirectory(projectDirectoryPath)

      for (let entry of entries) {
        // Skip directories that start with a dot
        if (entry.startsWith('.')) {
          continue
        }
        const projectPath = window.electron.path.join(projectDirectoryPath, entry)

        // if it's not a directory ignore.
        // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
        const isDirectory = await window.electron.statIsDirectory(projectPath)
        if (!isDirectory) {
          continue
        }
        const project : Project = await getProjectInfo(projectPath)
        if (
          project.kcl_file_count === 0 &&
          project.readWriteAccess &&
          canReadWriteProjectDirectory
        ) {
          continue
        }
        projects.push(project)
      }
      return projects
    })
  }
})
