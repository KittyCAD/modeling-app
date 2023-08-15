import { FormEvent, useCallback, useEffect, useState } from 'react'
import { readDir, removeDir, renameFile } from '@tauri-apps/api/fs'
import {
  createNewProject,
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
  PROJECT_ENTRYPOINT,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import {
  faArrowDown,
  faArrowUp,
  faCircleDot,
  faPlus,
} from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../useStore'
import { toast } from 'react-hot-toast'
import { AppHeader } from '../components/AppHeader'
import ProjectCard from '../components/ProjectCard'
import { useLoaderData, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { FileWithMetadata, HomeLoaderData } from '../Router'
import Loading from '../components/Loading'
import { metadata } from 'tauri-plugin-fs-extra-api'

const DESC = ':desc'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const sort = searchParams.get('sort_by') ?? 'modified:desc'
  const { projects: loadedProjects } = useLoaderData() as HomeLoaderData
  const [isLoading, setIsLoading] = useState(true)
  const [projects, setProjects] = useState(loadedProjects || [])
  const { defaultDir, defaultProjectName } = useStore((s) => ({
    defaultDir: s.defaultDir,
    defaultProjectName: s.defaultProjectName,
  }))

  const refreshProjects = useCallback(
    async (projectDir = defaultDir) => {
      const readProjects = await await readDir(projectDir.dir, {
        recursive: true,
      })
      const filteredProjects = await Promise.all(
        readProjects
          .filter(
            (fileOrDir) =>
              fileOrDir.children &&
              fileOrDir.children.length &&
              fileOrDir.children.some(
                (child) => child.name === PROJECT_ENTRYPOINT
              )
          )
          .map(async (p) => ({
            metadata: await metadata(p.path),
            ...p,
          }))
      )

      setProjects(filteredProjects)
    },
    [defaultDir, setProjects]
  )

  useEffect(() => {
    refreshProjects(defaultDir).then(() => {
      setIsLoading(false)
    })
  }, [setIsLoading, refreshProjects, defaultDir])

  async function handleNewProject() {
    let projectName = defaultProjectName
    if (doesProjectNameNeedInterpolated(projectName)) {
      const nextIndex = await getNextProjectIndex(defaultProjectName, projects)
      projectName = interpolateProjectNameWithIndex(
        defaultProjectName,
        nextIndex
      )
    }

    await createNewProject(defaultDir.dir + '/' + projectName).catch((err) => {
      console.error('Error creating project:', err)
      toast.error('Error creating project')
    })

    await refreshProjects()
    toast.success('Project created')
  }

  async function handleRenameProject(
    e: FormEvent<HTMLFormElement>,
    project: FileWithMetadata
  ) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )
    if (newProjectName && project.name && newProjectName !== project.name) {
      const dir = project.path?.slice(0, project.path?.lastIndexOf('/'))
      await renameFile(project.path, dir + '/' + newProjectName).catch(
        (err) => {
          console.error('Error renaming project:', err)
          toast.error('Error renaming project')
        }
      )

      await refreshProjects()
      toast.success('Project renamed')
    }
  }

  async function handleDeleteProject(project: FileWithMetadata) {
    if (project.path) {
      await removeDir(project.path, { recursive: true }).catch((err) => {
        console.error('Error deleting project:', err)
        toast.error('Error deleting project')
      })

      await refreshProjects()
      toast.success('Project deleted')
    }
  }

  function getSortIcon(sortBy: string) {
    if (sort === sortBy) {
      return faArrowUp
    } else if (sort === sortBy + DESC) {
      return faArrowDown
    }
    return faCircleDot
  }

  function getNextSearchParams(sortBy: string) {
    if (sort === null || !sort)
      return { sort_by: sortBy + (sortBy !== 'modified' ? DESC : '') }
    if (sort.includes(sortBy) && !sort.includes(DESC)) return { sort_by: '' }
    return {
      sort_by: sortBy + (sort.includes(DESC) ? '' : DESC),
    }
  }

  function getSortFunction(sortBy: string) {
    const sortByName = (a: FileWithMetadata, b: FileWithMetadata) => {
      if (a.name && b.name) {
        return sortBy.includes('desc')
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name)
      }
      return 0
    }

    if (sortBy?.includes('name')) {
      return sortByName
    } else {
      return () => 0
    }
  }

  return (
    <div className="h-screen overflow-hidden relative flex flex-col">
      <AppHeader showToolbar={false} />
      <div className="my-24 overflow-y-auto max-w-5xl w-full mx-auto">
        <section className="flex justify-between">
          <h1 className="text-3xl text-bold">Your Projects</h1>
          <div className="flex">
            <ActionButton
              Element="button"
              onClick={() => setSearchParams(getNextSearchParams('name'))}
              icon={{
                icon: getSortIcon('name'),
                bgClassName: !sort?.includes('name')
                  ? 'bg-liquid-30 dark:bg-liquid-70'
                  : '',
              }}
            >
              Name
            </ActionButton>
          </div>
        </section>
        <section>
          <p className="my-4 text-sm text-chalkboard-80 dark:text-chalkboard-30">
            Are being saved at{' '}
            <code className="text-liquid-80 dark:text-liquid-30">
              {defaultDir.dir}
            </code>
            , which you can change in your <Link to="settings">Settings</Link>.
          </p>
          {isLoading ? (
            <Loading>Loading your Projects...</Loading>
          ) : (
            <>
              {projects.length > 0 ? (
                <ul className="my-8 w-full grid grid-cols-4 gap-4">
                  {projects.sort(getSortFunction(sort)).map((project) => (
                    <ProjectCard
                      key={project.name}
                      project={project}
                      handleRenameProject={handleRenameProject}
                      handleDeleteProject={handleDeleteProject}
                    />
                  ))}
                </ul>
              ) : (
                <p className="rounded my-8 border border-dashed border-chalkboard-30 dark:border-chalkboard-70 p-4">
                  No Projects found, ready to make your first one?
                </p>
              )}
              <ActionButton
                Element="button"
                onClick={handleNewProject}
                icon={{ icon: faPlus }}
              >
                New file
              </ActionButton>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default Home
