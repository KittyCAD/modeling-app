import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Project } from '@src/lib/project'

import ProjectCard from '@src/components/ProjectCard/ProjectCard'

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (...parts: string[]) =>
      parts.reduce((left, right) => (left ? `${left}/${right}` : right), ''),
    stat: vi.fn().mockResolvedValue({}),
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  },
}))

const now = Date.now()
const cloudProject = {
  name: 'old-cloud-title',
  title: 'Old cloud title',
  cloudProjectId: 'project-123',
  path: '/projects/old-cloud-title',
  children: [],
  readWriteAccess: true,
  metadata: {
    created: now,
    modified: now,
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/projects/old-cloud-title/main.kcl',
} satisfies Project

function renderProjectCard({
  project = cloudProject,
  handleRenameProject = vi.fn().mockResolvedValue(undefined),
}: {
  project?: Project
  handleRenameProject?: (
    e: React.FormEvent<HTMLFormElement>,
    f: Project
  ) => Promise<void>
} = {}) {
  render(
    <BrowserRouter>
      <ProjectCard
        project={project}
        handleRenameProject={handleRenameProject}
        handleDeleteProject={vi.fn().mockResolvedValue(undefined)}
      />
    </BrowserRouter>
  )

  return { handleRenameProject }
}

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:thumbnail'),
    })
  })

  test('eagerly shows cloud project renames while sync continues', async () => {
    const { handleRenameProject } = renderProjectCard()

    expect(screen.getByTestId('project-title')).toHaveTextContent(
      'Old cloud title'
    )

    fireEvent.click(screen.getByText('Rename project').closest('button')!)
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: 'New cloud title' },
    })
    fireEvent.submit(
      screen.getByTestId('project-rename-input').closest('form')!
    )

    await waitFor(() => expect(handleRenameProject).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('project-title')).toHaveTextContent(
        'New cloud title'
      )
    )
  })

  test('eagerly shows cloud project rename modified time while sync continues', async () => {
    const project = {
      ...cloudProject,
      metadata: {
        ...cloudProject.metadata,
        modified: 1,
      },
    }
    const { handleRenameProject } = renderProjectCard({ project })
    const previousEditedTime =
      screen.getByTestId('project-edit-date').textContent

    fireEvent.click(screen.getByText('Rename project').closest('button')!)
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: 'New cloud title' },
    })
    fireEvent.submit(
      screen.getByTestId('project-rename-input').closest('form')!
    )

    await waitFor(() => expect(handleRenameProject).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('project-edit-date')).not.toHaveTextContent(
        previousEditedTime ?? ''
      )
    )
  })

  test('opens the cloud conflict dialog from conflicted project cards', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        cloudConflict: {
          conflictProjectPath: '/projects/old-cloud-title conflict',
          createdAt: new Date(now).toISOString(),
          remoteRevision: 'revision-123',
        },
      },
    })

    expect(screen.getByTestId('cloud-conflict-badge')).toHaveTextContent(
      'Inspect Conflicts'
    )

    fireEvent.click(screen.getByTestId('project-link'))

    expect(screen.getByTestId('cloud-conflict-dialog')).toBeInTheDocument()
    expect(screen.getByText('Use local data')).toBeInTheDocument()
    expect(screen.getByText('Use cloud data')).toBeInTheDocument()
  })
})
