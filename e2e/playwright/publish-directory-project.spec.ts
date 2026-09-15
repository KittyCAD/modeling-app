import * as fsp from 'node:fs/promises'
import path from 'node:path'
import {
  type CloudProject,
  cloudProjectResponse,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { playwrightPluginSettings } from '@e2e/playwright/storageStates'
import { mockClientErrorReports } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH } from '@src/lib/projectLibraries'
import JSZip from 'jszip'

const FLOW_TIMEOUT = 30_000

declare global {
  interface Window {
    __publishFlowMessages: string[]
  }
}

test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })

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

  test('publishes an open directory-library project and moves the same project into Personal Cloud', async ({
    context,
    homePage,
    page,
    tronApp,
  }, testInfo) => {
    if (!tronApp) {
      throw new Error('tronApp is required for this desktop test.')
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
    const movedProjectPath = path.join(
      cloudLibraryPath,
      'published-directory-project'
    )
    const movedMainFile = path.join(movedProjectPath, 'main.kcl')
    const movedProjectToml = path.join(movedProjectPath, 'project.toml')
    const remoteProjectId = '12945000-0000-4000-8000-000000000101'
    const categoryId = '12945000-0000-4000-8000-000000000201'
    const remoteProjects: CloudProject[] = []
    const remoteArchives = new Map<string, Buffer>()
    const createdProject: CloudProject = {
      id: remoteProjectId,
      title: publicationTitle,
      revision: 'directory-publish-rev-1',
      files: {
        'main.kcl': 'publishedPart = 42\n',
        'project.toml': [
          `title = "${publicationTitle}"`,
          'default_file = "main.kcl"',
          '',
          '[custom]',
          'keep = "yes"',
          '',
          '[cloud."dev.zoo.dev"]',
          `project_id = "${remoteProjectId}"`,
          '',
        ].join('\n'),
      },
    }
    await tronApp.electron.evaluate(
      ({ app }, testPaths) => {
        app.setPath('appData', testPaths.appData)
        app.setPath('home', testPaths.home)
      },
      { appData: testAppDataPath, home: testHomePath }
    )
    await clearCloudSyncState(page)
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
    await fsp.writeFile(sourceMainFile, 'publishedPart = 42\n')
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
        body: JSON.stringify([
          {
            id: categoryId,
            slug: 'fixtures',
            display_name: 'Fixtures',
            description: 'Projects used by end-to-end tests.',
            sort_order: 1,
            is_active: true,
          },
        ]),
      })
    })

    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteArchives,
      createProject: async () => {
        if (!remoteProjects.includes(createdProject)) {
          remoteProjects.push(createdProject)
        }
        remoteArchives.set(
          remoteProjectId,
          await zipLocalProject(movedProjectPath, {
            'project.toml': createdProject.files['project.toml'],
          })
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
    await expect(page.getByTestId('publish-button')).toBeEnabled()

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
      .toBe(movedProjectPath)
    await expect(page.getByTestId('app-header-project-name')).toHaveText(
      publicationTitle
    )
    await expect
      .poll(() => page.url())
      .toContain(encodeURIComponent(movedMainFile))

    await expect.poll(() => apiCalls.creates.length).toBe(1)
    await expect.poll(() => apiCalls.updates.length).toBeGreaterThanOrEqual(1)
    expect(
      apiCalls.updates.some(({ postData }) =>
        postData.includes('A project published from a directory library.')
      )
    ).toBe(true)
    expect(apiCalls.publishes).toEqual([remoteProjectId])
    expect(await pathExists(sourceProjectPath)).toBe(false)
    expect(await pathExists(movedMainFile)).toBe(true)

    const [movedMainContents, movedTomlContents] = await Promise.all([
      fsp.readFile(movedMainFile, 'utf8'),
      fsp.readFile(movedProjectToml, 'utf8'),
    ])
    expect(movedMainContents).toBe('publishedPart = 42\n')
    expect(movedTomlContents).toContain(`title = "${publicationTitle}"`)
    expect(movedTomlContents).toContain('default_file = "main.kcl"')
    expect(movedTomlContents).toContain('[custom]')
    expect(movedTomlContents).toContain('keep = "yes"')
    expect(movedTomlContents).toContain(`project_id = "${remoteProjectId}"`)

    await expect
      .poll(() => readCloudSyncState(page), { timeout: FLOW_TIMEOUT })
      .toMatchObject({
        outboxCount: 0,
        projects: [
          {
            localProjectPath: movedProjectPath,
            remoteProjectId,
            remoteRevision: expect.stringMatching(
              /^directory-publish-rev-[12]$/
            ),
            conflict: undefined,
          },
        ],
      })
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

async function readCloudSyncState(page: Page) {
  return page.evaluate(async () => {
    type StoredProject = {
      localProjectPath: string
      remoteProjectId?: string
      remoteRevision?: string
      conflict?: unknown
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('zds-opfs-cloud-sync', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const getAll = (storeName: string) =>
      new Promise<StoredProject[]>((resolve, reject) => {
        const request = db
          .transaction(storeName, 'readonly')
          .objectStore(storeName)
          .getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

    const [projects, outbox] = await Promise.all([
      getAll('projects'),
      getAll('outbox'),
    ])
    db.close()
    return {
      outboxCount: outbox.length,
      projects: projects.map((project) => ({
        localProjectPath: project.localProjectPath,
        remoteProjectId: project.remoteProjectId,
        remoteRevision: project.remoteRevision,
        conflict: project.conflict,
      })),
    }
  })
}

async function clearCloudSyncState(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('zds-opfs-cloud-sync')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
  )
}

async function zipLocalProject(
  projectPath: string,
  overrides: Record<string, string>
) {
  const zip = new JSZip()
  const entries = await fsp.readdir(projectPath, {
    recursive: true,
    withFileTypes: true,
  })
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const absolutePath = path.join(entry.parentPath, entry.name)
    const relativePath = path.relative(projectPath, absolutePath)
    zip.file(
      relativePath,
      overrides[relativePath] ?? (await fsp.readFile(absolutePath))
    )
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
