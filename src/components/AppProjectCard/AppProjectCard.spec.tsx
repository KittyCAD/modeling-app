import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'

import AppProjectCard from '@src/components/AppProjectCard/AppProjectCard'

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
  id: 'remote:project-123',
  name: 'old-cloud-title',
  title: 'Old cloud title',
  source: 'local',
  status: 'synced',
  remoteProjectId: 'project-123',
  localProjectPath: '/projects/old-cloud-title',
  localProjectName: 'old-cloud-title',
  readWriteAccess: true,
  modified: now,
  thumbnail: {
    type: 'local',
    path: '/projects/old-cloud-title/thumbnail.png',
  },
  kclFileCount: 1,
  directoryCount: 0,
  defaultFile: '/projects/old-cloud-title/main.kcl',
} satisfies HomeProjectEntry

function createProjectActions({
  rename = vi.fn().mockResolvedValue(undefined),
}: {
  rename?: HomeProjectActionsService['rename']
} = {}): HomeProjectActionsService {
  return {
    canOpen: () => true,
    canRename: () => true,
    canDelete: () => true,
    open: vi.fn().mockResolvedValue({
      defaultFile: '/projects/old-cloud-title/main.kcl',
    }),
    rename,
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function renderProjectCard({
  project = cloudProject,
  projectActions = createProjectActions(),
}: {
  project?: HomeProjectEntry
  projectActions?: HomeProjectActionsService
} = {}) {
  render(
    <BrowserRouter>
      <AppProjectCard project={project} projectActions={projectActions} />
    </BrowserRouter>
  )

  return { projectActions }
}

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:thumbnail'),
    })
  })

  test('eagerly shows cloud project renames while sync continues', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    const { projectActions } = renderProjectCard({
      projectActions: createProjectActions({ rename }),
    })

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

    await waitFor(() => expect(projectActions.rename).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('project-title')).toHaveTextContent(
        'New cloud title'
      )
    )
  })

  test('eagerly shows cloud project rename modified time while sync continues', async () => {
    const project = {
      ...cloudProject,
      modified: 1,
    }
    const rename = vi.fn().mockResolvedValue(undefined)
    const { projectActions } = renderProjectCard({
      project,
      projectActions: createProjectActions({ rename }),
    })
    const previousEditedTime =
      screen.getByTestId('project-edit-date').textContent

    fireEvent.click(screen.getByText('Rename project').closest('button')!)
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: 'New cloud title' },
    })
    fireEvent.submit(
      screen.getByTestId('project-rename-input').closest('form')!
    )

    await waitFor(() => expect(projectActions.rename).toHaveBeenCalled())
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
        status: 'conflicted',
        conflict: {
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
