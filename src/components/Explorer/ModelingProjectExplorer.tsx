import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import { useRouteLoaderData } from 'react-router-dom'
import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/utils'
import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import { useFolders } from '@src/machines/systemIO/hooks'
import { useState, useEffect } from 'react'
import type { Project } from '@src/lib/project'

export const ModelingProjectExplorer = () => {
  const projects = useFolders()
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const [theProject, setTheProject] = useState<Project | null>(null)
  const { project } = loaderData
  useEffect(() => {
    // Have no idea why the project loader data doesn't have the children from the ls on disk
    // That means it is a different object or cached incorrectly?
    if (!project) {
      return
    }

    // You need to find the real project in the storage from the loader information since the loader Project is not hydrated
    const theProject = projects.find((p) => {
      return p.name === project.name
    })

    if (!theProject) {
      return
    }

    // Duplicate the state to not edit the raw data
    const duplicated = JSON.parse(JSON.stringify(theProject))
    addPlaceHoldersForNewFileAndFolder(duplicated.children, theProject.path)
    setTheProject(duplicated)
  }, [projects])

  return (
    <>
      {theProject ? (
        <ProjectExplorer project={theProject}></ProjectExplorer>
      ) : (
        <div></div>
      )}
    </>
  )
}
