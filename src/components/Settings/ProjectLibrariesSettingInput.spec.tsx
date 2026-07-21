import {
  ProjectLibrariesSettingInput,
  type ProjectLibraryTypeOption,
} from '@src/components/Settings/ProjectLibrariesSettingInput'
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
    value: 'directory',
    defaultLibrary: {
      title: 'Local Projects',
      path: 'projects',
      type: 'directory',
    },
  },
]

describe('ProjectLibrariesSettingInput', () => {
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
        title: 'Local Projects',
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
