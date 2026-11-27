import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon, isCustomIconName } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { removeDragPreviewElement, setDragPreview } from '@src/lib/dragPreview'
import {
  areProjectLibrarySettingsEqual,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  moveProjectLibrarySetting,
  NEW_PROJECT_LIBRARY_TITLE,
  normalizeProjectLibrarySetting,
  type ProjectLibrarySetting,
  updateProjectLibrarySettingAt,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type {
  ProjectLibrarySettingsDetailsProps,
  ProjectLibraryTypeContribution,
} from '@src/registry/contracts/projectLibraries'
import { type DragEvent, useEffect, useRef, useState } from 'react'

interface ProjectLibrariesSettingInputProps {
  value: ProjectLibrarySetting[]
  updateValue: (value: ProjectLibrarySetting[]) => void
  directoryType?: ProjectLibraryTypeContribution
  canAddLibraries?: boolean
  canReorderLibraries?: boolean
  canEditLibraryDetails?: boolean
  canRemoveLibrary?: (library: ProjectLibrarySetting) => boolean
}

function DefaultProjectLibrarySettingsDetails() {
  return <></>
}

export function DirectoryProjectLibrarySettingsDetails({
  library,
  index,
  updateLibrary,
  commitLibrary,
  readOnly = false,
  chooseDirectory,
}: ProjectLibrarySettingsDetailsProps) {
  async function chooseLibraryPath() {
    if (!chooseDirectory) {
      return
    }

    const selectedPath = await chooseDirectory({
      defaultPath: library.path,
      title: 'Choose a project library folder',
    })
    if (!selectedPath) {
      return
    }

    commitLibrary({
      ...library,
      path: selectedPath,
    })
  }

  return readOnly ? (
    <p
      className="flex h-8 min-w-0 items-center truncate rounded-sm border border-chalkboard-30 bg-transparent px-1 text-sm dark:border-chalkboard-70"
      data-testid={
        index === 0 ? 'project-directory-input' : 'project-library-path'
      }
      title={library.path}
    >
      {library.path}
    </p>
  ) : (
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
      {chooseDirectory && (
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
      )}
    </div>
  )
}

export function ProjectLibrariesSettingInput({
  value,
  updateValue,
  directoryType,
  canAddLibraries = true,
  canReorderLibraries = true,
  canEditLibraryDetails = true,
  canRemoveLibrary = () => true,
}: ProjectLibrariesSettingInputProps) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
  const typeLabel = directoryType?.title ?? 'Directory'
  const typeIcon = isCustomIconName(directoryType?.icon)
    ? directoryType.icon
    : 'folder'
  const fallbackLibrary = {
    title: directoryType?.title ?? NEW_PROJECT_LIBRARY_TITLE,
    path: 'projects',
    type: DIRECTORY_PROJECT_LIBRARY_TYPE,
  }
  const defaultLibrary = directoryType?.defaultSetting ?? fallbackLibrary
  const SettingsDetails =
    directoryType?.settingsDetails ?? DefaultProjectLibrarySettingsDetails
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
      normalizeProjectLibrarySetting(library, defaultLibrary)
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

  async function chooseDirectory({
    defaultPath,
    title,
  }: {
    defaultPath?: string
    title?: string
  }) {
    const result = await electron?.open({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
      title: title ?? 'Choose a project library folder',
    })

    if (!result || result.canceled) {
      return undefined
    }

    return result.filePaths[0]
  }

  async function addLibrary() {
    if (!directoryType) {
      return
    }

    const newLibrary = directoryType.newLibrarySetting ?? fallbackLibrary
    if (!electron) {
      commit([...draftLibraries, newLibrary])
      return
    }

    const documentsPath = await electron.getPath('documents')
    const selectedPath = await chooseDirectory({ defaultPath: documentsPath })
    if (!selectedPath) {
      return
    }

    commit([...draftLibraries, { ...newLibrary, path: selectedPath }])
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
            const canRemoveCurrentLibrary = canRemoveLibrary(library)
            const showRemoveColumn = draftLibraries.some(canRemoveLibrary)
            const gridColsClass = canReorderLibraries
              ? showRemoveColumn
                ? 'grid-cols-[auto_auto_minmax(0,1fr)_auto]'
                : 'grid-cols-[auto_auto_minmax(0,1fr)]'
              : showRemoveColumn
                ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                : 'grid-cols-[auto_minmax(0,1fr)]'
            const detailsColClass = canReorderLibraries
              ? showRemoveColumn
                ? 'col-start-3 col-end-5'
                : 'col-start-3'
              : showRemoveColumn
                ? 'col-start-2 col-end-4'
                : 'col-start-2'

            return (
              <li
                key={`${index}-${library.type}`}
                className={`grid min-w-0 items-center gap-2 rounded-sm border p-2 dark:border-chalkboard-80 ${gridColsClass} ${
                  canReorderLibraries ? 'pl-1' : ''
                } ${
                  dragOverLibraryIndex === index
                    ? 'border-primary bg-primary/5 dark:border-primary'
                    : 'border-chalkboard-30'
                } ${draggedLibraryIndex === index ? 'opacity-60' : ''}`}
                onDragOver={
                  canReorderLibraries
                    ? (event) => handleDragOver(event, index)
                    : undefined
                }
                onDrop={
                  canReorderLibraries
                    ? (event) => handleDrop(event, index)
                    : undefined
                }
                data-testid="project-library-row"
              >
                {canReorderLibraries && (
                  <button
                    type="button"
                    draggable
                    aria-label={`Reorder ${library.title || 'project library'}`}
                    aria-grabbed={draggedLibraryIndex === index}
                    className="flex shrink-0 cursor-grab items-center justify-center self-stretch rounded-sm border !border-transparent p-0 text-2 !bg-transparent active:cursor-grabbing"
                    data-testid="project-library-drag-handle"
                    onDragStart={(event) => handleDragStart(event, index)}
                    onDragEnd={handleDragEnd}
                  >
                    <CustomIcon name="sixDots" className="h-4 w-4" />
                    <Tooltip position="top-right">Reorder library</Tooltip>
                  </button>
                )}
                <span
                  className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-chalkboard-30 text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
                  data-testid="project-library-type"
                  aria-label={`Library type: ${typeLabel}`}
                  title={typeLabel}
                >
                  <CustomIcon name={typeIcon} className="h-5 w-5" />
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
                {showRemoveColumn &&
                  (canRemoveCurrentLibrary ? (
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
                  ) : (
                    <span aria-hidden="true" className="h-8 w-8 shrink-0" />
                  ))}
                <div className={`min-w-0 empty:hidden ${detailsColClass}`}>
                  <SettingsDetails
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
                    readOnly={!canEditLibraryDetails}
                    chooseDirectory={
                      electron && canEditLibraryDetails
                        ? chooseDirectory
                        : undefined
                    }
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {canAddLibraries && (
        <ActionButton
          Element="button"
          type="button"
          tabIndex={0}
          onClick={toSync(addLibrary, reportRejection)}
          disabled={!directoryType}
          className="self-start disabled:cursor-not-allowed disabled:opacity-60"
          iconStart={{ icon: 'folder', size: 'sm', className: 'p-1' }}
          data-testid="project-library-add"
        >
          New local library
        </ActionButton>
      )}
    </div>
  )
}
