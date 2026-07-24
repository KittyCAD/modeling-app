import {
  DirectoryProjectLibrarySettingsDetails,
  ProjectLibrariesSettingInput,
  projectLibraryTypeOptionsFromContributions,
  type ProjectLibraryTypeOption,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const defaultLibraries: ProjectLibrarySetting[] = [
  {
    title: 'Default Projects Directory',
    path: '/projects',
    type: 'directory',
  },
]

const libraryTypeOptions: ProjectLibraryTypeOption[] = [
  {
    label: 'Directory',
    icon: 'folder',
    value: 'directory',
    defaultLibrary: {
      title: 'Default Projects Directory',
      path: 'projects',
      type: 'directory',
    },
    newLibrary: {
      title: 'Project Library',
      path: 'projects',
      type: 'directory',
    },
    settingsDetails: DirectoryProjectLibrarySettingsDetails,
  },
]

const multipleLibraryTypeOptions: ProjectLibraryTypeOption[] = [
  ...libraryTypeOptions,
  {
    label: 'Cloud',
    icon: 'network',
    value: 'cloud',
    defaultLibrary: {
      title: 'Cloud',
      path: 'zoo-cloud',
      type: 'cloud',
    },
    newLibrary: {
      title: 'Cloud',
      path: 'zoo-cloud',
      type: 'cloud',
    },
    settingsDetails: () => <></>,
  },
]

describe('ProjectLibrariesSettingInput', () => {
  test('does not invent a directory library type when none are registered', () => {
    const updateValue = vi.fn()

    expect(projectLibraryTypeOptionsFromContributions(new Map())).toEqual([])

    render(
      <ProjectLibrariesSettingInput value={[]} updateValue={updateValue} />
    )

    const addButton = screen.getByTestId('project-library-add')
    expect(addButton).toBeDisabled()

    fireEvent.click(addButton)

    expect(updateValue).not.toHaveBeenCalled()
  })

  test('does not update project libraries when blurring unchanged fields', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        libraryTypeOptions={libraryTypeOptions}
      />
    )

    fireEvent.blur(screen.getByTestId('project-library-title'))
    fireEvent.blur(screen.getByTestId('project-directory-input'))

    expect(updateValue).not.toHaveBeenCalled()
  })

  test('does not render implicit details for library types without a settings details contribution', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        libraryTypeOptions={projectLibraryTypeOptionsFromContributions(
          new Map([
            [
              'directory',
              {
                type: 'directory',
                title: 'Directory',
                defaultSetting: {
                  title: 'Default Projects Directory',
                  path: 'projects',
                  type: 'directory',
                },
              },
            ],
          ])
        )}
      />
    )

    expect(screen.queryByTestId('project-directory-input')).toBeNull()
  })

  test('does not update project libraries when normalization matches the current value', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        libraryTypeOptions={libraryTypeOptions}
      />
    )

    fireEvent.change(screen.getByTestId('project-library-title'), {
      target: { value: ' Default Projects Directory ' },
    })
    fireEvent.blur(screen.getByTestId('project-library-title'))

    expect(screen.getByTestId('project-library-title')).toHaveValue(
      'Default Projects Directory'
    )
    expect(updateValue).not.toHaveBeenCalled()
  })

  test('edits, adds, and removes project libraries', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        libraryTypeOptions={libraryTypeOptions}
      />
    )

    fireEvent.change(screen.getByTestId('project-library-title'), {
      target: { value: 'Client Projects' },
    })
    fireEvent.blur(screen.getByTestId('project-library-title'))

    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Client Projects',
        path: '/projects',
        type: 'directory',
      },
    ])

    fireEvent.click(screen.getByTestId('project-library-add'))

    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Client Projects',
        path: '/projects',
        type: 'directory',
      },
      {
        title: 'Project Library',
        path: 'projects',
        type: 'directory',
      },
    ])

    fireEvent.click(screen.getAllByTestId('project-library-remove')[1])

    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Client Projects',
        path: '/projects',
        type: 'directory',
      },
    ])
  })

  test('shows library type as an icon button with icon and label options', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        libraryTypeOptions={multipleLibraryTypeOptions}
      />
    )

    const typeButton = screen.getByLabelText('Library type: Directory')
    expect(
      typeButton.querySelector('svg[aria-label="folder"]')
    ).toBeInTheDocument()

    fireEvent.click(typeButton)

    expect(screen.getByRole('option', { name: /Directory/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /Cloud/ })).toBeVisible()

    fireEvent.click(screen.getByRole('option', { name: /Cloud/ }))

    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Cloud',
        path: '/projects',
        type: 'cloud',
      },
    ])
  })

  test('reorders project libraries with drag and drop', () => {
    const updateValue = vi.fn()
    const dataTransferStore = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      getData: vi.fn((key: string) => dataTransferStore.get(key) ?? ''),
      setData: vi.fn((key: string, value: string) => {
        dataTransferStore.set(key, value)
      }),
      setDragImage: vi.fn(),
    }

    render(
      <ProjectLibrariesSettingInput
        value={[
          ...defaultLibraries,
          {
            title: 'Client Projects',
            path: '/client-projects',
            type: 'directory',
          },
        ]}
        updateValue={updateValue}
        libraryTypeOptions={libraryTypeOptions}
      />
    )

    const dragHandles = screen.getAllByTestId('project-library-drag-handle')
    const rows = screen.getAllByTestId('project-library-row')
    fireEvent.dragStart(dragHandles[1], { dataTransfer })
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      0,
      0
    )
    expect(
      document.getElementById('project-library-drag-preview-1')
    ).toHaveTextContent('Client Projects')

    fireEvent.dragOver(rows[0], { dataTransfer })
    fireEvent.drop(rows[0], { dataTransfer })

    expect(
      document.getElementById('project-library-drag-preview-1')
    ).not.toBeInTheDocument()
    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Client Projects',
        path: '/client-projects',
        type: 'directory',
      },
      {
        title: 'Default Projects Directory',
        path: '/projects',
        type: 'directory',
      },
    ])
  })
})
