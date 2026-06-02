import { render, screen } from '@testing-library/react'
import type { ContextType } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { AppContext } from '@src/lib/boot'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: () => undefined,
}))

import ProjectSidebarMenu, {
  canNavigateHome,
} from '@src/components/ProjectSidebarMenu'

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

function appContextWithFeatures(enabledFeatureIds: ReadonlySet<string>) {
  return {
    singletons: {
      kclManager: {
        switchedFiles: false,
      },
    },
    userFeatures: {
      useHas: (featureFlagId: string, defaultValue: boolean) =>
        enabledFeatureIds.has(featureFlagId) ? true : defaultValue,
    },
  } as unknown as ContextType<typeof AppContext>
}

describe('ProjectSidebarMenu tests', () => {
  test('enables home navigation for desktop or cloud-backed web', () => {
    expect(
      canNavigateHome({ isDesktopApp: true, hasOpfsCloudFeature: false })
    ).toBe(true)
    expect(
      canNavigateHome({ isDesktopApp: false, hasOpfsCloudFeature: true })
    ).toBe(true)
    expect(
      canNavigateHome({ isDesktopApp: false, hasOpfsCloudFeature: false })
    ).toBe(false)
  })

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

  test('Links the logo to Home on web when OPFS cloud is enabled', () => {
    render(
      <AppContext.Provider
        value={appContextWithFeatures(new Set([OPFS_CLOUD_FEATURE_FLAG]))}
      >
        <BrowserRouter>
          <ProjectSidebarMenu project={projectWellFormed} />
        </BrowserRouter>
      </AppContext.Provider>
    )

    const logoLink = screen.getByTestId('app-logo').closest('a')

    expect(logoLink).toHaveAttribute('href', PATHS.HOME)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Go home')
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
