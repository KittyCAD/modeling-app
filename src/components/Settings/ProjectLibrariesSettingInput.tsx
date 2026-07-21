import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
  type ProjectLibraryType,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type { ProjectLibraryTypeContribution } from '@src/registry/contracts/projectLibraries'
import { type DragEvent, useEffect, useState } from 'react'

interface ProjectLibrariesSettingInputProps {
  value: ProjectLibrarySetting[]
  updateValue: (value: ProjectLibrarySetting[]) => void
  libraryTypeOptions?: readonly ProjectLibraryTypeOption[]
}

export interface ProjectLibraryTypeOption {
  label: string
  value: ProjectLibraryType
  defaultLibrary: ProjectLibrarySetting
}

const directoryLibraryTypeOption: ProjectLibraryTypeOption = {
  label: 'Directory',
  value: DIRECTORY_PROJECT_LIBRARY_TYPE,
  defaultLibrary: {
    title: DEFAULT_PROJECT_LIBRARY_TITLE,
    path: 'projects',
    type: DIRECTORY_PROJECT_LIBRARY_TYPE,
  },
}

export function projectLibraryTypeOptionsFromContributions(
  libraryTypes: ReadonlyMap<ProjectLibraryType, ProjectLibraryTypeContribution>
): ProjectLibraryTypeOption[] {
  const options = Array.from(libraryTypes.values())
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
    )
    .map((libraryType) => ({
      label: libraryType.title,
      value: libraryType.type,
      defaultLibrary: libraryType.defaultSetting ?? {
        title: libraryType.title,
        path: 'projects',
        type: libraryType.type,
      },
    }))

  return options.length > 0 ? options : [directoryLibraryTypeOption]
}

function defaultLibraryForType(
  type: ProjectLibraryType,
  libraryTypeOptions: readonly ProjectLibraryTypeOption[]
): ProjectLibrarySetting {
  const option = libraryTypeOptions.find(
    (libraryType) => libraryType.value === type
  )

  return (
    option?.defaultLibrary ?? {
      title: 'Project Library',
      path: 'projects',
      type,
    }
  )
}

function normalizeLibrary(
  library: ProjectLibrarySetting,
  libraryTypeOptions: readonly ProjectLibraryTypeOption[]
): ProjectLibrarySetting {
  const fallback = defaultLibraryForType(library.type, libraryTypeOptions)

  return {
    title: library.title.trim() || fallback.title,
    path: library.path.trim() || fallback.path,
    type: library.type || fallback.type,
  }
}

function updateLibraryAt(
  libraries: ProjectLibrarySetting[],
  index: number,
  update: (library: ProjectLibrarySetting) => ProjectLibrarySetting
) {
  return libraries.map((library, currentIndex) =>
    currentIndex === index ? update(library) : library
  )
}

function moveLibrary(
  libraries: ProjectLibrarySetting[],
  fromIndex: number,
  toIndex: number
) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= libraries.length ||
    toIndex >= libraries.length
  ) {
    return libraries
  }

  const nextLibraries = [...libraries]
  const [library] = nextLibraries.splice(fromIndex, 1)
  if (!library) {
    return libraries
  }

  nextLibraries.splice(toIndex, 0, library)
  return nextLibraries
}

function ProjectLibraryTypeSelect({
  value,
  options,
  onChange,
}: {
  value: ProjectLibraryType
  options: readonly ProjectLibraryTypeOption[]
  onChange: (value: ProjectLibraryType) => void
}) {
  const selectOptions = options.some((option) => option.value === value)
    ? options
    : [
        ...options,
        {
          label: value,
          value,
          defaultLibrary: {
            title: 'Project Library',
            path: 'projects',
            type: value,
          },
        },
      ]

  if (selectOptions.length <= 1) {
    return (
      <span
        className="rounded-sm border border-chalkboard-30 p-1 text-xs text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
        data-testid="project-library-type"
      >
        {selectOptions[0]?.label ?? value}
      </span>
    )
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-sm border border-chalkboard-30 bg-transparent p-1 text-xs dark:border-chalkboard-70"
      data-testid="project-library-type"
    >
      {selectOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function ProjectLibrariesSettingInput({
  value,
  updateValue,
  libraryTypeOptions = [directoryLibraryTypeOption],
}: ProjectLibrariesSettingInputProps) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
  const [draftLibraries, setDraftLibraries] =
    useState<ProjectLibrarySetting[]>(value)
  const [draggedLibraryIndex, setDraggedLibraryIndex] = useState<number | null>(
    null
  )
  const [dragOverLibraryIndex, setDragOverLibraryIndex] = useState<
    number | null
  >(null)

  useEffect(() => {
    setDraftLibraries(value)
  }, [value])

  function commit(nextLibraries: ProjectLibrarySetting[]) {
    const normalizedLibraries = nextLibraries.map((library) =>
      normalizeLibrary(library, libraryTypeOptions)
    )
    setDraftLibraries(normalizedLibraries)
    updateValue(normalizedLibraries)
  }

  function updateDraftField(
    index: number,
    field: keyof ProjectLibrarySetting,
    nextValue: string
  ) {
    setDraftLibraries((libraries) =>
      updateLibraryAt(libraries, index, (library) => ({
        ...library,
        [field]: nextValue,
      }))
    )
  }

  function commitDraftLibrary(index: number) {
    commit(
      updateLibraryAt(draftLibraries, index, (library) =>
        normalizeLibrary(library, libraryTypeOptions)
      )
    )
  }

  function updateLibraryType(index: number, type: ProjectLibraryType) {
    const fallback = defaultLibraryForType(type, libraryTypeOptions)
    const previousFallback = defaultLibraryForType(
      draftLibraries[index].type,
      libraryTypeOptions
    )
    commit(
      updateLibraryAt(draftLibraries, index, (library) => ({
        title:
          library.title === previousFallback.title
            ? fallback.title
            : library.title,
        path:
          library.path === previousFallback.path ? fallback.path : library.path,
        type,
      }))
    )
  }

  async function chooseDirectory(defaultPath?: string) {
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
    const fallback = defaultLibraryForType(
      DIRECTORY_PROJECT_LIBRARY_TYPE,
      libraryTypeOptions
    )
    const selectedPath = electron
      ? await chooseDirectory(fallback.path)
      : fallback.path

    if (!selectedPath) {
      return
    }

    commit([
      ...draftLibraries,
      {
        ...fallback,
        path: selectedPath,
      },
    ])
  }

  function removeLibrary(index: number) {
    commit(draftLibraries.filter((_, currentIndex) => currentIndex !== index))
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    setDraggedLibraryIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
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

    if (fromIndex === null) {
      return
    }

    commit(moveLibrary(draftLibraries, fromIndex, index))
  }

  function handleDragEnd() {
    setDraggedLibraryIndex(null)
    setDragOverLibraryIndex(null)
  }

  async function chooseLibraryDirectory(index: number) {
    const selectedPath = await chooseDirectory(draftLibraries[index]?.path)
    if (!selectedPath) {
      return
    }

    commit(
      updateLibraryAt(draftLibraries, index, (library) => ({
        ...library,
        path: selectedPath,
      }))
    )
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="project-libraries-setting"
    >
      {draftLibraries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {draftLibraries.map((library, index) => (
            <li
              key={`${index}-${library.type}`}
              className={`grid gap-2 rounded-sm border p-2 dark:border-chalkboard-80 md:grid-cols-[auto_minmax(10rem,1fr)_8rem_minmax(12rem,1.5fr)_auto] ${
                dragOverLibraryIndex === index
                  ? 'border-primary bg-primary/5 dark:border-primary'
                  : 'border-chalkboard-30'
              } ${draggedLibraryIndex === index ? 'opacity-60' : ''}`}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              data-testid="project-library-row"
            >
              <button
                type="button"
                draggable
                aria-label={`Reorder ${library.title || 'project library'}`}
                aria-grabbed={draggedLibraryIndex === index}
                className="flex h-8 w-6 cursor-grab items-center justify-center self-start rounded-sm border border-transparent text-chalkboard-60 hover:border-chalkboard-30 hover:bg-chalkboard-10 active:cursor-grabbing dark:text-chalkboard-40 dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-90"
                data-testid="project-library-drag-handle"
                onDragStart={(event) => handleDragStart(event, index)}
                onDragEnd={handleDragEnd}
              >
                <CustomIcon name="sixDots" className="h-5 w-5" />
                <Tooltip position="top-right">Reorder library</Tooltip>
              </button>
              <input
                value={library.title}
                onChange={(event) =>
                  updateDraftField(index, 'title', event.target.value)
                }
                onBlur={() => commitDraftLibrary(index)}
                className="min-w-0 rounded-sm border border-chalkboard-30 bg-transparent p-1 text-sm dark:border-chalkboard-70"
                data-testid="project-library-title"
              />
              <ProjectLibraryTypeSelect
                value={library.type}
                options={libraryTypeOptions}
                onChange={(type) => updateLibraryType(index, type)}
              />
              <div className="flex min-w-0 gap-1">
                <input
                  value={library.path}
                  onChange={(event) =>
                    updateDraftField(index, 'path', event.target.value)
                  }
                  onBlur={() => commitDraftLibrary(index)}
                  className="min-w-0 flex-1 rounded-sm border border-chalkboard-30 bg-transparent p-1 text-sm dark:border-chalkboard-70"
                  data-testid={
                    index === 0
                      ? 'project-directory-input'
                      : 'project-library-path'
                  }
                />
                {electron &&
                  library.type === DIRECTORY_PROJECT_LIBRARY_TYPE && (
                    <ActionButton
                      Element="button"
                      type="button"
                      tabIndex={0}
                      onClick={toSync(
                        () => chooseLibraryDirectory(index),
                        reportRejection
                      )}
                      className="!p-0"
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
                      <Tooltip position="top-right">Choose folder</Tooltip>
                    </ActionButton>
                  )}
              </div>
              <ActionButton
                Element="button"
                type="button"
                tabIndex={0}
                onClick={() => removeLibrary(index)}
                className="justify-self-start !p-0 md:justify-self-end"
                iconStart={{
                  icon: 'trash',
                  bgClassName: '!bg-transparent',
                  iconClassName: 'dark:!text-chalkboard-30',
                }}
                data-testid="project-library-remove"
              >
                <Tooltip position="top-right">Remove library</Tooltip>
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <ActionButton
        Element="button"
        type="button"
        tabIndex={0}
        onClick={toSync(addLibrary, reportRejection)}
        className="self-start"
        iconStart={{
          icon: 'plus',
          bgClassName: '!bg-transparent',
        }}
        data-testid="project-library-add"
      >
        Add library
      </ActionButton>
    </div>
  )
}
