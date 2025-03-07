import { trap } from 'lib/trap'
import { useState, useEffect } from 'react'
import { ensureProjectDirectoryExists, listProjects } from 'lib/desktop'
import { loadAndValidateSettings } from 'lib/settings/settingsUtils'
import { Project } from 'lib/project'
import { isDesktop } from 'lib/isDesktop'

// KEVIN: LIST PROJECTS INVOKED
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
        /* console.log('[kevin] final paths', JSON.parse(JSON.stringify(_projectPaths))) */
        setProjectPaths(_projectPaths)
      }
    })().catch(trap)

    console.log("[kevin] [deps] [project dir]", deps, projectsDir)
  }, deps ?? [])

  return {
    projectPaths,
    projectsDir,
  }
}
