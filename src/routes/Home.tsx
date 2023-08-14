import { FormEvent, useEffect, useState } from 'react'
import Loading from '../components/Loading'
import { FileEntry, readDir, removeFile, renameFile } from '@tauri-apps/api/fs'
import {
  FILE_EXT,
  createNewProject,
  getNextProjectIndex,
  initializeProjectDirectory,
  interpolateProjectNameWithIndex,
  projectNameNeedsInterpolated,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../useStore'
import { toast } from 'react-hot-toast'
import { AppHeader } from '../components/AppHeader'
import ProjectCard from '../components/ProjectCard'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  const [isLoading, setIsLoading] = useState(true)
  const [projects, setProjects] = useState<FileEntry[]>([])
  const { defaultDir, defaultProjectName } = useStore((s) => ({
    defaultDir: s.defaultDir,
    defaultProjectName: s.defaultProjectName,
  }))

  useEffect(() => {
    initializeProjectDirectory().then(async (projectDir) => {
      const readProjects = await readDir(projectDir.dir)
      setProjects(readProjects)
      setIsLoading(false)
    })
  }, [setProjects, setIsLoading])

  async function handleNewProject() {
    let filename = defaultProjectName
    if (projectNameNeedsInterpolated(filename)) {
      const nextIndex = await getNextProjectIndex(defaultProjectName, projects)
      filename = interpolateProjectNameWithIndex(defaultProjectName, nextIndex)
    }

    const newFile = await createNewProject(defaultDir.dir + '/' + filename)
    setProjects([...projects, newFile])
  }

  async function handleRenameProject(
    e: FormEvent<HTMLFormElement>,
    project: FileEntry
  ) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )
    if (
      newProjectName &&
      project.name &&
      newProjectName !== project.name.replace(FILE_EXT, '')
    ) {
      const dir = project.path?.replace(project.name, '') || ''
      await renameFile(project.path, dir + newProjectName + FILE_EXT).catch(
        (err) => {
          console.error('Error renaming file:', err)
          toast.error('Error renaming file')
        }
      )

      setProjects(
        Object.assign([
          ...projects.map((p) =>
            p.name === project.name
              ? Object.assign(project, {
                  name: newProjectName + FILE_EXT,
                  path: dir + newProjectName + FILE_EXT,
                })
              : p
          ),
        ])
      )
      toast.success('Project renamed')
    }
  }

  async function handleDeleteProject(file: FileEntry) {
    if (file.path) {
      await removeFile(file.path).catch((err) => {
        console.error('Error renaming file:', err)
        toast.error('Error renaming file')
      })

      setProjects([...projects.filter((p) => p.name !== file.name)])
      toast.success('File deleted')
    }
  }

  return (
    <div className="h-screen overflow-hidden relative flex flex-col">
      <AppHeader showToolbar={false} />
      <div className="my-24 max-w-5xl w-full mx-auto">
        <h1 className="text-3xl text-bold">Home</h1>
        {isLoading ? (
          <Loading>Loading your Projects...</Loading>
        ) : (
          <>
            {projects.length > 0 ? (
              <ul className="my-8 w-full grid grid-cols-4 gap-4">
                {projects.map((project) => (
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
      </div>
    </div>
  )
}

export default Home
