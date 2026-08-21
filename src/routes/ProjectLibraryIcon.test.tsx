import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isPathInGitWorkingCopy = vi.fn(async (_path: string) => false)

vi.mock('@src/lib/gitWorkingCopy', () => ({
  isPathInGitWorkingCopy: (path: string) => isPathInGitWorkingCopy(path),
}))

const { ProjectLibraryIcon } = await import('@src/routes/ProjectLibraryIcon')

const directoryLibrary = {
  id: 'directory-1',
  title: 'Local Projects',
  path: '/home/me/cad/projects',
  type: 'directory',
} satisfies ProjectLibrary

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
} satisfies ProjectLibrary

describe('ProjectLibraryIcon', () => {
  beforeEach(() => {
    isPathInGitWorkingCopy.mockReset()
    isPathInGitWorkingCopy.mockResolvedValue(false)
  })

  it('replaces the folder icon when the library path is in a git working copy', async () => {
    isPathInGitWorkingCopy.mockResolvedValue(true)

    const { container } = render(
      <ProjectLibraryIcon library={directoryLibrary} />
    )

    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Git working copy' })
      ).toBeInTheDocument()
    )
    expect(
      container.querySelector('svg[aria-label="folder"]')
    ).not.toBeInTheDocument()
    expect(isPathInGitWorkingCopy).toHaveBeenCalledWith('/home/me/cad/projects')
  })

  it('keeps the folder icon outside a git working copy', async () => {
    const { container } = render(
      <ProjectLibraryIcon library={directoryLibrary} />
    )

    await waitFor(() => expect(isPathInGitWorkingCopy).toHaveBeenCalled())
    expect(
      container.querySelector('svg[aria-label="folder"]')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Git working copy' })
    ).not.toBeInTheDocument()
  })

  it('does not check cloud libraries for git metadata', async () => {
    isPathInGitWorkingCopy.mockResolvedValue(true)

    render(<ProjectLibraryIcon library={cloudLibrary} />)

    expect(isPathInGitWorkingCopy).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('img', { name: 'Git working copy' })
    ).not.toBeInTheDocument()
  })
})
