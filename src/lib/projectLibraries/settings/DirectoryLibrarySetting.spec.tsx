import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { DirectoryLibrarySetting } from '@src/lib/projectLibraries/settings/DirectoryLibrarySetting'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import { fireEvent, render, screen } from '@testing-library/react'
import { contribute, Registry } from 'plankton'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/isDesktop', () => ({ isDesktop: () => true }))

let registry: Registry | undefined
afterEach(async () => {
  await registry?.dispose()
})

it('only edits directory libraries and preserves other saved libraries', async () => {
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
  registry = new Registry()
  await registry.configure([
    contribute(projectLibraryTypesFacet, () => ({
      type: 'directory',
      title: 'Directory',
      defaultSetting: local,
    })),
    contribute(projectLibraryTypesFacet, () => ({
      type: 'external',
      title: 'External',
    })),
  ])
  const updateValue = vi.fn()
  render(
    <MemoryRouter>
      <DirectoryLibrarySetting
        value={[local, external]}
        updateValue={updateValue}
        registry={registry}
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
