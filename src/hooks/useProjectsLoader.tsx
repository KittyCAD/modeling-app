import { useEffect, useState } from 'react'

import { useSingletons } from '@src/lib/boot'
import { getInitialProjectDirectoryPath, listProjects } from '@src/lib/desktop'
import type { Project } from '@src/lib/project'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { trap } from '@src/lib/trap'

// Gotcha: This should be ported to the ProjectMachine and keep track of
// projectDirs and projectPaths in the context when it internally calls listProjects
// Hook uses [number] to give users familiarity. It is meant to mimic a
// dependency array, but is intended to only ever be used with 1 value.
export const useProjectsLoader = (deps?: [number]) => {
  const { kclManager } = useSingletons()
  const [lastTs, setLastTs] = useState(-1)
  const [projectPaths, setProjectPaths] = useState<Project[]>([])
  const [projectsDir, setProjectsDir] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (deps && deps[0] === lastTs) return

    if (deps) {
      setLastTs(deps[0])
    }
    ;(async () => {
      const wasmInstance = await kclManager.wasmInstancePromise
      const { configuration } = await loadAndValidateSettings(wasmInstance)
      const _projectsDir = await getInitialProjectDirectoryPath(wasmInstance)
      setProjectsDir(_projectsDir)

      const _projectPaths = await listProjects(wasmInstance, configuration)
      setProjectPaths(_projectPaths)
    })().catch(trap)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, deps ?? [])

  return {
    projectPaths,
    projectsDir,
  }
}
