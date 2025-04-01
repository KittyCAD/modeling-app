import { trap } from 'lib/trap'
import { useState, useEffect } from 'react'
import { ensureProjectDirectoryExists, listProjects } from 'lib/desktop'
import { loadAndValidateSettings } from 'lib/settings/settingsUtils'
import { Project } from 'lib/project'
import { isDesktop } from 'lib/isDesktop'

// Gotcha: This should be ported to the ProjectMachine and keep track of
// projectDirs and projectPaths in the context when it internally calls listProjects
// Hook uses [number] to give users familiarity. It is meant to mimic a
// dependency array, but is intended to only ever be used with 1 value.
export const useProjectsLoader = (deps?: [number]) => {
  const [lastTs, setLastTs] = useState(-1)
  const [projectPaths, setProjectPaths] = useState<Project[]>([])
  const [projectsDir, setProjectsDir] = useState<string | undefined>(undefined)

  useEffect(() => {
    // Useless on web, until we get fake filesystems over there.
    if (!isDesktop()) return

    if (deps && deps[0] === lastTs) return

    if (deps) {
      setLastTs(deps[0])
    }

    ;(async () => {
      const { configuration } = await loadAndValidateSettings()
      const _projectsDir = await ensureProjectDirectoryExists(configuration)
      setProjectsDir(_projectsDir)

      if (projectsDir) {
        const _projectPaths = await listProjects(configuration)
        setProjectPaths(_projectPaths)
      }
    })().catch(trap)
  }, deps ?? [])

  return {
    projectPaths,
    projectsDir,
  }
}
