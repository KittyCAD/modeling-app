import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { type ProjectWithEntryPointMetadata } from 'lib/types'
import { GlobalStateProvider } from './GlobalStateProvider'
import { APP_NAME } from 'lib/constants'
import { vi } from 'vitest'

const now = new Date()
const projectWellFormed = {
  name: 'Simple Box',
  path: '/some/path/Simple Box',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/Simple Box/main.kcl',
    },
  ],
  entrypointMetadata: {
    atime: now,
    blksize: 32,
    blocks: 32,
    birthtime: now,
    dev: 1,
    gid: 1,
    ino: 1,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    mode: 1,
    mtime: now,
    nlink: 1,
    readonly: false,
    rdev: 1,
    size: 32,
    uid: 1,
    fileAttributes: null,
  },
} satisfies ProjectWithEntryPointMetadata

describe('ProjectSidebarMenu tests', () => {
  test('Renders the project name', () => {
    render(
      <BrowserRouter>
        <GlobalStateProvider>
          <ProjectSidebarMenu project={projectWellFormed} />
        </GlobalStateProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(
      projectWellFormed.name
    )
    expect(screen.getByTestId('createdAt')).toHaveTextContent(
      `Created ${now.toLocaleDateString()}`
    )
  })

  test('Renders app name if given no project', () => {
    render(
      <BrowserRouter>
        <GlobalStateProvider>
          <ProjectSidebarMenu />
        </GlobalStateProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(APP_NAME)
  })

  test('Renders as a link if set to do so', () => {
    render(
      <BrowserRouter>
        <GlobalStateProvider>
          <ProjectSidebarMenu project={projectWellFormed} renderAsLink={true} />
        </GlobalStateProvider>
      </BrowserRouter>
    )

    expect(screen.getByTestId('project-sidebar-link')).toBeInTheDocument()
    expect(screen.getByTestId('project-sidebar-link-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })
})
