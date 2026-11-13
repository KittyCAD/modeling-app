import { randomUUID } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'
import {
  cloudProjectResponse,
  projectToml,
  zipProject,
  type CloudProject,
} from '@e2e/playwright/lib/cloudProjectTestUtils'

const projectId = '12902000-0000-4000-8000-000000000091'
const mockedModelingContexts = new WeakSet<BrowserContext>()

export async function uploadedProject(route: Route) {
  const request = route.request()
  const body = request.postDataBuffer()
  if (!body) throw new Error('Missing upload body')
  const form = await new Request(request.url(), {
    method: 'POST',
    headers: request.headers(),
    body: new Uint8Array(body).buffer,
  }).formData()
  const files: Record<string, string> = {}
  for (const [name, value] of form.entries()) {
    if (name !== 'body' && typeof value !== 'string') {
      files[name] = await value.text()
    }
  }
  const metadataPart = form.get('body')
  if (!(metadataPart instanceof Blob))
    throw new Error('Missing upload metadata')
  const metadata = JSON.parse(await metadataPart.text()) as {
    title: string
    expected_revision?: string
    deleted_paths?: string[]
  }
  return { title: metadata.title, files, metadata }
}

export async function mockCloudStorage(
  context: BrowserContext,
  {
    additionalProjects = [],
    mockModeling = true,
    startEmpty = false,
    beforeCreate,
  }: {
    additionalProjects?: CloudProject[]
    mockModeling?: boolean
    startEmpty?: boolean
    beforeCreate?: () => Promise<void>
  } = {}
) {
  if (context.browser()?.browserType().name() === 'webkit') {
    await context.addInitScript(() => {
      const fetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const request = new Request(
          input instanceof Request ? input.clone() : input,
          init
        )
        if (
          /\/user\/projects(?:\/[^/]+)?\/?$/.test(
            new URL(request.url).pathname
          ) &&
          ['POST', 'PUT'].includes(request.method) &&
          request.headers.get('content-type')?.startsWith('multipart/form-data')
        ) {
          // WebKit's request interception omits Blob parts; preserve their encoded bytes.
          const body = await request.clone().arrayBuffer()
          return fetch(new Request(request, { body }))
        }
        return fetch(input, init)
      }
    })
  }
  if (mockModeling) {
    await context.routeWebSocket('**/ws/modeling/commands**', () => {})
    mockedModelingContexts.add(context)
  } else if (mockedModelingContexts.has(context)) {
    // Electron reuses its context; a prior mock must not block real modeling.
    await context.routeWebSocket('**/ws/modeling/commands**', (socket) => {
      socket.connectToServer()
    })
    mockedModelingContexts.delete(context)
  }
  const project: CloudProject = {
    id: projectId,
    title: 'Cloud memory model',
    revision: '1',
    files: {
      'main.kcl': '@settings(kclVersion = 3.0)\n',
      'parts/note.md': 'original',
      'project.toml': projectToml('Cloud memory model'),
    },
  }
  const projects = startEmpty ? [] : [project, ...additionalProjects]
  const creates: CloudProject[] = []
  const uploads: string[] = []
  const downloads: string[] = []
  const deletions: { parentRevision: string; paths: string[] }[] = []
  const reads = { metadata: 0, downloads: 0 }
  await context.route('**/user', (route) =>
    route.fulfill({
      json: {
        id: '12902000-0000-4000-8000-000000000001',
        username: 'playwright',
        name: 'Playwright',
        email: 'playwright@example.com',
        image: '',
        created_at: '2026-09-01T12:00:00Z',
        updated_at: '2026-09-01T12:00:00Z',
      },
    })
  )
  await context.route('**/user/projects**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const requestedProject = projects.find((entry) =>
      url.pathname.startsWith(`/user/projects/${entry.id}`)
    )
    if (url.pathname === '/user/projects' && request.method() === 'POST') {
      const upload = await uploadedProject(route)
      const created: CloudProject = {
        id: randomUUID(),
        revision: '1',
        ...upload,
      }
      creates.push(created)
      await beforeCreate?.()
      projects.push(created)
      return route.fulfill({ status: 201, json: cloudProjectResponse(created) })
    }
    if (url.pathname === '/user/projects')
      return route.fulfill({
        json: { items: projects.map(cloudProjectResponse), next_page: null },
      })
    if (!requestedProject) return route.fulfill({ status: 404 })
    if (url.pathname.endsWith('/thumbnail'))
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/1sAAAAASUVORK5CYII=',
          'base64'
        ),
      })
    if (url.pathname.endsWith('/download')) {
      reads.downloads += 1
      downloads.push(requestedProject.id)
      return route.fulfill({
        contentType: 'application/zip',
        body: await zipProject(requestedProject.files),
      })
    }
    if (request.method() === 'PUT') {
      const upload = await uploadedProject(route)
      uploads.push(upload.metadata.expected_revision ?? '')
      if (upload.metadata.expected_revision !== requestedProject.revision)
        return route.fulfill({
          status: 409,
          json: { message: 'Revision changed' },
        })
      if (upload.metadata.deleted_paths?.length)
        deletions.push({
          parentRevision: requestedProject.revision,
          paths: upload.metadata.deleted_paths,
        })
      requestedProject.files = upload.files
      requestedProject.title = upload.title
      requestedProject.revision = String(Number(requestedProject.revision) + 1)
    }
    if (request.method() === 'DELETE') {
      projects.splice(projects.indexOf(requestedProject), 1)
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'GET') reads.metadata += 1
    return route.fulfill({ json: cloudProjectResponse(requestedProject) })
  })
  return { project, projects, uploads, creates, downloads, reads, deletions }
}
