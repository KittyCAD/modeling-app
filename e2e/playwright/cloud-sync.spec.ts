import {
  type CloudProject,
  createRemoteListGate,
  opfsPathExists,
  PROJECT_DIR,
  projectTitles,
  projectToml,
  readOpfsTextFiles,
  routeCloudProjects,
  seedCloudSyncState,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { setup } from '@e2e/playwright/test-utils'
import { expect, type Page, test } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

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
          'project.toml': projectToml('Remote empty one'),
        },
      },
      {
        id: 'remote-empty-broken',
        title: 'Remote empty broken',
        revision: 'remote-empty-broken-rev-1',
        updatedAt: '2026-06-02T19:00:00.000Z',
        files: {
          'main.kcl': 'broken = 1\n',
          'project.toml': projectToml('Remote empty broken'),
        },
      },
      {
        id: 'remote-empty-two',
        title: 'Remote empty two',
        revision: 'remote-empty-two-rev-1',
        updatedAt: '2026-06-02T18:00:00.000Z',
        files: {
          'main.kcl': 'remoteEmptyTwo = 1\n',
          'project.toml': projectToml('Remote empty two'),
        },
      },
      {
        id: 'remote-empty-three',
        title: 'Remote empty three',
        revision: 'remote-empty-three-rev-1',
        updatedAt: '2026-06-02T17:00:00.000Z',
        files: {
          'main.kcl': 'remoteEmptyThree = 1\n',
          'project.toml': projectToml('Remote empty three'),
        },
      },
    ]
    const remoteListGate = createRemoteListGate()
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteListGate,
      brokenArchiveProjectIds: ['remote-empty-broken'],
    })

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])
    await page.goto('/')
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
  'streams cloud projects without replacing the local-first home list',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const remoteOnlyProject: CloudProject = {
      id: 'remote-only-project',
      title: 'Remote only project',
      revision: 'remote-only-rev-1',
      files: {
        'main.kcl': 'remoteOnly = 1\n',
        'project.toml': projectToml('Remote only project'),
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
    const remoteListGate = createRemoteListGate()
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects: [
        remoteOnlyProject,
        cleanSyncedProject,
        staleDirtyProject,
      ],
      listedProjects: [
        remoteOnlyProject,
        cleanSyncedProject,
        staleDirtyProject,
      ],
      remoteListGate,
      createProject: () => ({
        id: 'created-local-only-project',
        title: 'Local only project',
        revision: 'created-local-only-rev-1',
        files: {},
      }),
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

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])
    await page.goto('/')
    await expectCloudSyncHomeReady(page)

    const localOnlyFiles = {
      'main.kcl': 'localOnly = 1\n',
      'project.toml': projectToml('Local only project'),
    }
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
      localOnlyToml: `${PROJECT_DIR}/local-only-project/project.toml`,
      staleDirty: `${PROJECT_DIR}/stale-dirty-project/main.kcl`,
    })

    expect(localFiles.cleanSynced).toContain('cleanRemoteUpdate = 2')
    expect(localFiles.cleanSyncedToml).toContain(
      'project_id = "clean-synced-project"'
    )
    expect(localFiles.localOnly).toContain('localOnly = 1')
    expect(localFiles.localOnlyToml).toContain(
      'project_id = "created-local-only-project"'
    )
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
