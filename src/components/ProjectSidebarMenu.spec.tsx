import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, expect, describe, test, vi } from 'vitest'

import type { FileEntry, Project } from '@src/lib/project'

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: () => undefined,
}))

import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'

afterEach(() => {
  vi.restoreAllMocks()
})

const now = Date.now()
const projectWellFormed = {
  name: 'Simple Box',
  path: '/some/path/Simple Box',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/Simple Box/main.kcl',
      children: [],
    },
  ],
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
  default_file: '/some/path/Simple Box/main.kcl',
} satisfies Project

const nestedFile = {
  name: 'nested-part.kcl',
  path: '/some/path/Simple Box/parts/generated/nested-part.kcl',
  children: null,
} satisfies FileEntry

describe('ProjectSidebarMenu tests', () => {
  test('Disables popover menu by default', () => {
    render(
      <BrowserRouter>
        <ProjectSidebarMenu project={projectWellFormed} />
      </BrowserRouter>
    )

    expect(screen.getByTestId('project-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })

  test('Shows the full project-relative file path in the breadcrumb', () => {
    render(
      <BrowserRouter>
        <ProjectSidebarMenu
          enableMenu
          project={projectWellFormed}
          file={nestedFile}
        />
      </BrowserRouter>
    )

    expect(screen.getByTestId('app-header-file-name')).toHaveTextContent(
      'parts / generated / nested-part.kcl'
    )
  })

  test('Shows the full breadcrumb tooltip when the path is truncated', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)

    render(
      <BrowserRouter>
        <ProjectSidebarMenu
          enableMenu
          project={projectWellFormed}
          file={nestedFile}
        />
      </BrowserRouter>
    )

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Simple Box / parts / generated / nested-part.kcl'
    )
  })
})
