import { type Page, expect, test } from '@playwright/test'
import JSZip from 'jszip'

import { setup } from '@e2e/playwright/test-utils'
import { OPFS_CLOUD_FEATURE_FLAG, PROJECT_FOLDER } from '@src/lib/constants'

const PROJECT_DIR = `/documents/${PROJECT_FOLDER}`
const CLOUD_ENVIRONMENT = 'dev.zoo.dev'

type ProjectFiles = Record<string, string>

type CloudProject = {
  id: string
  title: string
  revision: string
  files: ProjectFiles
}

function projectToml(title: string, cloudProjectId?: string) {
  return [
    'default_file = "main.kcl"',
    '',
    '[settings.meta]',
    `title = ${JSON.stringify(title)}`,
    ...(cloudProjectId
      ? [
          '',
          `[cloud.${JSON.stringify(CLOUD_ENVIRONMENT)}]`,
          `project_id = ${JSON.stringify(cloudProjectId)}`,
        ]
      : []),
    '',
  ].join('\n')
}

async function zipProject(files: ProjectFiles) {
  const zip = new JSZip()
  for (const [relativePath, contents] of Object.entries(files)) {
    zip.file(relativePath, contents)
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

async function projectTitles(page: Page) {
  return (await page.getByTestId('project-title').allTextContents()).map(
    (title: string) => title.trim()
  )
}

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
    const remoteArchives = new Map<string, Buffer>([
      [remoteOnlyProject.id, await zipProject(remoteOnlyProject.files)],
      [cleanSyncedProject.id, await zipProject(cleanSyncedProject.files)],
      [staleDirtyProject.id, await zipProject(staleDirtyProject.files)],
    ])

    let releaseRemoteList = false
    const remoteListWaiters: Array<() => void> = []
    const waitForRemoteListRelease = () =>
      releaseRemoteList
        ? Promise.resolve()
        : new Promise<void>((resolve) => remoteListWaiters.push(resolve))
    const releaseCloudProjects = () => {
      releaseRemoteList = true
      for (const resolve of remoteListWaiters.splice(0)) {
        resolve()
      }
    }

    const apiCalls = {
      creates: [] as string[],
      staleUpdates: [] as string[],
    }

    await context.route('**/user/projects**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const pathname = url.pathname
      const projectId = pathname.match(/\/user\/projects\/([^/]+)/)?.[1]

      if (pathname === '/user/projects' && request.method() === 'GET') {
        await waitForRemoteListRelease()
        await route
          .fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: remoteOnlyProject.id,
                title: remoteOnlyProject.title,
                revision: remoteOnlyProject.revision,
              },
              {
                id: cleanSyncedProject.id,
                title: cleanSyncedProject.title,
                revision: cleanSyncedProject.revision,
              },
            ]),
          })
          .catch(() => undefined)
        return
      }

      if (pathname === '/user/projects' && request.method() === 'POST') {
        apiCalls.creates.push((await request.postData()) || '')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'created-local-only-project',
            title: 'Local only project',
            revision: 'created-local-only-rev-1',
          }),
        })
        return
      }

      if (projectId === staleDirtyProject.id && request.method() === 'PUT') {
        apiCalls.staleUpdates.push(
          `${request.url()}\n${(await request.postData()) || ''}`
        )
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'expected_revision is stale',
          }),
        })
        return
      }

      if (projectId && pathname.endsWith('/download')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          body: remoteArchives.get(projectId),
        })
        return
      }

      const remoteProject = [
        remoteOnlyProject,
        cleanSyncedProject,
        staleDirtyProject,
      ].find((project) => project.id === projectId)
      if (remoteProject && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: remoteProject.id,
            title: remoteProject.title,
            revision: remoteProject.revision,
          }),
        })
        return
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'not found' }),
      })
    })

    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

    await page.evaluate(
      async ({ projectDirectory, cloudEnvironment }) => {
        const encoder = new TextEncoder()

        async function getProjectDirectoryHandle(projectName: string) {
          const root = await navigator.storage.getDirectory()
          const documents = await root.getDirectoryHandle('documents', {
            create: true,
          })
          const projects = await documents.getDirectoryHandle(
            'zoo-design-studio-projects',
            { create: true }
          )
          return projects.getDirectoryHandle(projectName, { create: true })
        }

        async function writeFile(
          directory: FileSystemDirectoryHandle,
          relativePath: string,
          contents: string
        ) {
          const parts = relativePath.split('/').filter(Boolean)
          let currentDirectory = directory
          for (const part of parts.slice(0, -1)) {
            currentDirectory = await currentDirectory.getDirectoryHandle(part, {
              create: true,
            })
          }
          const file = await currentDirectory.getFileHandle(parts.at(-1)!, {
            create: true,
          })
          const writable = await file.createWritable()
          await writable.write(encoder.encode(contents))
          await writable.close()
        }

        async function writeProject(
          projectName: string,
          files: Record<string, string>
        ) {
          const directory = await getProjectDirectoryHandle(projectName)
          for (const [relativePath, contents] of Object.entries(files)) {
            await writeFile(directory, relativePath, contents)
          }
        }

        async function sha256(contents: string) {
          const data = encoder.encode(contents)
          const hash = await crypto.subtle.digest('SHA-256', data)
          return Array.from(new Uint8Array(hash))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
        }

        async function manifest(files: Record<string, string>) {
          return {
            files: Object.fromEntries(
              await Promise.all(
                Object.entries(files).map(async ([relativePath, contents]) => {
                  const data = encoder.encode(contents)
                  return [
                    relativePath,
                    {
                      byteSize: data.byteLength,
                      sha256: await sha256(contents),
                    },
                  ]
                })
              )
            ),
          }
        }

        function openSyncDb() {
          return new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('zds-opfs-cloud-sync', 1)
            request.onupgradeneeded = () => {
              const db = request.result
              if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', {
                  keyPath: 'localProjectPath',
                })
              }
              if (!db.objectStoreNames.contains('outbox')) {
                db.createObjectStore('outbox', {
                  keyPath: 'id',
                  autoIncrement: true,
                })
              }
            }
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result)
          })
        }

        async function transact(
          storeName: string,
          mode: IDBTransactionMode,
          callback: (store: IDBObjectStore) => void
        ) {
          const db = await openSyncDb()
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, mode)
            const store = transaction.objectStore(storeName)
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            callback(store)
          })
        }

        const localOnlyFiles = {
          'main.kcl': 'localOnly = 1\n',
          'project.toml':
            'default_file = "main.kcl"\n\n[settings.meta]\ntitle = "Local only project"\n',
        }
        const cleanSyncedFiles = {
          'main.kcl': 'cleanLocal = 1\n',
          'project.toml': `default_file = "main.kcl"\n\n[settings.meta]\ntitle = "Clean synced project"\n\n[cloud.${JSON.stringify(
            cloudEnvironment
          )}]\nproject_id = "clean-synced-project"\n`,
        }
        const staleBaseFiles = {
          'main.kcl': 'staleBase = 1\n',
          'project.toml': `default_file = "main.kcl"\n\n[settings.meta]\ntitle = "Stale dirty project"\n\n[cloud.${JSON.stringify(
            cloudEnvironment
          )}]\nproject_id = "stale-dirty-project"\n`,
        }
        const staleDirtyFiles = {
          ...staleBaseFiles,
          'main.kcl': 'staleLocalDirty = 2\n',
        }

        await writeProject('local-only-project', localOnlyFiles)
        await writeProject('clean-synced-project', cleanSyncedFiles)
        await writeProject('stale-dirty-project', staleDirtyFiles)

        const cleanSyncedManifest = await manifest(cleanSyncedFiles)
        const staleBaseManifest = await manifest(staleBaseFiles)

        await transact('projects', 'readwrite', (store) => {
          store.put({
            schemaVersion: 1,
            localProjectPath: `${projectDirectory}/clean-synced-project`,
            projectName: 'clean-synced-project',
            remoteProjectId: 'clean-synced-project',
            remoteRevision: 'clean-rev-1',
            baseManifest: cleanSyncedManifest,
            lastSyncedAt: new Date().toISOString(),
          })
          store.put({
            schemaVersion: 1,
            localProjectPath: `${projectDirectory}/stale-dirty-project`,
            projectName: 'stale-dirty-project',
            remoteProjectId: 'stale-dirty-project',
            remoteRevision: 'stale-rev-1',
            baseManifest: staleBaseManifest,
            lastSyncedAt: new Date().toISOString(),
          })
        })

        await transact('outbox', 'readwrite', (store) => {
          store.add({
            projectPath: `${projectDirectory}/local-only-project`,
            kind: 'upsert',
            targetPath: `${projectDirectory}/local-only-project`,
            createdAt: new Date().toISOString(),
          })
          store.add({
            projectPath: `${projectDirectory}/stale-dirty-project`,
            kind: 'upsert',
            targetPath: `${projectDirectory}/stale-dirty-project/main.kcl`,
            createdAt: new Date().toISOString(),
          })
        })
      },
      {
        projectDirectory: PROJECT_DIR,
        cloudEnvironment: CLOUD_ENVIRONMENT,
      }
    )

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
      ;(window as any).__opfsCloudHomeSnapshots = snapshots
      ;(window as any).__opfsCloudHomeObserver = observer
    })

    releaseCloudProjects()

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
    await expect
      .poll(() => apiCalls.staleUpdates.length)
      .toBeGreaterThanOrEqual(1)

    const snapshots = await page.evaluate<string[][]>(
      () => (window as any).__opfsCloudHomeSnapshots || []
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

    const localFiles = await page.evaluate(
      async ({ projectDirectory }) => {
        const readText = (path: string) =>
          window.fsZds.readFile(path, { encoding: 'utf-8' })
        return {
          remoteOnly: await readText(
            `${projectDirectory}/Remote only project/main.kcl`
          ),
          remoteOnlyToml: await readText(
            `${projectDirectory}/Remote only project/project.toml`
          ),
          cleanSynced: await readText(
            `${projectDirectory}/clean-synced-project/main.kcl`
          ),
          cleanSyncedToml: await readText(
            `${projectDirectory}/clean-synced-project/project.toml`
          ),
          localOnly: await readText(
            `${projectDirectory}/local-only-project/main.kcl`
          ),
          localOnlyToml: await readText(
            `${projectDirectory}/local-only-project/project.toml`
          ),
          staleDirty: await readText(
            `${projectDirectory}/stale-dirty-project/main.kcl`
          ),
        }
      },
      { projectDirectory: PROJECT_DIR }
    )

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
    expect(apiCalls.staleUpdates[0]).toContain('expected_revision')
  }
)
