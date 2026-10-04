import { expect, test } from '@e2e/playwright/base-test'
import type { Route } from '@playwright/test'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import {
  cloudProjectResponse,
  projectToml,
  routeCloudProjects,
  zipProject,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import {
  mockClientErrorReports,
  openPane,
  setup,
} from '@e2e/playwright/test-utils'

const project = {
  id: '00000000-0000-4000-8000-000000013121',
  title: 'Linked project',
  revision: 'revision-1',
  files: {
    'main.kcl': '@settings(kclVersion = 2.0)\nlinkedValue = 17\n',
    'parts/other.kcl': '@settings(kclVersion = 2.0)\nnestedValue = 23\n',
    'project.toml': projectToml('Linked project'),
  },
}

test.beforeEach(async ({ context }) => {
  await mockClientErrorReports(context)
  await context.route('**/user', (route) =>
    route.fulfill({
      json: {
        id: '12945000-0000-4000-8000-000000000001',
        name: 'Playwright User',
        username: 'playwright',
        email: 'playwright@example.com',
        image: '',
        created_at: '2026-09-01T12:00:00Z',
        updated_at: '2026-09-01T12:00:00Z',
      },
    })
  )
})

const projectUrl = `/projects/${project.id}?file=parts%2Fother.kcl`

test(
  'keeps readers view-only and reopens the same link with edit access',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    let canEdit = false
    const { calls } = await routeCloudProjects(context, {
      remoteProjects: [project],
      listedProjects: [],
    })
    await context.route(`**/user/projects/${project.id}`, (route) =>
      route.request().method() !== 'GET'
        ? route.fallback()
        : route.fulfill({
            json: {
              ...cloudProjectResponse(project),
              entrypoint_path: 'main.kcl',
              access: { can_edit: canEdit },
            },
          })
    )
    await setup(context, page, testInfo, [], { cloudSyncEnabled: true })
    await page.goto(projectUrl)
    const editor = new EditorFixture(page)
    await editor.openPane()
    await editor.expectEditor.toContain('nestedValue = 23')
    await expect(page.getByTestId('view-only-indicator')).toBeVisible()
    const result = await page.evaluate(async () => {
      const { fileOperations, singletons } = window.app
      const manager = singletons.kclManager
      const before = manager.code
      manager.editorView.dispatch({
        changes: { from: 0, insert: 'edit = 1\n' },
      })
      const wroteFile = await fileOperations
        .writeFile(manager.path, 'edit = 1')
        .then(
          () => true,
          () => false
        )
      return { unchanged: manager.code === before, wroteFile }
    })
    expect(result).toEqual({ unchanged: true, wroteFile: false })
    expect(calls.updates).toHaveLength(0)

    await page.getByTestId('settings-link').click()
    await expect(page.getByRole('radio', { name: 'This project' })).toHaveCount(
      0
    )
    await page.getByRole('radio', { name: 'Keybindings' }).click()
    await page.getByTestId('settings-close-button').click()
    await expect(page).toHaveURL(new RegExp(projectUrl.replace('?', '\\?')))
    await page.reload()
    await editor.expectEditor.toContain('nestedValue = 23')

    await openPane(page, 'files-pane-button')
    await expect(page.getByTestId('create-file-button')).toBeDisabled()
    await expect(page.getByTestId('create-folder-button')).toBeDisabled()
    await page
      .getByTestId('file-tree-item')
      .filter({ hasText: /^main\.kcl$/ })
      .click()
    await editor.expectEditor.toContain('linkedValue = 17')
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
    await page.goBack()
    await editor.expectEditor.toContain('nestedValue = 23')

    const previousCache = await page.evaluate(() => window.app.project!.path)
    canEdit = true
    await page.goForward()
    await expect(page.getByTestId('view-only-indicator')).toHaveCount(0)
    await editor.expectEditor.toContain('linkedValue = 17')
    const writable = await page.evaluate(async (oldPath) => {
      const { fileOperations, singletons } = window.app
      const manager = singletons.kclManager
      manager.editorView.dispatch({
        changes: { from: manager.code.length, insert: '\nownerEdit = 42\n' },
      })
      await manager.flushWriteToFile()
      return {
        oldExists: await fileOperations.exists(oldPath),
        content: new TextDecoder().decode(
          await fileOperations.readFile(manager.path)
        ),
      }
    }, previousCache)
    expect(writable.oldExists).toBe(false)
    expect(writable.content).toContain('ownerEdit = 42')
    expect(calls.creates).toHaveLength(0)
  }
)

test(
  'requires sign-in for public links and loads updated publications on reload',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const { calls } = await routeCloudProjects(context, { remoteProjects: [] })
    await context.route(`**/user/projects/${project.id}`, (route) =>
      route.fulfill({ status: 403, json: { message: 'Forbidden' } })
    )
    let archive = await zipProject(project.files)
    let downloads = 0
    await context.route(`**/projects/public/${project.id}**`, (route) => {
      if (route.request().url().includes('/download')) {
        downloads++
        return route.fulfill({ contentType: 'application/zip', body: archive })
      }
      return route.fulfill({
        json: {
          id: project.id,
          title: project.title,
          published_at: '2026-10-01T00:00:00Z',
        },
      })
    })
    await setup(context, page, testInfo)
    const signedOut = (route: Route) =>
      route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
    await context.route('**/user', signedOut)
    await context.route('https://dev.zoo.dev/signin?**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>Sign in</p>' })
    )
    await page.goto(projectUrl)
    await expect(page).toHaveURL(/https:\/\/dev.zoo.dev\/signin\?/)
    const callback = new URL(page.url()).searchParams.get('callbackUrl')!
    expect(new URL(callback).pathname + new URL(callback).search).toBe(
      projectUrl
    )
    expect(downloads).toBe(0)
    await context.unroute('**/user', signedOut)
    await page.goto(callback)
    const editor = new EditorFixture(page)
    await editor.openPane()
    await editor.expectEditor.toContain('nestedValue = 23')
    await expect(page.getByTestId('view-only-indicator')).toBeVisible()

    archive = await zipProject({
      ...project.files,
      'parts/other.kcl': '@settings(kclVersion = 2.0)\nnestedValue = 24\n',
    })
    await page.reload()
    await editor.expectEditor.toContain('nestedValue = 24')
    expect(calls.creates).toHaveLength(0)
    expect(calls.updates).toHaveLength(0)
  }
)

test(
  'denied cloud URLs show an error without creating a project',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const { calls } = await routeCloudProjects(context, { remoteProjects: [] })
    await context.route(`**/user/projects/${project.id}`, (route) =>
      route.fulfill({ status: 403, json: { message: 'Forbidden' } })
    )
    await context.route(`**/projects/public/${project.id}`, (route) =>
      route.fulfill({ status: 404, json: { message: 'Project not found' } })
    )
    await setup(context, page, testInfo)
    await page.goto(`/projects/${project.id}`)
    await expect(
      page.getByRole('heading', { name: 'Unable to open project' })
    ).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Project not found')
    expect(calls.creates).toHaveLength(0)
  }
)
