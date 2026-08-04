import { ProjectTitleSettingsSection } from '@src/components/Settings/ProjectTitleSettingsSection'
import type { Project } from '@src/lib/project'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'
import { expect, test, vi } from 'vitest'

const project = {
  metadata: null,
  kcl_file_count: 1,
  directory_count: 0,
  title: 'Bracket',
  default_file: '/projects/bracket/main.kcl',
  path: '/projects/bracket',
  name: 'bracket',
  children: [],
  readWriteAccess: true,
} satisfies Project

const projectEntry = {
  id: 'local:/projects/bracket',
  source: 'local',
  status: 'local',
  name: 'bracket',
  title: 'Bracket',
  localProjectPath: '/projects/bracket',
  localProjectName: 'bracket',
  defaultFile: '/projects/bracket/main.kcl',
  readWriteAccess: true,
} satisfies HomeProjectEntry

function createProjectActions(
  rename = vi.fn().mockResolvedValue(undefined)
): HomeProjectActionsService {
  return {
    canOpen: () => true,
    canDuplicate: () => true,
    canRename: () => true,
    canDelete: () => true,
    canMoveToLibrary: () => false,
    open: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockResolvedValue(undefined),
    rename,
    delete: vi.fn().mockResolvedValue(undefined),
    getMoveToLibraryTargets: () => [],
    moveToLibrary: vi.fn().mockResolvedValue(undefined),
  }
}

test('updates the current project title on blur', async () => {
  const rename = vi.fn().mockResolvedValue(undefined)
  render(
    <ProjectTitleSettingsSection
      project={project}
      projectEntry={projectEntry}
      projectActions={createProjectActions(rename)}
    />
  )

  const input = screen.getByRole('textbox', { name: 'Project title' })
  expect(input).toHaveValue('Bracket')

  fireEvent.change(input, { target: { value: ' Updated bracket ' } })
  fireEvent.blur(input)

  await waitFor(() =>
    expect(rename).toHaveBeenCalledWith(projectEntry, 'Updated bracket')
  )
  expect(input).toHaveValue('Updated bracket')
})

test('shows the title read-only when the project cannot be updated', () => {
  const actions = createProjectActions()
  actions.canRename = () => false

  render(
    <ProjectTitleSettingsSection
      project={project}
      projectEntry={projectEntry}
      projectActions={actions}
    />
  )

  expect(screen.getByRole('textbox', { name: 'Project title' })).toBeDisabled()
  expect(actions.rename).not.toHaveBeenCalled()
})

test('shows a user-facing error when the title cannot be saved', async () => {
  const saveError = new Error('Disk is read-only')
  const rename = vi.fn().mockRejectedValue(saveError)
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  render(
    <ProjectTitleSettingsSection
      project={project}
      projectEntry={projectEntry}
      projectActions={createProjectActions(rename)}
    />
  )

  const input = screen.getByRole('textbox', { name: 'Project title' })
  fireEvent.change(input, { target: { value: 'Updated bracket' } })
  fireEvent.blur(input)

  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      'Error: Could not update project title. Please try again.',
      { id: 'error' }
    )
  )
  expect(input).toHaveValue('Bracket')
  expect(consoleError).toHaveBeenCalledWith(saveError)

  toastError.mockRestore()
  consoleError.mockRestore()
})
