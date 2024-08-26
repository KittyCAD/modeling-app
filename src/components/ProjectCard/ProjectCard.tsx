import { FormEvent, useEffect, useRef, useState } from 'react'
import { PATHS } from 'lib/paths'
import { Link } from 'react-router-dom'
import { ActionButton } from '../ActionButton'
import { FILE_EXT } from 'lib/constants'
import { useHotkeys } from 'react-hotkeys-hook'
import Tooltip from '../Tooltip'
import { DeleteConfirmationDialog } from './DeleteProjectDialog'
import { ProjectCardRenameForm } from './ProjectCardRenameForm'
import { Project } from 'lib/project'

function ProjectCard({
  project,
  handleRenameProject,
  handleDeleteProject,
  ...props
}: {
  project: Project
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    f: Project
  ) => Promise<void>
  handleDeleteProject: (f: Project) => Promise<void>
}) {
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [numberOfFiles, setNumberOfFiles] = useState(1)
  const [numberOfFolders, setNumberOfFolders] = useState(0)
  // const [imageUrl, setImageUrl] = useState('')

  let inputRef = useRef<HTMLInputElement>(null)

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void handleRenameProject(e, project).then(() => setIsEditing(false))
  }

  function getDisplayedTime(dateTimeMs: number) {
    const date = new Date(dateTimeMs)
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return date.getTime() < startOfToday.getTime()
      ? date.toLocaleDateString()
      : date.toLocaleTimeString()
  }

  useEffect(() => {
    async function getNumberOfFiles() {
      setNumberOfFiles(project.kcl_file_count)
      setNumberOfFolders(project.directory_count)
    }

    // async function setupImageUrl() {
    //   const projectImagePath = await join(project.file.path, PROJECT_IMAGE_NAME)
    //   if (await exists(projectImagePath)) {
    //     const imageData = await readFile(projectImagePath)
    //     const blob = new Blob([imageData], { type: 'image/jpg' })
    //     const imageUrl = URL.createObjectURL(blob)
    //     setImageUrl(imageUrl)
    //   }
    // }

    void getNumberOfFiles()
    // void setupImageUrl()
  }, [project.kcl_file_count, project.directory_count])

  useEffect(() => {
    if (inputRef.current && isEditing) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing, inputRef.current])

  return (
    <li
      {...props}
      className="group relative flex flex-col rounded-sm border border-primary/40 dark:border-chalkboard-80 hover:!border-primary"
    >
      <Link
        data-testid="project-link"
        to={`${PATHS.FILE}/${encodeURIComponent(project.default_file)}`}
        className="flex flex-col flex-1 !no-underline !text-chalkboard-110 dark:!text-chalkboard-10 group-hover:!hue-rotate-0 min-h-[5em] divide-y divide-primary/40 dark:divide-chalkboard-80 group-hover:!divide-primary"
      >
        {/* <div className="h-36 relative overflow-hidden bg-gradient-to-b from-transparent to-primary/10 rounded-t-sm">
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full transition-transform group-hover:scale-105 object-cover"
            />
          )}
        </div> */}
        <div className="pb-2 flex flex-col flex-grow flex-auto gap-2 rounded-b-sm">
          {isEditing ? (
            <ProjectCardRenameForm
              onSubmit={handleSave}
              className="flex items-center gap-2 p-2"
              onClick={(e) => e.stopPropagation()}
              project={project}
              onDismiss={() => setIsEditing(false)}
              ref={inputRef}
            />
          ) : (
            <h3 className="font-sans relative z-0 p-2">
              {project.name?.replace(FILE_EXT, '')}
            </h3>
          )}
          <span className="px-2 text-chalkboard-60 text-xs">
            {numberOfFiles} file{numberOfFiles === 1 ? '' : 's'}{' '}
            {numberOfFolders > 0 &&
              `/ ${numberOfFolders} folder${numberOfFolders === 1 ? '' : 's'}`}
          </span>
          <span className="px-2 text-chalkboard-60 text-xs">
            Edited{' '}
            {project.metadata && project.metadata.modified
              ? getDisplayedTime(parseInt(project.metadata.modified))
              : 'never'}
          </span>
        </div>
      </Link>
      {!isEditing && (
        <div
          className="absolute z-10 flex items-center gap-1 opacity-0 bottom-2 right-2 group-hover:opacity-100 group-focus-within:opacity-100"
          data-edit-buttons-for={project.name?.replace(FILE_EXT, '')}
        >
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'sketch',
              iconClassName: 'dark:!text-chalkboard-20',
              bgClassName: '!bg-transparent',
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.nativeEvent.stopPropagation()
              setIsEditing(true)
            }}
            className="!p-0"
          >
            <Tooltip position="top-right" delay={1000}>
              Rename project
            </Tooltip>
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'trash',
              iconClassName: 'dark:!text-chalkboard-30',
              bgClassName: '!bg-transparent',
            }}
            className="!p-0"
            onClick={(e) => {
              e.stopPropagation()
              e.nativeEvent.stopPropagation()
              setIsConfirmingDelete(true)
            }}
          >
            <Tooltip position="top-right" delay={1000}>
              Delete project
            </Tooltip>
          </ActionButton>
        </div>
      )}
      {isConfirmingDelete && (
        <DeleteConfirmationDialog
          title="Delete Project"
          onConfirm={async () => {
            await handleDeleteProject(project)
            setIsConfirmingDelete(false)
          }}
          onDismiss={() => setIsConfirmingDelete(false)}
        >
          <p className="my-4">
            This will permanently delete "{project.name || 'this file'}
            ".
          </p>
          <p className="my-4">
            Are you sure you want to delete "{project.name || 'this file'}
            "? This action cannot be undone.
          </p>
        </DeleteConfirmationDialog>
      )}
    </li>
  )
}

export default ProjectCard
