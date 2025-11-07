import {
  readRecentProjectsFile,
  writeRecentProjectsFile,
} from '@src/lib/desktop'
import { RECENT_PROJECTS_COUNT, type RecentProject } from '@src/lib/constants'

export async function saveToRecentProjects(path: string, id: string) {
  if (!window.electron) {
    console.warn(
      'Cannot save to recent projects: window.electron is not available'
    )
    return
  }

  const electron = window.electron
  let recentProjects = await readRecentProjectsFile(electron)
  if (!recentProjects) {
    recentProjects = []
  }

  // Remove any existing entry for this projectPath
  recentProjects = recentProjects.filter((proj) => proj.path !== path)

  // Add the new entry to the start of the list
  const lastOpened = new Date()
  recentProjects.unshift({ path, id, lastOpened })
  await writeRecentProjectsFile(
    electron,
    recentProjects.slice(0, RECENT_PROJECTS_COUNT)
  )
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  if (!window.electron) {
    console.warn('Cannot get recent projects: window.electron is not available')
    return []
  }

  const electron = window.electron
  const recentProjects = await readRecentProjectsFile(electron)
  return recentProjects || []
}
