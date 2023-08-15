import { FormEvent, useCallback, useEffect, useState } from 'react'
import Loading from '../components/Loading'
import { FileEntry, readDir, removeDir, renameFile } from '@tauri-apps/api/fs'
import {
  createNewProject,
  getNextProjectIndex,
  initializeProjectDirectory,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
  PROJECT_ENTRYPOINT,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import {
  faArrowDown,
  faArrowUp,
  faPlus,
} from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../useStore'
import { toast } from 'react-hot-toast'
import { AppHeader } from '../components/AppHeader'
import ProjectCard from '../components/ProjectCard'
import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [projects, setProjects] = useState<FileEntry[]>([])
  const { defaultDir, defaultProjectName } = useStore((s) => ({
    defaultDir: s.defaultDir,
    defaultProjectName: s.defaultProjectName,
  }))

  const refreshProjects = useCallback(
    async (projectDir = defaultDir) => {
      const readProjects = await await readDir(projectDir.dir, {
        recursive: true,
      })
      const filteredProjects = readProjects.filter(
        (fileOrDir) =>
          fileOrDir.children &&
          fileOrDir.children.length &&
          fileOrDir.children.some((child) => child.name === PROJECT_ENTRYPOINT)
      )

      setProjects(filteredProjects)
    },
    [defaultDir, setProjects]
  )

  useEffect(() => {
    initializeProjectDirectory().then(async (projectDir) => {
      await refreshProjects(projectDir)
      setIsLoading(false)
    })
  }, [setIsLoading, refreshProjects])

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
    project: FileEntry
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

  async function handleDeleteProject(project: FileEntry) {
    if (project.path) {
      await removeDir(project.path, { recursive: true }).catch((err) => {
        console.error('Error deleting project:', err)
        toast.error('Error deleting project')
      })

      await refreshProjects()
      toast.success('Project deleted')
    }
  }

  function getSortFunction(sortBy: string | null) {
    if (sortBy?.includes('name')) {
      return (a: FileEntry, b: FileEntry) => {
        if (a.name && b.name) {
          return sortBy.includes('desc')
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name)
        }
        return 0
      }
    }
    return (a: FileEntry, b: FileEntry) => {
      if (a.name && b.name) {
        return b.name.localeCompare(a.name)
      }
      return 0
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
              onClick={() =>
                setSearchParams({
                  sort_by:
                    'name' +
                    (searchParams.get('sort_by') === 'name' ? ':desc' : ''),
                })
              }
              icon={{
                icon:
                  searchParams.get('sort_by') === 'name'
                    ? faArrowUp
                    : faArrowDown,
              }}
            >
              {searchParams.get('sort_by') === 'name' ? 'Z-A' : 'A-Z'}
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
                  {projects
                    .sort(getSortFunction(searchParams.get('sort_by')))
                    .map((project) => (
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
