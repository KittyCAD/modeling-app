import { randomUUID } from 'node:crypto'
import { expect, test } from '@e2e/playwright/base-test'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import {
  type CloudProject,
  cloudProjectResponse,
  createRemoteListGate,
  opfsPathExists,
  PROJECT_DIR,
  projectTitles,
  projectToml,
  readCloudSyncProjectMetadata,
  readOpfsTextFiles,
  routeCloudProjects,
  seedCloudSyncState,
  zipProject,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import {
  createProject,
  expectCloudFeatureEnabled,
  mockClientErrorReports,
  setup,
  token,
} from '@e2e/playwright/test-utils'
import type { Page, Response } from '@playwright/test'
import type { CreatedRemoteProject } from '@src/lib/cloudSync/types'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import JSZip from 'jszip'

const CLOUD_SYNC_E2E_TIMEOUT = 20_000

async function openHomeProject(page: Page, projectTitle: string) {
  const projectLink = page.getByTestId('project-link').filter({
    has: page.getByTestId('project-title').filter({ hasText: projectTitle }),
  })

  await expect(projectLink).toBeVisible({ timeout: CLOUD_SYNC_E2E_TIMEOUT })
  await projectLink.click()
}

async function expectProjectFileRoute(page: Page) {
  await expect(page).toHaveURL(/\/file\/.*main\.kcl/, {
    timeout: CLOUD_SYNC_E2E_TIMEOUT,
  })
}

async function expectCloudSyncHomeReady(page: Page) {
  await expect(
    page.getByRole('heading', { name: /^(Project Libraries|Personal Cloud)$/ })
  ).toBeVisible({ timeout: CLOUD_SYNC_E2E_TIMEOUT })
}

test(
  'syncs an edit queued during first upload with the real development API',
  { tag: ['@web'] },
  async ({ context, page, request }, testInfo) => {
    const apiUrl = 'https://api.dev.zoo.dev'
    const headers = { Authorization: `Bearer ${token}` }
    const projectName = `cloud-sync-e2e-${randomUUID()}`
    const projectPath = `${PROJECT_DIR}/${projectName}`
    const firstUpload = Promise.withResolvers<Response>()
    const releaseUpload = Promise.withResolvers<undefined>()
    let createCount = 0

    await expect(await request.get(`${apiUrl}/user`, { headers })).toBeOK()
    await page.exposeFunction(
      'holdCloudCreationResponse',
      () => releaseUpload.promise
    )
    await page.addInitScript((createUrl) => {
      const originalFetch = globalThis.fetch.bind(globalThis)
      globalThis.fetch = async (input, init) => {
        const response = await originalFetch(input, init)
        if (response.url === createUrl && init?.method === 'POST') {
          // WebKit's route.fetch() drops multipart file contents. Let the
          // browser send the upload and only delay delivery of its response.
          await (
            globalThis as typeof globalThis & {
              holdCloudCreationResponse: () => Promise<undefined>
            }
          ).holdCloudCreationResponse()
        }
        return response
      }
    }, `${apiUrl}/user/projects`)
    page.on('response', (response) => {
      if (
        response.url() === `${apiUrl}/user/projects` &&
        response.request().method() === 'POST'
      ) {
        createCount += 1
        firstUpload.resolve(response)
      }
    })

    try {
      await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
        cloudSyncEnabled: true,
      })
      await expectCloudFeatureEnabled(page)
      // The shared CI account has thousands of projects. Filter their cards
      // through the UI without replacing the real project-list response.
      await page.getByPlaceholder(/^Search projects/).fill(projectName)
      await expect(page.getByTestId('project-link')).toHaveCount(0)
      await createProject({ name: projectName, page })
      await expectProjectFileRoute(page)

      await expect
        .poll(() => createCount, { timeout: CLOUD_SYNC_E2E_TIMEOUT })
        .toBeGreaterThan(0)
      const response = await firstUpload.promise
      expect(response.ok()).toBe(true)
      const created: CreatedRemoteProject = await response.json()
      expect(created.id).toBeTruthy()
      expect(created.revision).toBeTruthy()
      expect(created.files.map((file) => file.relative_path)).toEqual(
        expect.arrayContaining(['main.kcl', 'project.toml'])
      )
      for (const file of created.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        expect(file.byte_size).toBeGreaterThanOrEqual(0)
      }

      const editor = new EditorFixture(page)
      await editor.openPane()
      await editor.codeContent.fill('queuedCloudEdit = 42\n')
      await expect
        .poll(
          () => readOpfsTextFiles(page, { main: `${projectPath}/main.kcl` }),
          { timeout: CLOUD_SYNC_E2E_TIMEOUT }
        )
        .toMatchObject({ main: 'queuedCloudEdit = 42\n' })

      const updatedResponse = page.waitForResponse(
        (result) =>
          new URL(result.url()).pathname === `/user/projects/${created.id}` &&
          result.request().method() === 'PUT',
        { timeout: CLOUD_SYNC_E2E_TIMEOUT }
      )
      releaseUpload.resolve(undefined)
      const uploaded = await updatedResponse
      expect(uploaded.ok()).toBe(true)
      expect(
        new URL(uploaded.url()).searchParams.get('expected_revision')
      ).toBe(created.revision)
      const updated = await uploaded.json()
      await expect
        .poll(() => readCloudSyncProjectMetadata(page, projectPath), {
          timeout: CLOUD_SYNC_E2E_TIMEOUT,
        })
        .toMatchObject({
          remoteProjectId: created.id,
          remoteRevision: updated.revision,
          lastSyncedAt: expect.any(String),
          pendingCount: 0,
          conflict: undefined,
          lastFailure: undefined,
        })
      const files = await readOpfsTextFiles(page, {
        projectToml: `${projectPath}/project.toml`,
      })
      expect(files.projectToml).toContain(`project_id = "${created.id}"`)

      const download = await request.get(
        `${apiUrl}/user/projects/${created.id}/download?format=zip`,
        { headers }
      )
      await expect(download).toBeOK()
      const archive = await JSZip.loadAsync(await download.body())
      expect(await archive.file(/(^|\/)main\.kcl$/)[0]?.async('string')).toBe(
        'queuedCloudEdit = 42\n'
      )
      expect(
        await archive.file(/(^|\/)project\.toml$/)[0]?.async('string')
      ).toContain(`project_id = "${created.id}"`)
      expect(createCount).toBe(1)
      await expect(
        page.getByTestId('project-sidebar-cloud-conflict-badge')
      ).toHaveCount(0)
      await expect(page.getByTestId('cloud-conflict-dialog')).toHaveCount(0)
    } finally {
      releaseUpload.resolve(undefined)
      await page.close()
      // A failed run may have created duplicates. Delete only this run's
      // uniquely named projects, after stopping the app's sync loop.
      const listed = await request.get(`${apiUrl}/user/projects`, { headers })
      await expect(listed).toBeOK()
      const projects: { id: string; title: string }[] = await listed.json()
      for (const project of projects.filter((p) => p.title === projectName)) {
        const url = `${apiUrl}/user/projects/${project.id}`
        await expect(await request.delete(url, { headers })).toBeOK()
        expect((await request.get(url, { headers })).status()).toBe(404)
      }
    }
  }
)

test(
  'creates a multi-file sample in Personal Cloud from Home',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const createdProject: CloudProject = {
      id: 'created-sample-project',
      title: 'Artificial Heart',
      revision: 'created-sample-rev-1',
      files: {},
    }
    const remoteProjects: CloudProject[] = []
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      createProject: () => {
        remoteProjects.push(createdProject)
        return createdProject
      },
      updateProject: ({ projectId }) => {
        if (projectId !== createdProject.id) {
          return undefined
        }

        createdProject.revision = 'created-sample-rev-2'
        return { status: 200, body: cloudProjectResponse(createdProject) }
      },
    })

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
      cloudSyncEnabled: true,
    })
    await expectCloudFeatureEnabled(page)
    await expectCloudSyncHomeReady(page)

    await page.getByTestId('home-create-from-sample').click()
    await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText('sample')
    await page
      .getByRole('option', { name: 'Artificial Heart', exact: true })
      .click()

    await expect(page).toHaveURL(/artificial-heart%2Fmain\.kcl$/, {
      timeout: CLOUD_SYNC_E2E_TIMEOUT,
    })
    await expect
      .poll(() => apiCalls.creates.length, {
        timeout: CLOUD_SYNC_E2E_TIMEOUT,
      })
      .toBe(1)
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/artificial-heart/housing.kcl`)
      )
      .toBe(true)
    const files = await readOpfsTextFiles(page, {
      main: `${PROJECT_DIR}/artificial-heart/main.kcl`,
    })
    expect(files.main).toContain('import "housing.kcl" as housing')
    await expect(
      page.getByText('Unable to determine the project directory.')
    ).toHaveCount(0)
  }
)

test(
  'streams remote-only projects into an empty local list and materializes opened clones',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const remoteProjects: CloudProject[] = [
      {
        id: 'remote-empty-one',
        title: 'Remote empty one',
        revision: 'remote-empty-one-rev-1',
        updatedAt: '2026-06-02T20:00:00.000Z',
        files: {
          'main.kcl': 'remoteEmptyOne = 1\n',
          'project.toml': projectToml('Remote empty one', 'remote-empty-one'),
        },
      },
      {
        id: 'remote-empty-broken',
        title: 'Remote empty broken',
        revision: 'remote-empty-broken-rev-1',
        updatedAt: '2026-06-02T19:00:00.000Z',
        files: {
          'main.kcl': 'broken = 1\n',
          'project.toml': projectToml(
            'Remote empty broken',
            'remote-empty-broken'
          ),
        },
      },
      {
        id: 'remote-empty-two',
        title: 'Remote empty two',
        revision: 'remote-empty-two-rev-1',
        updatedAt: '2026-06-02T18:00:00.000Z',
        files: {
          'main.kcl': 'remoteEmptyTwo = 1\n',
          'project.toml': projectToml('Remote empty two', 'remote-empty-two'),
        },
      },
      {
        id: 'remote-empty-three',
        title: 'Remote empty three',
        revision: 'remote-empty-three-rev-1',
        updatedAt: '2026-06-02T17:00:00.000Z',
        files: {
          'main.kcl': 'remoteEmptyThree = 1\n',
          'project.toml': projectToml(
            'Remote empty three',
            'remote-empty-three'
          ),
        },
      },
    ]
    const remoteListGate = createRemoteListGate()
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteListGate,
      brokenArchiveProjectIds: ['remote-empty-broken'],
    })

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
      cloudSyncEnabled: true,
    })
    await expectCloudFeatureEnabled(page)
    await expectCloudSyncHomeReady(page)
    await expect(
      page.getByTestId('project-library-empty').first()
    ).toBeVisible()

    remoteListGate.release()

    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(
        expect.arrayContaining([
          'Remote empty one',
          'Remote empty broken',
          'Remote empty two',
          'Remote empty three',
        ])
      )
    await expect
      .poll(async () => (await projectTitles(page))[0])
      .toBe('Remote empty one')
    expect(apiCalls.downloads).toEqual([])

    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/remote-empty-one/main.kcl`)
      )
      .toBe(false)
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/remote-empty-two/main.kcl`)
      )
      .toBe(false)

    await openHomeProject(page, 'Remote empty one')
    await expect
      .poll(() => apiCalls.downloads, { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(['remote-empty-one'])
    await expectProjectFileRoute(page)

    const localFiles = await readOpfsTextFiles(page, {
      remoteOne: `${PROJECT_DIR}/remote-empty-one/main.kcl`,
      remoteOneToml: `${PROJECT_DIR}/remote-empty-one/project.toml`,
    })

    expect(localFiles.remoteOne).toContain('remoteEmptyOne = 1')
    expect(localFiles.remoteOneToml).toContain(
      'project_id = "remote-empty-one"'
    )

    const remoteListResponsesAfterMaterialization = apiCalls.remoteListResponses
    remoteListGate.hold()

    await page.goto('/')
    await expectCloudSyncHomeReady(page)
    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(expect.arrayContaining(['Remote empty one']))
    await expect
      .poll(async () => (await projectTitles(page))[0])
      .toBe('Remote empty one')
    expect(apiCalls.remoteListResponses).toBe(
      remoteListResponsesAfterMaterialization
    )
  }
)

test(
  'opens a shared project in Personal Cloud when no project is already open',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const publicProjectId = 'aquarium-shared-project'
    const publicProjectTitle = '!!!'
    const publicProjectDirectoryName = 'shared-project'
    const publicProjectSettingsId = '29501ba6-dfa1-486f-b51d-aa9331ee441e'
    const publicProjectFiles = {
      'main.kcl': 'aquariumShared = 1\n',
      'project.toml': [
        '[settings.meta]',
        `id = "${publicProjectSettingsId}"`,
        '',
      ].join('\n'),
    }
    const personalCloudProject: CloudProject = {
      id: 'personal-cloud-copy',
      title: publicProjectTitle,
      revision: 'personal-cloud-copy-rev-1',
      files: {
        'main.kcl': publicProjectFiles['main.kcl'],
      },
    }
    const publicProjectArchive = await zipProject(publicProjectFiles)
    let publicProjectDownloads = 0
    await context.route(
      `**/projects/public/${publicProjectId}**`,
      async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/download')) {
          publicProjectDownloads += 1
          await route.fulfill({
            status: 200,
            contentType: 'application/zip',
            headers: {
              'content-disposition': 'attachment; filename="...zip"',
            },
            body: publicProjectArchive,
          })
          return
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categories: [],
            description: '',
            id: publicProjectId,
            like_count: 0,
            owner: { username: 'aquarium' },
            published_at: '2026-08-12T00:00:00Z',
            title: publicProjectTitle,
          }),
        })
      }
    )
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects: [personalCloudProject],
      listedProjects: [],
      createProject: async () => {
        const files = await readOpfsTextFiles(page, {
          projectToml: `${PROJECT_DIR}/${publicProjectDirectoryName}/project.toml`,
        })
        personalCloudProject.files['project.toml'] = [
          files.projectToml,
          '[cloud."dev.zoo.dev"]',
          'project_id = "personal-cloud-copy"',
          '',
        ].join('\n')
        return personalCloudProject
      },
      updateProject: ({ projectId, url }) => {
        expect(projectId).toBe(personalCloudProject.id)
        expect(new URL(url).searchParams.get('expected_revision')).toBe(
          personalCloudProject.revision
        )
        personalCloudProject.revision = 'personal-cloud-copy-rev-2'
        return { status: 200, body: cloudProjectResponse(personalCloudProject) }
      },
    })

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
      cloudSyncEnabled: true,
    })
    // Open the shared link directly. Visiting Home first interrupts its pending
    // cloud requests and lazy imports when WebKit navigates to the shared link.
    await page.goto(`/?project-id=${publicProjectId}&ask-open-desktop=true`)
    await page.getByTestId('continue-to-web-app-button').click()

    await expect
      .poll(() => apiCalls.creates.length, {
        timeout: CLOUD_SYNC_E2E_TIMEOUT,
      })
      .toBe(1)
    expect(publicProjectDownloads).toBe(1)
    await expectProjectFileRoute(page)
    await expect
      .poll(() =>
        opfsPathExists(
          page,
          `${PROJECT_DIR}/${publicProjectDirectoryName}/main.kcl`
        )
      )
      .toBe(true)
    await expect
      .poll(
        () =>
          readCloudSyncProjectMetadata(
            page,
            `${PROJECT_DIR}/${publicProjectDirectoryName}`
          ),
        { timeout: CLOUD_SYNC_E2E_TIMEOUT }
      )
      .toMatchObject({
        remoteProjectId: personalCloudProject.id,
        lastSyncedAt: expect.any(String),
        pendingCount: 0,
        conflict: undefined,
        lastFailure: undefined,
      })
    await expect(
      page.getByTestId('project-sidebar-cloud-conflict-badge')
    ).toHaveCount(0)
    await expect(page.getByTestId('cloud-conflict-dialog')).toHaveCount(0)
    const files = await readOpfsTextFiles(page, {
      main: `${PROJECT_DIR}/${publicProjectDirectoryName}/main.kcl`,
      projectToml: `${PROJECT_DIR}/${publicProjectDirectoryName}/project.toml`,
    })
    expect(files.main).toContain('aquariumShared = 1')
    expect(files.projectToml).toContain('project_id = "personal-cloud-copy"')
    expect(apiCalls.creates).toHaveLength(1)
    expect(apiCalls.downloads).toHaveLength(0)
    const clonedProjectSettingsId = files.projectToml.match(
      /\[settings\.meta\]\s*\nid = "([^"]+)"/
    )?.[1]
    expect(clonedProjectSettingsId).toBeDefined()
    expect(clonedProjectSettingsId).not.toBe(publicProjectSettingsId)
    await expect(
      page.getByText('Unable to determine the project directory.')
    ).toHaveCount(0)
    await expectProjectFileRoute(page)
  }
)

test(
  'streams cloud projects without replacing the local-first home list',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const remoteOnlyProject: CloudProject = {
      id: 'remote-only-project',
      title: 'Remote only project',
      revision: 'remote-only-rev-1',
      files: {
        'main.kcl': 'remoteOnly = 1\n',
        'project.toml': projectToml(
          'Remote only project',
          'remote-only-project'
        ),
      },
    }
    const cleanSyncedProject: CloudProject = {
      id: 'clean-synced-project',
      title: 'Clean synced project',
      revision: 'clean-rev-2',
      files: {
        'main.kcl': 'cleanRemoteUpdate = 2\n',
        'project.toml': projectToml(
          'Clean synced project',
          'clean-synced-project'
        ),
      },
    }
    const staleDirtyProject: CloudProject = {
      id: 'stale-dirty-project',
      title: 'Stale dirty project',
      revision: 'stale-rev-1',
      files: {
        'main.kcl': 'staleRemote = 1\n',
        'project.toml': projectToml(
          'Stale dirty project',
          'stale-dirty-project'
        ),
      },
    }
    const localOnlyFiles = {
      'main.kcl': 'localOnly = 1\n',
      'project.toml': projectToml('Local only project'),
    }
    const createdLocalOnlyProject: CloudProject = {
      id: 'created-local-only-project',
      title: 'Local only project',
      revision: 'created-local-only-rev-1',
      files: {
        ...localOnlyFiles,
        'project.toml': projectToml(
          'Local only project',
          'created-local-only-project'
        ),
      },
    }
    const remoteProjects = [
      remoteOnlyProject,
      cleanSyncedProject,
      staleDirtyProject,
    ]
    const remoteArchives = new Map<string, Buffer>(
      await Promise.all(
        remoteProjects.map(
          async (project) =>
            [project.id, await zipProject(project.files)] as const
        )
      )
    )
    const remoteListGate = createRemoteListGate()
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      listedProjects: remoteProjects,
      remoteArchives,
      remoteListGate,
      createProject: async () => {
        remoteProjects.push(createdLocalOnlyProject)
        remoteArchives.set(
          createdLocalOnlyProject.id,
          await zipProject(createdLocalOnlyProject.files)
        )
        return createdLocalOnlyProject
      },
      updateProject: ({ projectId }) =>
        projectId === staleDirtyProject.id
          ? {
              status: 409,
              body: {
                message: 'expected_revision is stale',
              },
            }
          : undefined,
    })
    const staleUpdateCalls = () =>
      apiCalls.updates.filter(
        (update) => update.projectId === staleDirtyProject.id
      )

    await mockClientErrorReports(context)
    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
      cloudSyncEnabled: true,
    })
    await expectCloudFeatureEnabled(page)
    await expectCloudSyncHomeReady(page)

    const cleanSyncedFiles = {
      'main.kcl': 'cleanLocal = 1\n',
      'project.toml': projectToml(
        'Clean synced project',
        'clean-synced-project'
      ),
    }
    const staleBaseFiles = {
      'main.kcl': 'staleBase = 1\n',
      'project.toml': projectToml('Stale dirty project', 'stale-dirty-project'),
    }
    const staleDirtyFiles = {
      ...staleBaseFiles,
      'main.kcl': 'staleLocalDirty = 2\n',
    }

    await seedCloudSyncState(page, {
      projects: [
        {
          projectName: 'local-only-project',
          files: localOnlyFiles,
        },
        {
          projectName: 'clean-synced-project',
          files: cleanSyncedFiles,
        },
        {
          projectName: 'stale-dirty-project',
          files: staleDirtyFiles,
        },
      ],
      metadata: [
        {
          projectName: 'clean-synced-project',
          remoteProjectId: 'clean-synced-project',
          remoteRevision: 'clean-rev-1',
          baseFiles: cleanSyncedFiles,
        },
        {
          projectName: 'stale-dirty-project',
          remoteProjectId: 'stale-dirty-project',
          remoteRevision: 'stale-rev-1',
          baseFiles: staleBaseFiles,
        },
      ],
      outbox: [
        {
          projectName: 'local-only-project',
          kind: 'upsert',
        },
        {
          projectName: 'stale-dirty-project',
          kind: 'upsert',
          targetRelativePath: 'main.kcl',
        },
      ],
    })

    await page.reload()
    await expectCloudSyncHomeReady(page)
    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(
        expect.arrayContaining([
          'Local only project',
          'Clean synced project',
          'Stale dirty project',
        ])
      )

    // From this point onward, watch Home for destructive churn. The page has
    // already rendered the local-first OPFS projects, and the remote list is
    // still blocked. After the gate opens, cloud sync should append or update
    // projects without briefly clearing the already-visible local project cards.
    await page.evaluate(() => {
      type CloudSyncHomeWindow = Window &
        typeof globalThis & {
          __cloudSyncHomeSnapshots?: string[][]
          __cloudSyncHomeObserver?: MutationObserver
        }

      const cloudSyncWindow = window as CloudSyncHomeWindow
      const snapshots: string[][] = []
      const readTitles = () =>
        Array.from(document.querySelectorAll('[data-testid="project-title"]'))
          .map((element) => element.textContent?.trim() || '')
          .filter(Boolean)
      const observer = new MutationObserver(() => {
        snapshots.push(readTitles())
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      snapshots.push(readTitles())
      cloudSyncWindow.__cloudSyncHomeSnapshots = snapshots
      cloudSyncWindow.__cloudSyncHomeObserver = observer
    })

    // Let the mocked cloud index request finish. This introduces:
    // - one remote-only project that should appear as a cloud-only card,
    // - one clean synced project whose remote revision is newer,
    // - one stale dirty project whose remote update should reject.
    remoteListGate.release()

    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(
        expect.arrayContaining([
          'Local only project',
          'Clean synced project',
          'Stale dirty project',
          'Remote only project',
        ])
      )
    await expect.poll(() => apiCalls.creates.length).toBeGreaterThanOrEqual(1)
    await expect.poll(() => staleUpdateCalls().length).toBeGreaterThanOrEqual(1)
    await expect
      .poll(
        () =>
          readCloudSyncProjectMetadata(
            page,
            `${PROJECT_DIR}/local-only-project`
          ),
        { timeout: CLOUD_SYNC_E2E_TIMEOUT }
      )
      .toMatchObject({ remoteProjectId: 'created-local-only-project' })

    // The mutation observer recorded every project-title DOM change after the
    // local list appeared. Once all local-first projects are present, every
    // later snapshot should still contain at least those same cards. This is
    // the regression check for Home replacing the list mid-hydration.
    const snapshots = await page.evaluate<string[][]>(
      () =>
        (
          window as Window &
            typeof globalThis & {
              __cloudSyncHomeSnapshots?: string[][]
            }
        ).__cloudSyncHomeSnapshots || []
    )
    const snapshotsAfterLocalList = snapshots.filter((titles) =>
      [
        'Local only project',
        'Clean synced project',
        'Stale dirty project',
      ].every((title) => titles.includes(title))
    )
    expect(snapshotsAfterLocalList.length).toBeGreaterThan(0)
    expect(snapshotsAfterLocalList.every((titles) => titles.length >= 3)).toBe(
      true
    )

    // Verify the reconciliation policy at the OPFS layer, not just in the UI:
    // remote-only projects are listed without being cloned, clean synced
    // projects can accept newer remote contents, local-only projects are
    // created remotely and get a cloud project id, and stale dirty projects
    // keep their local dirty file.
    expect(apiCalls.downloads).not.toContain('remote-only-project')
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/remote-only-project/main.kcl`)
      )
      .toBe(false)

    const localFiles = await readOpfsTextFiles(page, {
      cleanSynced: `${PROJECT_DIR}/clean-synced-project/main.kcl`,
      cleanSyncedToml: `${PROJECT_DIR}/clean-synced-project/project.toml`,
      localOnly: `${PROJECT_DIR}/local-only-project/main.kcl`,
      staleDirty: `${PROJECT_DIR}/stale-dirty-project/main.kcl`,
    })

    expect(localFiles.cleanSynced).toContain('cleanRemoteUpdate = 2')
    expect(localFiles.cleanSyncedToml).toContain(
      'project_id = "clean-synced-project"'
    )
    expect(localFiles.localOnly).toContain('localOnly = 1')
    expect(localFiles.staleDirty).toContain('staleLocalDirty = 2')
    expect(staleUpdateCalls()[0]?.url).toContain('expected_revision')

    await openHomeProject(page, 'Remote only project')
    await expect
      .poll(() => apiCalls.downloads, { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(expect.arrayContaining(['remote-only-project']))
    await expectProjectFileRoute(page)

    const remoteOnlyFiles = await readOpfsTextFiles(page, {
      remoteOnly: `${PROJECT_DIR}/remote-only-project/main.kcl`,
      remoteOnlyToml: `${PROJECT_DIR}/remote-only-project/project.toml`,
    })
    expect(remoteOnlyFiles.remoteOnly).toContain('remoteOnly = 1')
    expect(remoteOnlyFiles.remoteOnlyToml).toContain(
      'project_id = "remote-only-project"'
    )
    const remoteOnlyDownloadsAfterFirstOpen = apiCalls.downloads.filter(
      (projectId) => projectId === 'remote-only-project'
    ).length

    const remoteListResponsesAfterMaterialization = apiCalls.remoteListResponses
    remoteListGate.hold()

    // Reload with the remote index blocked. A successfully materialized
    // project should now behave like a normal local OPFS project, so Home should
    // show it from local state without needing another remote list response.
    await page.goto('/')
    await expectCloudSyncHomeReady(page)
    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(
        expect.arrayContaining([
          'Local only project',
          'Clean synced project',
          'Stale dirty project',
          'Remote only project',
        ])
      )
    expect(apiCalls.remoteListResponses).toBe(
      remoteListResponsesAfterMaterialization
    )

    // Simulate a user/client losing the local clone after the first successful
    // materialization. The next cloud index response should restore the card,
    // and opening that card should clone the remote-only project again.
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const documents = await root.getDirectoryHandle('documents')
      const projects = await documents.getDirectoryHandle(
        'zoo-design-studio-projects'
      )
      await projects.removeEntry('remote-only-project', { recursive: true })
    })
    const remoteOnlyExistsAfterManualRemoval = await opfsPathExists(
      page,
      `${PROJECT_DIR}/remote-only-project`
    )
    expect(remoteOnlyExistsAfterManualRemoval).toBe(false)

    // Start the reload while the remote list is blocked to prove the project is
    // really absent locally, then release the gate and confirm the cloud index
    // restores the Home card without restoring OPFS files until the card opens.
    remoteListGate.hold()
    await page.reload()
    await expectCloudSyncHomeReady(page)
    remoteListGate.release()
    await expect
      .poll(() => projectTitles(page), { timeout: CLOUD_SYNC_E2E_TIMEOUT })
      .toEqual(expect.arrayContaining(['Remote only project']))
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/remote-only-project/main.kcl`)
      )
      .toBe(false)
    expect(
      apiCalls.downloads.filter(
        (projectId) => projectId === 'remote-only-project'
      ).length
    ).toBe(remoteOnlyDownloadsAfterFirstOpen)

    await openHomeProject(page, 'Remote only project')
    await expect
      .poll(
        () =>
          apiCalls.downloads.filter(
            (projectId) => projectId === 'remote-only-project'
          ).length,
        { timeout: CLOUD_SYNC_E2E_TIMEOUT }
      )
      .toBeGreaterThan(remoteOnlyDownloadsAfterFirstOpen)
    await expectProjectFileRoute(page)
    await expect
      .poll(() =>
        page.evaluate(
          ({ projectDirectory }) =>
            window.fsZds.readFile(
              `${projectDirectory}/remote-only-project/main.kcl`,
              { encoding: 'utf-8' }
            ),
          { projectDirectory: PROJECT_DIR }
        )
      )
      .toContain('remoteOnly = 1')
  }
)
