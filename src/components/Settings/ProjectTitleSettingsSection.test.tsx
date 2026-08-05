import { ProjectTitleSettingsSection } from '@src/components/Settings/ProjectTitleSettingsSection'
import type { Project } from '@src/lib/project'
import type { ProjectTitleService } from '@src/lib/projectTitle'
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

function createProjectTitleService(
  updateTitle = vi.fn().mockResolvedValue(undefined)
): ProjectTitleService {
  return {
    canUpdateTitle: () => true,
    updateTitle,
  }
}

test('updates the current project title on blur without a Home entry', async () => {
  const updateTitle = vi.fn().mockResolvedValue(undefined)
  render(
    <ProjectTitleSettingsSection
      project={project}
      service={createProjectTitleService(updateTitle)}
    />
  )

  const input = screen.getByRole('textbox', { name: 'Project title' })
  expect(input).toHaveValue('Bracket')

  fireEvent.change(input, { target: { value: ' Updated bracket ' } })
  fireEvent.blur(input)

  await waitFor(() =>
    expect(updateTitle).toHaveBeenCalledWith(project, 'Updated bracket')
  )
  expect(input).toHaveValue('Updated bracket')
})

test('shows the title read-only when the project cannot be updated', () => {
  const service = createProjectTitleService()
  service.canUpdateTitle = () => false

  render(<ProjectTitleSettingsSection project={project} service={service} />)

  expect(screen.getByRole('textbox', { name: 'Project title' })).toBeDisabled()
  expect(service.updateTitle).not.toHaveBeenCalled()
})

test('shows a user-facing error when the title cannot be saved', async () => {
  const saveError = new Error('Disk is read-only')
  const updateTitle = vi.fn().mockRejectedValue(saveError)
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  render(
    <ProjectTitleSettingsSection
      project={project}
      service={createProjectTitleService(updateTitle)}
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
