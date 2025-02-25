import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { Project } from 'lib/project'

const now = new Date()
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
  metadata: {
    created: now.toISOString(),
    modified: now.toISOString(),
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/some/path/Simple Box/main.kcl',
} satisfies Project

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
})
