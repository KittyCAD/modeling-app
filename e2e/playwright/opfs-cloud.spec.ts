import { expect, test } from '@playwright/test'

import {
  type CloudProject,
  PROJECT_DIR,
  createRemoteListGate,
  projectTitles,
  projectToml,
  readOpfsTextFiles,
  routeCloudProjects,
  seedOpfsCloudState,
} from '@e2e/playwright/fixtures/opfsCloud'
import { setup } from '@e2e/playwright/test-utils'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

test(
  'streams remote-only projects into empty OPFS and persists successful clones',
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
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.getByTestId('projects-none')).toBeVisible()

    remoteListGate.release()

    await expect
      .poll(() => projectTitles(page), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([
          'Remote empty one',
          'Remote empty two',
          'Remote empty three',
        ])
      )
    await expect
      .poll(async () => (await projectTitles(page))[0])
      .toBe('Remote empty one')

    const localFiles = await readOpfsTextFiles(page, {
      remoteOne: `${PROJECT_DIR}/Remote empty one/main.kcl`,
      remoteOneToml: `${PROJECT_DIR}/Remote empty one/project.toml`,
      remoteTwo: `${PROJECT_DIR}/Remote empty two/main.kcl`,
      remoteThree: `${PROJECT_DIR}/Remote empty three/main.kcl`,
    })

    expect(localFiles.remoteOne).toContain('remoteEmptyOne = 1')
    expect(localFiles.remoteOneToml).toContain(
      'project_id = "remote-empty-one"'
    )
    expect(localFiles.remoteTwo).toContain('remoteEmptyTwo = 1')
    expect(localFiles.remoteThree).toContain('remoteEmptyThree = 1')

    const remoteListResponsesAfterHydration = apiCalls.remoteListResponses
    remoteListGate.hold()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect
      .poll(() => projectTitles(page))
      .toEqual(
        expect.arrayContaining([
          'Remote empty one',
          'Remote empty two',
          'Remote empty three',
        ])
      )
    await expect
      .poll(async () => (await projectTitles(page))[0])
      .toBe('Remote empty one')
    expect(apiCalls.remoteListResponses).toBe(remoteListResponsesAfterHydration)
  }
)

test(
  'hydrates cloud projects into OPFS without replacing the local-first home list',
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
      listedProjects: [remoteOnlyProject, cleanSyncedProject],
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
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

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

    await seedOpfsCloudState(page, {
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
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect
      .poll(() => projectTitles(page))
      .toEqual(
        expect.arrayContaining([
          'Local only project',
          'Clean synced project',
          'Stale dirty project',
        ])
      )

    await page.evaluate(() => {
      type OpfsCloudHomeWindow = Window &
        typeof globalThis & {
          __opfsCloudHomeSnapshots?: string[][]
          __opfsCloudHomeObserver?: MutationObserver
        }

      const opfsCloudWindow = window as OpfsCloudHomeWindow
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
      opfsCloudWindow.__opfsCloudHomeSnapshots = snapshots
      opfsCloudWindow.__opfsCloudHomeObserver = observer
    })

    remoteListGate.release()

    await expect
      .poll(() => projectTitles(page), { timeout: 20_000 })
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

    const snapshots = await page.evaluate<string[][]>(
      () =>
        (
          window as Window &
            typeof globalThis & {
              __opfsCloudHomeSnapshots?: string[][]
            }
        ).__opfsCloudHomeSnapshots || []
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

    const localFiles = await readOpfsTextFiles(page, {
      remoteOnly: `${PROJECT_DIR}/Remote only project/main.kcl`,
      remoteOnlyToml: `${PROJECT_DIR}/Remote only project/project.toml`,
      cleanSynced: `${PROJECT_DIR}/clean-synced-project/main.kcl`,
      cleanSyncedToml: `${PROJECT_DIR}/clean-synced-project/project.toml`,
      localOnly: `${PROJECT_DIR}/local-only-project/main.kcl`,
      localOnlyToml: `${PROJECT_DIR}/local-only-project/project.toml`,
      staleDirty: `${PROJECT_DIR}/stale-dirty-project/main.kcl`,
    })

    expect(localFiles.remoteOnly).toContain('remoteOnly = 1')
    expect(localFiles.remoteOnlyToml).toContain(
      'project_id = "remote-only-project"'
    )
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

    const remoteListResponsesAfterHydration = apiCalls.remoteListResponses
    remoteListGate.hold()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect
      .poll(() => projectTitles(page))
      .toEqual(
        expect.arrayContaining([
          'Local only project',
          'Clean synced project',
          'Stale dirty project',
          'Remote only project',
        ])
      )
    expect(apiCalls.remoteListResponses).toBe(remoteListResponsesAfterHydration)

    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const documents = await root.getDirectoryHandle('documents')
      const projects = await documents.getDirectoryHandle(
        'zoo-design-studio-projects'
      )
      await projects.removeEntry('Remote only project', { recursive: true })
    })
    const remoteOnlyExistsAfterManualRemoval = await page.evaluate(
      async ({ projectDirectory }) => {
        try {
          await window.fsZds.stat(`${projectDirectory}/Remote only project`)
          return true
        } catch {
          return false
        }
      },
      { projectDirectory: PROJECT_DIR }
    )
    expect(remoteOnlyExistsAfterManualRemoval).toBe(false)

    remoteListGate.hold()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    remoteListGate.release()
    await expect
      .poll(() => projectTitles(page), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['Remote only project']))
    await expect
      .poll(() =>
        page.evaluate(
          ({ projectDirectory }) =>
            window.fsZds.readFile(
              `${projectDirectory}/Remote only project/main.kcl`,
              { encoding: 'utf-8' }
            ),
          { projectDirectory: PROJECT_DIR }
        )
      )
      .toContain('remoteOnly = 1')
  }
)
