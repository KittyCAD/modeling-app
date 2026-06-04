import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import type { App } from '@src/lib/app'
import { AppContext } from '@src/lib/boot'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { PATHS } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'

vi.mock('@src/lib/boot', async () => {
  const React = await import('react')
  const AppContext = React.createContext(null)
  const useTestApp = () => {
    return React.useContext(AppContext) as unknown as App
  }

  return {
    app: null,
    AppContext,
    useApp: useTestApp,
    useSingletons: () => useTestApp().singletons,
  }
})

vi.mock('@src/components/LspProvider', () => ({
  useLspContext: () => ({
    onProjectClose: vi.fn(),
  }),
}))

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: () => '/some/path/Simple Box',
}))

import ProjectSidebarMenu, {
  canNavigateHome,
} from '@src/components/ProjectSidebarMenu'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

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

function createTestApp(enabledFeatureIds: ReadonlySet<string> = new Set()) {
  const commandSnapshot = {
    context: {
      commands: [],
    },
  }

  return {
    machineManager: {
      machines: [],
    },
    commands: {
      actor: {
        getSnapshot: () => commandSnapshot,
        subscribe: () => ({ unsubscribe: () => undefined }),
      },
      send: vi.fn(),
    },
    settings: {
      actor: {
        send: vi.fn(),
      },
      useSettings: () => ({
        app: {
          machineApi: {
            current: false,
          },
        },
      }),
    },
    singletons: {
      kclManager: {
        engineCommandManager: {},
        switchedFiles: false,
      },
    },
    userFeatures: {
      useHas: (featureFlagId: string, defaultValue: boolean) =>
        enabledFeatureIds.has(featureFlagId) ? true : defaultValue,
    },
  } as unknown as App
}

function renderWithApp(children: ReactNode, app = createTestApp()) {
  return render(
    <AppContext.Provider value={app}>
      <BrowserRouter>{children}</BrowserRouter>
    </AppContext.Provider>
  )
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
    renderWithApp(<ProjectSidebarMenu project={projectWellFormed} />)

    expect(screen.getByTestId('project-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })

  test('Links the logo to Home on web when OPFS cloud is enabled', () => {
    renderWithApp(
      <ProjectSidebarMenu project={projectWellFormed} />,
      createTestApp(new Set([OPFS_CLOUD_FEATURE_FLAG]))
    )

    const logoLink = screen.getByTestId('app-logo').closest('a')

    expect(logoLink).toHaveAttribute('href', PATHS.HOME)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Go home')
  })

  test('Shows the full project-relative file path in the breadcrumb', () => {
    renderWithApp(
      <ProjectSidebarMenu
        enableMenu
        project={projectWellFormed}
        file={nestedFile}
      />
    )

    expect(screen.getByTestId('app-header-file-name')).toHaveTextContent(
      'parts / generated / nested-part.kcl'
    )
  })

  test('Shows the full breadcrumb tooltip when the path is truncated', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)

    renderWithApp(
      <ProjectSidebarMenu
        enableMenu
        project={projectWellFormed}
        file={nestedFile}
      />
    )

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Simple Box / parts / generated / nested-part.kcl'
    )
  })
})
