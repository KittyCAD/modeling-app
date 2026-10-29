import { expect, test } from '@e2e/playwright/base-test'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import {
  cloudProjectResponse,
  projectToml,
  zipProject,
  type CloudProject,
} from '@e2e/playwright/lib/cloudProjectTestUtils'
import type { BrowserContext } from '@playwright/test'

const projectId = '12902000-0000-4000-8000-000000000091'

async function mockCloud(context: BrowserContext) {
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
  const uploads: string[] = []
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
    if (url.pathname === '/user/projects')
      return route.fulfill({
        json: { items: [cloudProjectResponse(project)], next_page: null },
      })
    if (url.pathname.endsWith('/download'))
      return route.fulfill({
        contentType: 'application/zip',
        body: await zipProject(project.files),
      })
    if (request.method() === 'PUT') {
      uploads.push(url.searchParams.get('expected_revision') ?? '')
      if (url.searchParams.get('expected_revision') !== project.revision)
        return route.fulfill({
          status: 409,
          json: { message: 'Revision changed' },
        })
      const body = request.postDataBuffer()
      if (!body) throw new Error('Missing upload body')
      const form = await new Request(request.url(), {
        method: 'POST',
        headers: request.headers(),
        body: new Uint8Array(body).buffer,
      }).formData()
      const files: Record<string, string> = {}
      for (const [name, value] of form.entries()) {
        if (name !== 'body' && typeof value !== 'string')
          files[name] = await value.text()
      }
      project.files = files
      project.revision = String(Number(project.revision) + 1)
    }
    return route.fulfill({ json: cloudProjectResponse(project) })
  })
  return { project, uploads }
}

test(
  'opens, saves, and reloads cloud files without modifying a historical disk mirror',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    test.setTimeout(180_000)
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    await setup(context, page, testInfo)
    await page.goto('/home')
    await page.evaluate(async (id) => {
      const root = '/documents/legacy-cloud-mirror'
      await window.fsZds.mkdir(root, { recursive: true })
      await window.fsZds.writeFile(
        `${root}/main.kcl`,
        new TextEncoder().encode('unsynced legacy edit')
      )
      await window.fsZds.writeFile(
        `${root}/project.toml`,
        new TextEncoder().encode(
          `title = "Legacy mirror"\n[cloud."dev.zoo.dev"]\nproject_id = "${id}"\n`
        )
      )
    }, projectId)
    await page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .click()
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    const root = `/__zoo_cloud__/${projectId}`
    await page.evaluate(async (root) => {
      await window.app.fileOperations.writeFile(
        `${root}/parts/note.md`,
        'saved cloud edit'
      )
    }, root)
    expect(remote.project.files['parts/note.md']).toBe('saved cloud edit')
    expect(remote.uploads).toContain('1')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    await expect
      .poll(
        () =>
          page.evaluate(async (root) => {
            const path = `${root}/parts/note.md`
            if (!(await window.app.fileOperations.exists(path))) return null
            return new TextDecoder().decode(
              await window.app.fileOperations.readFile(path)
            )
          }, root),
        { timeout: 30_000 }
      )
      .toBe('saved cloud edit')
    expect(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.fsZds.readFile('/documents/legacy-cloud-mirror/main.kcl')
        )
      )
    ).toBe('unsynced legacy edit')
    expect(
      await page.evaluate(async (root) => {
        try {
          await window.fsZds.stat(root)
          return true
        } catch {
          return false
        }
      }, root)
    ).toBe(false)
  }
)
