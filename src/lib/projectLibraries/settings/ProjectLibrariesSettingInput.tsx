import { Listbox } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import {
  CustomIcon,
  isCustomIconName,
  type CustomIconName,
} from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { removeDragPreviewElement, setDragPreview } from '@src/lib/dragPreview'
import {
  NEW_PROJECT_LIBRARY_TITLE,
  areProjectLibrarySettingsEqual,
  moveProjectLibrarySetting,
  normalizeProjectLibrarySetting,
  type ProjectLibrarySetting,
  type ProjectLibraryType,
  updateProjectLibrarySettingAt,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type {
  ProjectLibrarySettingsDetailsProps,
  ProjectLibraryTypeContribution,
} from '@src/registry/contracts/projectLibraries'
import {
  type ComponentType,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

interface ProjectLibrariesSettingInputProps {
  value: ProjectLibrarySetting[]
  updateValue: (value: ProjectLibrarySetting[]) => void
  libraryTypeOptions?: readonly ProjectLibraryTypeOption[]
}

export interface ProjectLibraryTypeOption {
  label: string
  icon: CustomIconName
  value: ProjectLibraryType
  defaultLibrary: ProjectLibrarySetting
  newLibrary: ProjectLibrarySetting
  settingsDetails: ComponentType<ProjectLibrarySettingsDetailsProps>
}

const defaultProjectLibraryTypeIcon: CustomIconName = 'folder'

function libraryTypeIconFromContribution(
  libraryType: ProjectLibraryTypeContribution
): CustomIconName {
  if (isCustomIconName(libraryType.icon)) {
    return libraryType.icon
  }

  return defaultProjectLibraryTypeIcon
}

function DefaultProjectLibrarySettingsDetails() {
  return <></>
}

export function projectLibraryTypeOptionsFromContributions(
  libraryTypes: ReadonlyMap<ProjectLibraryType, ProjectLibraryTypeContribution>
): ProjectLibraryTypeOption[] {
  return Array.from(libraryTypes.values())
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
    )
    .map((libraryType) => {
      const fallbackLibrary = {
        title: libraryType.title,
        path: 'projects',
        type: libraryType.type,
      }

      return {
        label: libraryType.title,
        icon: libraryTypeIconFromContribution(libraryType),
        value: libraryType.type,
        defaultLibrary: libraryType.defaultSetting ?? fallbackLibrary,
        newLibrary: libraryType.newLibrarySetting ?? fallbackLibrary,
        settingsDetails:
          libraryType.settingsDetails ?? DefaultProjectLibrarySettingsDetails,
      }
    })
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
      title: NEW_PROJECT_LIBRARY_TITLE,
      path: 'projects',
      type,
    }
  )
}

function libraryTypeOptionForType(
  type: ProjectLibraryType,
  libraryTypeOptions: readonly ProjectLibraryTypeOption[]
) {
  return libraryTypeOptions.find((libraryType) => libraryType.value === type)
}

function normalizeLibrary(
  library: ProjectLibrarySetting,
  libraryTypeOptions: readonly ProjectLibraryTypeOption[]
): ProjectLibrarySetting {
  const fallback = defaultLibraryForType(library.type, libraryTypeOptions)

  return normalizeProjectLibrarySetting(library, fallback)
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
          icon: defaultProjectLibraryTypeIcon,
          value,
          defaultLibrary: {
            title: NEW_PROJECT_LIBRARY_TITLE,
            path: 'projects',
            type: value,
          },
          newLibrary: {
            title: NEW_PROJECT_LIBRARY_TITLE,
            path: 'projects',
            type: value,
          },
          settingsDetails: DefaultProjectLibrarySettingsDetails,
        },
      ]

  const selectedOption =
    selectOptions.find((option) => option.value === value) ?? selectOptions[0]

  if (selectOptions.length <= 1) {
    return (
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-chalkboard-30 text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
        data-testid="project-library-type"
        aria-label={`Library type: ${selectedOption?.label ?? value}`}
        title={selectedOption?.label ?? value}
      >
        <CustomIcon
          name={selectedOption?.icon ?? defaultProjectLibraryTypeIcon}
          className="h-5 w-5"
        />
        <Tooltip position="top-right">{selectedOption?.label ?? value}</Tooltip>
      </span>
    )
  }

  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative self-start">
        <Listbox.Button
          className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-chalkboard-30 text-chalkboard-70 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:text-chalkboard-30 dark:hover:bg-chalkboard-90"
          data-testid="project-library-type"
          aria-label={`Library type: ${selectedOption?.label ?? value}`}
          title={selectedOption?.label ?? value}
        >
          <CustomIcon
            name={selectedOption?.icon ?? defaultProjectLibraryTypeIcon}
            className="h-5 w-5"
          />
          <Tooltip position="top-right">
            {selectedOption?.label ?? value}
          </Tooltip>
        </Listbox.Button>
        <Listbox.Options className="absolute left-0 z-50 mt-1 min-w-40 rounded-sm border border-chalkboard-30 bg-chalkboard-10 p-1 shadow-lg focus:outline-none dark:border-chalkboard-70 dark:bg-chalkboard-90">
          {selectOptions.map((option) => (
            <Listbox.Option
              key={option.value}
              value={option.value}
              className={({ active }) =>
                `flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                  active
                    ? 'bg-chalkboard-20 dark:bg-chalkboard-80'
                    : 'bg-transparent'
                }`
              }
            >
              {({ selected }) => (
                <>
                  <CustomIcon name={option.icon} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {selected && (
                    <CustomIcon name="checkmark" className="h-4 w-4" />
                  )}
                </>
              )}
            </Listbox.Option>
          ))}
        </Listbox.Options>
      </div>
    </Listbox>
  )
}

export function DirectoryProjectLibrarySettingsDetails({
  library,
  index,
  updateLibrary,
  commitLibrary,
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

  return (
    <div className="flex min-w-0 gap-1">
      <input
        value={library.path}
        onChange={(event) =>
          updateLibrary({
            ...library,
            path: event.target.value,
          })
        }
        onBlur={() => commitLibrary()}
        className="min-w-0 flex-1 rounded-sm border border-chalkboard-30 bg-transparent p-1 text-sm dark:border-chalkboard-70"
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
  )
}

export function ProjectLibrariesSettingInput({
  value,
  updateValue,
  libraryTypeOptions = [],
}: ProjectLibrariesSettingInputProps) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
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
      normalizeLibrary(library, libraryTypeOptions)
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

  function commitDraftLibrary(index: number) {
    commit(
      updateProjectLibrarySettingAt(draftLibraries, index, (library) =>
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
      updateProjectLibrarySettingAt(draftLibraries, index, (library) => ({
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
    const libraryTypeOption = libraryTypeOptions[0]
    if (!libraryTypeOption) {
      return
    }

    const newLibrary = libraryTypeOption.newLibrary
    commit([...draftLibraries, newLibrary])
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
      className="flex flex-col gap-3"
      data-testid="project-libraries-setting"
    >
      {draftLibraries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {draftLibraries.map((library, index) => {
            const SettingsDetails =
              libraryTypeOptionForType(library.type, libraryTypeOptions)
                ?.settingsDetails ?? DefaultProjectLibrarySettingsDetails

            return (
              <li
                key={`${index}-${library.type}`}
                className={`grid gap-2 rounded-sm border p-2 pl-1 dark:border-chalkboard-80 md:grid-cols-[auto_auto_minmax(10rem,1fr)_minmax(12rem,1.5fr)_auto] ${
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
                  className="flex p-0 cursor-grab items-center justify-center self-stretch rounded-sm border !border-transparent text-2 !bg-transparent active:cursor-grabbing"
                  data-testid="project-library-drag-handle"
                  onDragStart={(event) => handleDragStart(event, index)}
                  onDragEnd={handleDragEnd}
                >
                  <CustomIcon name="sixDots" className="h-4 w-4" />
                  <Tooltip position="top-right">Reorder library</Tooltip>
                </button>
                <ProjectLibraryTypeSelect
                  value={library.type}
                  options={libraryTypeOptions}
                  onChange={(type) => updateLibraryType(index, type)}
                />
                <input
                  value={library.title}
                  onChange={(event) =>
                    updateDraftField(index, 'title', event.target.value)
                  }
                  onBlur={() => commitDraftLibrary(index)}
                  className="min-w-0 rounded-sm border border-chalkboard-30 bg-transparent p-1 text-sm dark:border-chalkboard-70"
                  data-testid="project-library-title"
                />
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
                  chooseDirectory={electron ? chooseDirectory : undefined}
                />
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
            )
          })}
        </ul>
      )}
      <ActionButton
        Element="button"
        type="button"
        tabIndex={0}
        onClick={toSync(addLibrary, reportRejection)}
        disabled={libraryTypeOptions.length === 0}
        className="self-start disabled:cursor-not-allowed disabled:opacity-60"
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
