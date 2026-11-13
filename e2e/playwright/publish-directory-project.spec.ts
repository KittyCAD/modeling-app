import * as fsp from 'node:fs/promises'
import path from 'node:path'
import { uploadedProject } from '@e2e/playwright/lib/cloudStorageFixture'
import {
  type CloudProject,
  cloudProjectResponse,
  routeCloudProjects,
  zipProject,
} from '@e2e/playwright/lib/cloudProjectTestUtils'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { playwrightPluginSettings } from '@e2e/playwright/storageStates'
import { mockClientErrorReports } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH } from '@src/lib/projectLibraries'

const FLOW_TIMEOUT = 30_000
const publicationCode = '@settings(kclVersion = 3.0)\npublishedPart = 42\n'

declare global {
  interface Window {
    __publishFlowMessages: string[]
  }
}

test.describe('Aquarium publication', { tag: ['@desktop'] }, () => {
  let originalDesktopPaths:
    | {
        appData: string
        home: string
      }
    | undefined

  test.afterEach(async ({ tronApp }) => {
    if (!tronApp || !originalDesktopPaths) {
      return
    }
    await tronApp.electron.evaluate(({ app }, originalPaths) => {
      app.setPath('appData', originalPaths.appData)
      app.setPath('home', originalPaths.home)
    }, originalDesktopPaths)
  })

  test('publishes an independent cloud clone and preserves the directory project', async ({
    context,
    homePage,
    page,
    tronApp,
  }, testInfo) => {
    if (!tronApp) {
      throwTronAppMissing()
    }

    const directoryLibraryPath = testInfo.outputPath(
      'electron-test-projects-dir'
    )
    const cloudTestRoot = testInfo.outputPath('electron-test-cloud-root')
    const testAppDataPath = path.join(cloudTestRoot, 'AppData')
    const testHomePath = path.join(cloudTestRoot, 'Home')
    const desktopPaths = await tronApp.electron.evaluate(({ app }) => ({
      appData: app.getPath('appData'),
      home: app.getPath('home'),
      isMac: process.platform === 'darwin',
    }))
    originalDesktopPaths = desktopPaths
    const cloudLibraryPath = desktopPaths.isMac
      ? path.join(cloudTestRoot, 'CloudStorage', 'Zoo', 'personal')
      : path.join(testHomePath, 'Zoo', 'personal')
    const sourceDirectoryName = 'directory-publish-source'
    const sourceProjectPath = path.join(
      directoryLibraryPath,
      sourceDirectoryName
    )
    const sourceMainFile = path.join(sourceProjectPath, 'main.kcl')
    const sourceProjectToml = path.join(sourceProjectPath, 'project.toml')
    const publicationTitle = 'Published directory project'
    const remoteProjectId = '12945000-0000-4000-8000-000000000101'
    const clonedProjectPath = path.resolve('/__zoo_cloud__', remoteProjectId)
    const clonedMainFile = path.join(clonedProjectPath, 'main.kcl')
    const clonedProjectToml = path.join(clonedProjectPath, 'project.toml')
    const categoryId = '12945000-0000-4000-8000-000000000201'
    const remoteProjects: CloudProject[] = []
    const remoteArchives = new Map<string, Buffer>()
    const createdProject: CloudProject = {
      id: remoteProjectId,
      title: publicationTitle,
      revision: 'directory-publish-rev-1',
      files: {},
    }
    await tronApp.electron.evaluate(
      ({ app }, testPaths) => {
        app.setPath('appData', testPaths.appData)
        app.setPath('home', testPaths.home)
      },
      { appData: testAppDataPath, home: testHomePath }
    )
    await tronApp.cleanProjectDir({
      plugins: playwrightPluginSettings({ cloudSyncEnabled: true }),
      app: {
        libraries: [
          {
            title: 'Local Projects',
            path: directoryLibraryPath,
            type: 'directory',
          },
          {
            title: 'Personal Cloud',
            path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
            type: 'cloud',
          },
        ],
      },
    })
    await fsp.mkdir(sourceProjectPath, { recursive: true })
    await fsp.mkdir(cloudLibraryPath, { recursive: true })
    await fsp.writeFile(sourceMainFile, publicationCode)
    await fsp.writeFile(
      sourceProjectToml,
      [
        'title = "Directory publish source"',
        'default_file = "main.kcl"',
        '',
        '[custom]',
        'keep = "yes"',
        '',
      ].join('\n')
    )

    await mockClientErrorReports(context)
    // Electron reuses its context; publication needs a live modeling connection.
    await context.routeWebSocket('**/ws/modeling/commands**', (socket) => {
      socket.connectToServer()
    })
    await context.route('**/user', async (route) => {
      if (
        new URL(route.request().url()).pathname !== '/user' ||
        route.request().method() !== 'GET'
      ) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '12945000-0000-4000-8000-000000000001',
          name: 'Playwright User',
          username: 'playwright',
          email: 'playwright@example.com',
          image: '',
          created_at: '2026-09-01T12:00:00.000Z',
          updated_at: '2026-09-01T12:00:00.000Z',
        }),
      })
    })
    await context.route('**/projects/categories', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: categoryId,
              slug: 'fixtures',
              display_name: 'Fixtures',
              description: 'Projects used by end-to-end tests.',
              sort_order: 1,
              is_active: true,
            },
          ],
          next_page: null,
        }),
      })
    })

    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteArchives,
      createProject: async (_postData, route) => {
        const uploaded = await uploadedProject(route)
        createdProject.files = uploaded.files
        if (!remoteProjects.includes(createdProject)) {
          remoteProjects.push(createdProject)
        }
        remoteArchives.set(
          remoteProjectId,
          await zipProject(createdProject.files)
        )
        return createdProject
      },
      updateProject: ({ projectId }) => {
        const project = remoteProjects.find(({ id }) => id === projectId)
        if (!project) {
          return undefined
        }

        project.description = 'A project published from a directory library.'
        project.categoryIds = [categoryId]
        project.revision = 'directory-publish-rev-2'
        return { status: 200, body: cloudProjectResponse(project) }
      },
      publishProject: (projectId) => {
        const project = remoteProjects.find(({ id }) => id === projectId)
        if (!project) {
          return undefined
        }

        project.publicationStatus = 'pending_review'
        project.submittedAt = '2026-09-01T12:05:00.000Z'
        return { status: 200, body: cloudProjectResponse(project) }
      },
    })

    await page.addInitScript(() => {
      window.__publishFlowMessages = []
      const observer = new MutationObserver((mutations) => {
        const addedText = mutations
          .flatMap((mutation) => Array.from(mutation.addedNodes))
          .map((node) => node.textContent ?? '')
          .join('\n')
        for (const message of [
          'Reloading file from disk.',
          'The project could not be synced before publication.',
          'Project submitted for review.',
        ]) {
          if (addedText.includes(message)) {
            window.__publishFlowMessages.push(message)
          }
        }
      })
      const observeDocument = () =>
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        })
      if (document.documentElement) {
        observeDocument()
      } else {
        document.addEventListener('DOMContentLoaded', observeDocument, {
          once: true,
        })
      }
    })

    await page.reload()
    await homePage.openProject('Directory publish source')
    await expect(page).toHaveURL(/\/file\/.*main\.kcl/, {
      timeout: FLOW_TIMEOUT,
    })
    await expect(page.getByTestId('publish-button')).toBeEnabled({
      timeout: FLOW_TIMEOUT,
    })
    await page.getByTestId('publish-button').click()
    await expect(
      page.getByRole('heading', { name: 'Publish project' })
    ).toBeVisible()
    await page.getByLabel('Title*').fill(publicationTitle)
    await page
      .getByTestId('publish-project-description-editor')
      .fill('A project published from a directory library.')
    await page.getByRole('checkbox', { name: /Fixtures/ }).check()
    await page.getByRole('button', { name: 'Submit for review' }).click()

    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.app.project?.projectIORefSignal.value.path
          ),
        { timeout: FLOW_TIMEOUT }
      )
      .toBe(clonedProjectPath)
    await expect(page.getByTestId('app-header-project-name')).toHaveText(
      publicationTitle
    )
    await expect
      .poll(() => page.url())
      .toContain(encodeURIComponent(clonedMainFile))

    await expect.poll(() => apiCalls.creates.length).toBe(1)
    await expect
      .poll(
        () =>
          apiCalls.updates.some(({ postData }) =>
            postData.includes('A project published from a directory library.')
          ),
        { timeout: FLOW_TIMEOUT }
      )
      .toBe(true)
    await expect
      .poll(() => apiCalls.publishes, { timeout: FLOW_TIMEOUT })
      .toEqual([remoteProjectId])
    expect(await pathExists(sourceProjectPath)).toBe(true)
    expect(await fsp.readFile(sourceMainFile, 'utf8')).toBe(publicationCode)
    expect(await fsp.readFile(sourceProjectToml, 'utf8')).toContain(
      'title = "Directory publish source"'
    )
    expect(await pathExists(clonedMainFile)).toBe(false)

    const [clonedMainContents, clonedTomlContents] = await page.evaluate(
      async (paths) =>
        Promise.all(
          paths.map(async (file) =>
            new TextDecoder().decode(
              await window.app.fileOperations.readFile(file)
            )
          )
        ),
      [clonedMainFile, clonedProjectToml]
    )
    expect(clonedMainContents).toBe(publicationCode)
    expect(clonedTomlContents).toContain(`title = "${publicationTitle}"`)
    expect(clonedTomlContents).toContain('default_file = "main.kcl"')
    expect(clonedTomlContents).toContain('[custom]')
    expect(clonedTomlContents).toContain('keep = "yes"')

    expect(await page.evaluate(() => window.__publishFlowMessages)).toEqual([
      'Project submitted for review.',
    ])
    await expect(page.getByTestId('cloud-conflict-badge')).toHaveCount(0)
    await expect(
      page.getByTestId('project-sidebar-cloud-conflict-badge')
    ).toHaveCount(0)
  })
})

async function pathExists(targetPath: string) {
  try {
    await fsp.stat(targetPath)
    return true
  } catch {
    return false
  }
}
