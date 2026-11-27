import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { removeDragPreviewElement, setDragPreview } from '@src/lib/dragPreview'
import {
  areProjectLibrarySettingsEqual,
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  moveProjectLibrarySetting,
  NEW_PROJECT_LIBRARY_TITLE,
  normalizeProjectLibrarySetting,
  type ProjectLibrarySetting,
  updateProjectLibrarySettingAt,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { type DragEvent, useEffect, useRef, useState } from 'react'

interface ProjectLibrariesSettingInputProps {
  value: ProjectLibrarySetting[]
  updateValue: (value: ProjectLibrarySetting[]) => void
}

const defaultDirectoryLibrary = {
  title: DEFAULT_PROJECT_LIBRARY_TITLE,
  path: 'projects',
  type: DIRECTORY_PROJECT_LIBRARY_TYPE,
} satisfies ProjectLibrarySetting

interface ProjectLibrarySettingsDetailsProps {
  library: ProjectLibrarySetting
  index: number
  updateLibrary: (library: ProjectLibrarySetting) => void
  commitLibrary: (library?: ProjectLibrarySetting) => void
  chooseDirectory: (defaultPath: string) => Promise<string | undefined>
}

function DirectoryProjectLibrarySettingsDetails({
  library,
  index,
  updateLibrary,
  commitLibrary,
  chooseDirectory,
}: ProjectLibrarySettingsDetailsProps) {
  async function chooseLibraryPath() {
    const selectedPath = await chooseDirectory(library.path)
    if (!selectedPath) {
      return
    }

    commitLibrary({
      ...library,
      path: selectedPath,
    })
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        value={library.path}
        onChange={(event) =>
          updateLibrary({
            ...library,
            path: event.target.value,
          })
        }
        onBlur={() => commitLibrary()}
        className="h-8 min-w-0 flex-1 rounded-sm border border-chalkboard-30 bg-transparent px-1 text-sm dark:border-chalkboard-70"
        data-testid={
          index === 0 ? 'project-directory-input' : 'project-library-path'
        }
      />
      <ActionButton
        Element="button"
        type="button"
        tabIndex={0}
        onClick={toSync(chooseLibraryPath, reportRejection)}
        className="h-8 w-8 shrink-0 justify-center !p-0"
        iconStart={{
          icon: 'folder',
          bgClassName: '!bg-transparent',
        }}
        data-testid={
          index === 0
            ? 'project-directory-button'
            : 'project-library-folder-button'
        }
      >
        <Tooltip position="top-right">Change location</Tooltip>
      </ActionButton>
    </div>
  )
}

export function ProjectLibrariesSettingInput({
  value,
  updateValue,
}: ProjectLibrariesSettingInputProps) {
  const electron = window.electron
  const typeLabel = 'Directory'
  const [draftLibraries, setDraftLibraries] =
    useState<ProjectLibrarySetting[]>(value)
  const committedLibrariesRef = useRef<ProjectLibrarySetting[]>(value)
  const [draggedLibraryIndex, setDraggedLibraryIndex] = useState<number | null>(
    null
  )
  const [dragOverLibraryIndex, setDragOverLibraryIndex] = useState<
    number | null
  >(null)
  const dragPreviewIdRef = useRef<string | null>(null)

  useEffect(() => {
    committedLibrariesRef.current = value
    setDraftLibraries(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (dragPreviewIdRef.current) {
        removeDragPreviewElement(dragPreviewIdRef.current)
      }
    }
  }, [])

  function commit(nextLibraries: ProjectLibrarySetting[]) {
    const normalizedLibraries = nextLibraries.map((library) =>
      normalizeProjectLibrarySetting(library, defaultDirectoryLibrary)
    )
    setDraftLibraries(normalizedLibraries)
    if (
      areProjectLibrarySettingsEqual(
        normalizedLibraries,
        committedLibrariesRef.current
      )
    ) {
      return
    }

    committedLibrariesRef.current = normalizedLibraries
    updateValue(normalizedLibraries)
  }

  function updateDraftField(
    index: number,
    field: keyof ProjectLibrarySetting,
    nextValue: string
  ) {
    setDraftLibraries((libraries) =>
      updateProjectLibrarySettingAt(libraries, index, (library) => ({
        ...library,
        [field]: nextValue,
      }))
    )
  }

  async function chooseDirectory(defaultPath: string) {
    const result = await electron?.open({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
      title: 'Choose a project library folder',
    })

    if (!result || result.canceled) {
      return undefined
    }

    return result.filePaths[0]
  }

  async function addLibrary() {
    if (!electron) return

    const documentsPath = await electron.getPath('documents')
    const selectedPath = await chooseDirectory(documentsPath)
    if (!selectedPath) {
      return
    }

    commit([
      ...draftLibraries,
      {
        title: NEW_PROJECT_LIBRARY_TITLE,
        path: selectedPath,
        type: DIRECTORY_PROJECT_LIBRARY_TYPE,
      },
    ])
  }

  function removeLibrary(index: number) {
    commit(draftLibraries.filter((_, currentIndex) => currentIndex !== index))
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    const library = draftLibraries[index]
    const dragPreviewId = `project-library-drag-preview-${index}`

    setDraggedLibraryIndex(index)
    dragPreviewIdRef.current = dragPreviewId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setDragPreview(event.dataTransfer, {
      id: dragPreviewId,
      text: library?.title.trim() || library?.path || 'Project library',
    })
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (draggedLibraryIndex === null || draggedLibraryIndex === index) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverLibraryIndex(index)
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault()
    const dataTransferIndex = Number(event.dataTransfer.getData('text/plain'))
    const fromIndex = Number.isInteger(dataTransferIndex)
      ? dataTransferIndex
      : draggedLibraryIndex

    setDraggedLibraryIndex(null)
    setDragOverLibraryIndex(null)
    removeCurrentDragPreview()

    if (fromIndex === null) {
      return
    }

    commit(moveProjectLibrarySetting(draftLibraries, fromIndex, index))
  }

  function handleDragEnd() {
    setDraggedLibraryIndex(null)
    setDragOverLibraryIndex(null)
    removeCurrentDragPreview()
  }

  function removeCurrentDragPreview() {
    if (!dragPreviewIdRef.current) {
      return
    }

    removeDragPreviewElement(dragPreviewIdRef.current)
    dragPreviewIdRef.current = null
  }

  return (
    <div
      className="flex min-w-0 w-full flex-col gap-3"
      data-testid="project-libraries-setting"
    >
      {draftLibraries.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-2">
          {draftLibraries.map((library, index) => {
            const isDragging = draggedLibraryIndex === index
            return (
              <li
                key={`${index}-${library.type}`}
                className={`grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border p-2 pl-1 dark:border-chalkboard-80 ${
                  dragOverLibraryIndex === index
                    ? 'border-primary bg-primary/5 dark:border-primary'
                    : 'border-chalkboard-30'
                } ${isDragging ? 'opacity-60' : ''}`}
                onDragOver={(event) => handleDragOver(event, index)}
                onDrop={(event) => handleDrop(event, index)}
                data-testid="project-library-row"
              >
                <button
                  type="button"
                  draggable
                  aria-label={`Reorder ${library.title || 'project library'}`}
                  aria-grabbed={isDragging}
                  className="flex shrink-0 cursor-grab items-center justify-center self-stretch rounded-sm border !border-transparent p-0 text-2 !bg-transparent active:cursor-grabbing"
                  data-testid="project-library-drag-handle"
                  onDragStart={(event) => handleDragStart(event, index)}
                  onDragEnd={handleDragEnd}
                >
                  <CustomIcon name="sixDots" className="h-4 w-4" />
                  <Tooltip position="top-right">Reorder library</Tooltip>
                </button>
                <span
                  className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-chalkboard-30 text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
                  data-testid="project-library-type"
                  aria-label={`Library type: ${typeLabel}`}
                  title={typeLabel}
                >
                  <CustomIcon name="folder" className="h-5 w-5" />
                  <Tooltip position="top-right">{typeLabel}</Tooltip>
                </span>
                <input
                  value={library.title}
                  onChange={(event) =>
                    updateDraftField(index, 'title', event.target.value)
                  }
                  onBlur={() => commit(draftLibraries)}
                  className="h-8 min-w-0 w-full rounded-sm border border-chalkboard-30 bg-transparent px-1 text-sm dark:border-chalkboard-70"
                  data-testid="project-library-title"
                />
                <ActionButton
                  Element="button"
                  type="button"
                  tabIndex={0}
                  onClick={() => removeLibrary(index)}
                  className="h-8 w-8 shrink-0 justify-center !p-0"
                  iconStart={{
                    icon: 'trash',
                    bgClassName: '!bg-transparent',
                    iconClassName: 'dark:!text-chalkboard-30',
                  }}
                  data-testid="project-library-remove"
                >
                  <Tooltip position="top-right">Remove library</Tooltip>
                </ActionButton>
                <div className="col-start-3 col-end-5 min-w-0">
                  <DirectoryProjectLibrarySettingsDetails
                    library={library}
                    index={index}
                    updateLibrary={(nextLibrary) =>
                      setDraftLibraries((libraries) =>
                        updateProjectLibrarySettingAt(
                          libraries,
                          index,
                          () => nextLibrary
                        )
                      )
                    }
                    commitLibrary={(nextLibrary) =>
                      commit(
                        nextLibrary
                          ? updateProjectLibrarySettingAt(
                              draftLibraries,
                              index,
                              () => nextLibrary
                            )
                          : draftLibraries
                      )
                    }
                    chooseDirectory={chooseDirectory}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ActionButton
        Element="button"
        type="button"
        tabIndex={0}
        onClick={toSync(addLibrary, reportRejection)}
        className="self-start"
        iconStart={{ icon: 'folder', size: 'sm', className: 'p-1' }}
        data-testid="project-library-add"
      >
        Create local library
      </ActionButton>
    </div>
  )
}
