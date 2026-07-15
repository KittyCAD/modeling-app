import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import {
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrarySetting,
  type ProjectLibraryType,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { type DragEvent, useEffect, useState } from 'react'

interface ProjectLibrariesSettingInputProps {
  value: ProjectLibrarySetting[]
  updateValue: (value: ProjectLibrarySetting[]) => void
}

type KnownProjectLibraryType = 'directory' | 'recents' | 'cloud'

const projectLibraryTypes: {
  label: string
  value: KnownProjectLibraryType
}[] = [
  { label: 'Directory', value: 'directory' },
  { label: 'Recents', value: 'recents' },
  { label: 'Cloud', value: 'cloud' },
]

const defaultLibraryByType: Record<
  KnownProjectLibraryType,
  ProjectLibrarySetting
> = {
  directory: {
    title: 'Local Projects',
    path: '~',
    type: 'directory',
  },
  recents: {
    title: 'Recent Projects',
    path: 'recents',
    type: 'recents',
  },
  cloud: getDefaultCloudProjectLibrarySetting(),
}

function isKnownProjectLibraryType(
  type: ProjectLibraryType
): type is KnownProjectLibraryType {
  return projectLibraryTypes.some((option) => option.value === type)
}

function defaultLibraryForType(
  type: ProjectLibraryType
): ProjectLibrarySetting {
  return isKnownProjectLibraryType(type)
    ? defaultLibraryByType[type]
    : {
        title: 'Project Library',
        path: 'library',
        type,
      }
}

function normalizeLibrary(
  library: ProjectLibrarySetting
): ProjectLibrarySetting {
  const fallback = defaultLibraryForType(library.type)

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
  onChange,
}: {
  value: ProjectLibraryType
  onChange: (value: ProjectLibraryType) => void
}) {
  const options = isKnownProjectLibraryType(value)
    ? projectLibraryTypes
    : [...projectLibraryTypes, { label: value, value }]

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-sm border border-chalkboard-30 bg-transparent p-1 text-xs dark:border-chalkboard-70"
      data-testid="project-library-type"
    >
      {options.map((option) => (
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
}: ProjectLibrariesSettingInputProps) {
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
    const normalizedLibraries = nextLibraries.map(normalizeLibrary)
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
        normalizeLibrary(library)
      )
    )
  }

  function updateLibraryType(index: number, type: ProjectLibraryType) {
    const fallback = defaultLibraryForType(type)
    const previousFallback = defaultLibraryForType(draftLibraries[index].type)
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

  function addLibrary() {
    commit([...draftLibraries, defaultLibraryByType.directory])
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
    if (!window.electron) {
      return
    }

    const currentPath = draftLibraries[index]?.path
    const result = await window.electron.open({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: currentPath || undefined,
      title: 'Choose a project library folder',
    })

    if (result.canceled) {
      return
    }

    commit(
      updateLibraryAt(draftLibraries, index, (library) => ({
        ...library,
        path: result.filePaths[0],
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
                  data-testid="project-library-path"
                />
                {window.electron && library.type === 'directory' && (
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
                    data-testid="project-library-folder-button"
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
        onClick={addLibrary}
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
