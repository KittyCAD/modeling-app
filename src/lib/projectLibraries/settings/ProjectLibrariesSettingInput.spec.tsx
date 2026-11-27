import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import {
  DirectoryProjectLibrarySettingsDetails,
  ProjectLibrariesSettingInput,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const originalElectron = window.electron

afterEach(() => {
  window.electron = originalElectron
})

const defaultLibraries: ProjectLibrarySetting[] = [
  {
    title: 'Default Projects Directory',
    path: '/projects',
    type: 'directory',
  },
]

const directoryType = {
  title: 'Directory',
  icon: 'folder',
  type: 'directory',
  defaultSetting: {
    title: 'Default Projects Directory',
    path: 'projects',
    type: 'directory',
  },
  newLibrarySetting: {
    title: 'Project Library',
    path: 'projects',
    type: 'directory',
  },
  settingsDetails: DirectoryProjectLibrarySettingsDetails,
}

describe('ProjectLibrariesSettingInput', () => {
  test('does not invent a directory library type when none are registered', () => {
    const updateValue = vi.fn()

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
        directoryType={directoryType}
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
        directoryType={{
          type: 'directory',
          title: 'Directory',
          defaultSetting: defaultLibraries[0],
        }}
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
        directoryType={directoryType}
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

  test('edits, adds, and removes project libraries', async () => {
    const updateValue = vi.fn()
    const open = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/client-projects'],
    })
    const getPath = vi.fn().mockResolvedValue('/documents')
    window.electron = { getPath, open } as unknown as Window['electron']

    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        directoryType={directoryType}
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

    await waitFor(() =>
      expect(updateValue).toHaveBeenLastCalledWith([
        {
          title: 'Client Projects',
          path: '/projects',
          type: 'directory',
        },
        {
          title: 'Project Library',
          path: '/client-projects',
          type: 'directory',
        },
      ])
    )
    expect(open).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: '/documents',
      title: 'Choose a project library folder',
    })
    expect(getPath).toHaveBeenCalledWith('documents')

    fireEvent.click(screen.getAllByTestId('project-library-remove')[1])

    expect(updateValue).toHaveBeenLastCalledWith([
      {
        title: 'Client Projects',
        path: '/projects',
        type: 'directory',
      },
    ])
  })

  test('hides library management controls when management is disabled', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        directoryType={directoryType}
        canAddLibraries={false}
        canReorderLibraries={false}
        canEditLibraryDetails={false}
        canRemoveLibrary={() => false}
      />
    )

    expect(screen.queryByTestId('project-library-add')).toBeNull()
    expect(screen.queryByTestId('project-library-remove')).toBeNull()
    expect(screen.queryByTestId('project-library-drag-handle')).toBeNull()
    expect(screen.getByTestId('project-library-type')).toHaveAttribute(
      'aria-label',
      'Library type: Directory'
    )
    expect(screen.getByTestId('project-directory-input')).toHaveTextContent(
      '/projects'
    )
  })

  test('allows directory library removal while edits and reordering are disabled', () => {
    const updateValue = vi.fn()
    render(
      <ProjectLibrariesSettingInput
        value={defaultLibraries}
        updateValue={updateValue}
        directoryType={directoryType}
        canAddLibraries={false}
        canReorderLibraries={false}
        canEditLibraryDetails={false}
      />
    )

    fireEvent.click(screen.getByTestId('project-library-remove'))

    expect(updateValue).toHaveBeenLastCalledWith([])
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
        directoryType={directoryType}
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
