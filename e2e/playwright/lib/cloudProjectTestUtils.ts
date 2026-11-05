import { createHash } from 'node:crypto'
import type { BrowserContext, Page, Route } from '@playwright/test'
import JSZip from 'jszip'

// Shared Projects API responses and archives for cloud storage scenarios.
export const CLOUD_ENVIRONMENT = 'dev.zoo.dev'

export type ProjectFiles = Record<string, string>

export type CloudProject = {
  id: string
  title: string
  description?: string
  categoryIds?: string[]
  revision: string
  updatedAt?: string
  publicationStatus?: string
  submittedAt?: string
  publishedAt?: string
  feedback?: string
  files: ProjectFiles
}

type MaybePromise<T> = T | Promise<T>

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
  // remote list later to verify that local entries remain visible.
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
    description: project.description ?? '',
    category_ids: project.categoryIds ?? [],
    revision: project.revision,
    files: Object.entries(project.files).map(([relative_path, contents]) => ({
      relative_path,
      byte_size: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
    })),
    updated_at: project.updatedAt ?? '2026-09-01T12:00:00.000Z',
    publication_status: project.publicationStatus ?? 'private',
    publication: {
      submitted_at: project.submittedAt,
      last_published_at: project.publishedAt,
      feedback: project.feedback,
    },
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
    createProject?: (postData: string) => MaybePromise<CloudProject>
    updateProject?: (
      request: ProjectRequest
    ) => MaybePromise<JsonRouteResponse | undefined>
    publishProject?: (
      projectId: string
    ) => MaybePromise<JsonRouteResponse | undefined>
  }
) {
  // Mock listing, publication, guarded writes, and archive downloads.
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
    publishes: [] as string[],
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
      const createdProject = await options.createProject?.(postData)
      await fulfillJson(
        route,
        cloudProjectResponse(
          createdProject ?? {
            id: 'created-project',
            title: 'Created project',
            revision: 'created-rev-1',
            files: {},
          }
        )
      )
      return
    }

    if (
      projectId &&
      pathname.endsWith('/publish') &&
      request.method() === 'POST'
    ) {
      calls.publishes.push(projectId)
      const response = await options.publishProject?.(projectId)
      await fulfillJson(
        route,
        response?.body ?? {
          id: projectId,
          publication_status: 'pending_review',
        },
        response?.status ?? 200
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
      const response = await options.updateProject?.(updateRequest)
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

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
