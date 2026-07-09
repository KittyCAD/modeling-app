import type { BrowserContext, Page, Route } from '@playwright/test'
import { PROJECT_FOLDER } from '@src/lib/constants'
import JSZip from 'jszip'

// Test utilities for the cloud sync contract. These helpers are grouped
// because the E2E scenarios need the local project tree, the cloud sync
// IndexedDB metadata/outbox, and the cloud Projects API mock to agree about the
// same project ids, revisions, manifests, and archive contents.

export const PROJECT_DIR = `/documents/${PROJECT_FOLDER}`
export const CLOUD_ENVIRONMENT = 'dev.zoo.dev'

export type ProjectFiles = Record<string, string>

export type CloudProject = {
  id: string
  title: string
  revision: string
  updatedAt?: string
  files: ProjectFiles
}

type RemoteListGate = ReturnType<typeof createRemoteListGate>

type ProjectRequest = {
  projectId: string
  url: string
  postData: string
}

type JsonRouteResponse = {
  status: number
  body: unknown
}

export function projectToml(title: string, cloudProjectId?: string) {
  // Keep test projects in the same metadata shape the app writes: root title
  // for display, and environment-scoped cloud id for cloud-backed projects.
  return [
    `title = ${JSON.stringify(title)}`,
    'default_file = "main.kcl"',
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

export async function zipProject(files: ProjectFiles) {
  const zip = new JSZip()
  for (const [relativePath, contents] of Object.entries(files)) {
    zip.file(relativePath, contents)
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

export async function projectTitles(page: Page) {
  return (await page.getByTestId('project-title').allTextContents()).map(
    (title: string) => title.trim()
  )
}

export function createRemoteListGate(initiallyReleased = false) {
  // Lets tests force Home to render local projects first, then release the
  // remote list later to assert that cloud sync does not replace the list.
  let released = initiallyReleased
  const waiters: Array<() => void> = []

  return {
    wait: () =>
      released
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push(resolve)),
    release: () => {
      released = true
      for (const resolve of waiters.splice(0)) {
        resolve()
      }
    },
    hold: () => {
      released = false
    },
  }
}

export function cloudProjectResponse(project: CloudProject) {
  return {
    id: project.id,
    title: project.title,
    revision: project.revision,
    ...(project.updatedAt ? { updated_at: project.updatedAt } : {}),
  }
}

export async function routeCloudProjects(
  context: BrowserContext,
  options: {
    remoteProjects: CloudProject[]
    listedProjects?: CloudProject[]
    remoteArchives?: Map<string, Buffer>
    remoteListGate?: RemoteListGate
    brokenArchiveProjectIds?: Iterable<string>
    createProject?: (postData: string) => CloudProject
    updateProject?: (request: ProjectRequest) => JsonRouteResponse | undefined
  }
) {
  // Mock the subset of the Projects API that cloud sync uses: remote listing,
  // project create/update metadata, and whole-project archive downloads.
  // Tests inspect `calls` to verify that local-first sync queued the expected
  // guarded cloud writes without relying on a real backend.
  const remoteArchives =
    options.remoteArchives ??
    new Map<string, Buffer>(
      await Promise.all(
        options.remoteProjects.map(
          async (project) =>
            [project.id, await zipProject(project.files)] as const
        )
      )
    )
  const remoteListGate = options.remoteListGate ?? createRemoteListGate(true)
  const listedProjects = options.listedProjects ?? options.remoteProjects
  const brokenArchiveProjectIds = new Set(options.brokenArchiveProjectIds ?? [])
  const calls = {
    creates: [] as string[],
    downloads: [] as string[],
    remoteListResponses: 0,
    updates: [] as ProjectRequest[],
  }

  await context.route('**/user/projects**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const projectId = pathname.match(/\/user\/projects\/([^/]+)/)?.[1]

    if (pathname === '/user/projects' && request.method() === 'GET') {
      await remoteListGate.wait()
      calls.remoteListResponses += 1
      await route
        .fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            listedProjects.map((project) => cloudProjectResponse(project))
          ),
        })
        .catch(() => undefined)
      return
    }

    if (pathname === '/user/projects' && request.method() === 'POST') {
      const postData = request.postData() || ''
      calls.creates.push(postData)
      await fulfillJson(
        route,
        options.createProject?.(postData) ?? {
          id: 'created-project',
          title: 'Created project',
          revision: 'created-rev-1',
          files: {},
        }
      )
      return
    }

    if (projectId && request.method() === 'PUT') {
      const updateRequest = {
        projectId,
        url: request.url(),
        postData: request.postData() || '',
      }
      calls.updates.push(updateRequest)
      const response = options.updateProject?.(updateRequest)
      if (response) {
        await fulfillJson(route, response.body, response.status)
        return
      }
    }

    if (projectId && pathname.endsWith('/download')) {
      calls.downloads.push(projectId)

      if (brokenArchiveProjectIds.has(projectId)) {
        await fulfillJson(route, { message: 'broken archive' }, 500)
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: remoteArchives.get(projectId),
      })
      return
    }

    const remoteProject = options.remoteProjects.find(
      (project) => project.id === projectId
    )
    if (remoteProject && request.method() === 'GET') {
      await fulfillJson(route, cloudProjectResponse(remoteProject))
      return
    }

    await fulfillJson(route, { message: 'not found' }, 404)
  })

  return {
    calls,
    gate: remoteListGate,
  }
}

export async function seedCloudSyncState(
  page: Page,
  seed: {
    projects: Array<{
      projectName: string
      files: ProjectFiles
    }>
    metadata?: Array<{
      projectName: string
      remoteProjectId: string
      remoteRevision: string
      baseFiles: ProjectFiles
    }>
    outbox?: Array<{
      projectName: string
      kind: 'upsert' | 'delete'
      targetRelativePath?: string
    }>
    projectDirectory?: string
  }
) {
  // Seed the browser-side local replica directly. OPFS holds project files,
  // IndexedDB holds the last accepted cloud base manifest/revision and durable
  // outbox entries. This gives tests precise clean, dirty, stale, and
  // local-only starting states without going through app UI setup.
  await page.evaluate(
    async ({ projectDirectory, projects, metadata, outbox }) => {
      const encoder = new TextEncoder()

      async function getDirectoryHandle(targetPath: string) {
        const root = await navigator.storage.getDirectory()
        let currentDirectory = root
        for (const part of targetPath.match(/[^/]+/g) ?? []) {
          currentDirectory = await currentDirectory.getDirectoryHandle(part, {
            create: true,
          })
        }
        return currentDirectory
      }

      async function writeFile(
        directory: FileSystemDirectoryHandle,
        relativePath: string,
        contents: string
      ) {
        const parts = relativePath.match(/[^/]+/g) ?? []
        let currentDirectory = directory
        for (const part of parts.slice(0, -1)) {
          currentDirectory = await currentDirectory.getDirectoryHandle(part, {
            create: true,
          })
        }
        const fileName = parts.at(-1)
        if (!fileName) {
          throw new Error('Cannot write an OPFS file without a file name.')
        }

        const file = await currentDirectory.getFileHandle(fileName, {
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
        const directory = await getDirectoryHandle(
          `${projectDirectory}/${projectName}`
        )
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

      for (const project of projects) {
        await writeProject(project.projectName, project.files)
      }

      const metadataEntries = await Promise.all(
        metadata.map(async (entry) => ({
          schemaVersion: 1,
          localProjectPath: `${projectDirectory}/${entry.projectName}`,
          projectName: entry.projectName,
          remoteProjectId: entry.remoteProjectId,
          remoteRevision: entry.remoteRevision,
          baseManifest: await manifest(entry.baseFiles),
          lastSyncedAt: new Date().toISOString(),
        }))
      )

      await transact('projects', 'readwrite', (store) => {
        for (const entry of metadataEntries) {
          store.put({
            ...entry,
          })
        }
      })

      await transact('outbox', 'readwrite', (store) => {
        for (const entry of outbox) {
          const projectPath = `${projectDirectory}/${entry.projectName}`
          const targetPath = entry.targetRelativePath
            ? `${projectPath}/${entry.targetRelativePath}`
            : projectPath
          store.add({
            projectPath,
            kind: entry.kind,
            targetPath,
            createdAt: new Date().toISOString(),
          })
        }
      })
    },
    {
      projectDirectory: seed.projectDirectory ?? PROJECT_DIR,
      projects: seed.projects,
      metadata: seed.metadata ?? [],
      outbox: seed.outbox ?? [],
    }
  )
}

export async function readOpfsTextFiles<T extends Record<string, string>>(
  page: Page,
  pathsByName: T
) {
  return page.evaluate(async (paths) => {
    const entries = await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [
        name,
        await window.fsZds.readFile(path, { encoding: 'utf-8' }),
      ])
    )
    return Object.fromEntries(entries)
  }, pathsByName) as Promise<Record<keyof T, string>>
}

export async function opfsPathExists(page: Page, path: string) {
  return page.evaluate(async (pathToCheck) => {
    try {
      await window.fsZds.stat(pathToCheck)
      return true
    } catch {
      return false
    }
  }, path)
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
