import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { ProjectLibrariesSetting } from '@src/lib/projectLibraries/settings/ProjectLibrariesSetting'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

it('only edits directory libraries and preserves other saved libraries', () => {
  const local: ProjectLibrarySetting = {
    title: 'Local projects',
    path: '/projects',
    type: 'directory',
  }
  const external: ProjectLibrarySetting = {
    title: 'External projects',
    path: '/provider-cache',
    source: '/designs',
    type: 'external',
  }
  const updateValue = vi.fn()
  render(
    <MemoryRouter>
      <ProjectLibrariesSetting
        value={[local, external]}
        updateValue={updateValue}
      />
    </MemoryRouter>
  )
  expect(
    screen.getByRole('link', {
      name: 'Manage other libraries on Home.',
    })
  ).toHaveAttribute('href', '/home')
  expect(screen.queryByDisplayValue(external.title)).toBeNull()
  expect(screen.getByLabelText('Library type: Directory')).toBeVisible()
  const title = screen.getByDisplayValue(local.title)
  fireEvent.change(title, { target: { value: 'Renamed projects' } })
  fireEvent.blur(title)
  expect(updateValue).toHaveBeenLastCalledWith([
    { ...local, title: 'Renamed projects' },
    external,
  ])
  fireEvent.click(screen.getByTestId('project-library-remove'))
  expect(updateValue).toHaveBeenLastCalledWith([external])
})
