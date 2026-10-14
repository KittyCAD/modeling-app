import { expect, test } from '@e2e/playwright/base-test'
import { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import {
  cloudProjectResponse,
  projectToml,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import { readFileSync } from 'node:fs'

const project = {
  id: '00000000-0000-4000-8000-000000013122',
  title: 'Linked project',
  revision: 'revision-1',
  files: {
    'main.kcl': readFileSync('public/kcl-samples/box/main.kcl', 'utf8'),
    'parts/other.kcl': '@settings(kclVersion = 3.0)\nnestedValue = 23\n',
    'project.toml': projectToml(
      'Linked project',
      '00000000-0000-4000-8000-000000013122'
    ),
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

test(
  'shares the cloud URL from the header, project menu, and command palette',
  { tag: '@web' },
  async ({ context, page, baseURL }, testInfo) => {
    const { calls } = await routeCloudProjects(context, {
      remoteProjects: [project],
      listedProjects: [],
    })
    await context.route(`**/user/projects/${project.id}`, (route) =>
      route.fulfill({
        json: { ...cloudProjectResponse(project), access: { can_edit: false } },
      })
    )
    await setup(context, page, testInfo, [], { cloudSyncEnabled: true })
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(`/project/${project.id}`)
    await expect(page.getByTestId('view-only-indicator')).toBeVisible()
    await expect(page.getByTestId('duplicate-project-to-edit')).toBeVisible()
    await page.getByTestId('share-project-button').click()
    const dialog = page.getByRole('dialog', { name: 'Share project' })
    const url = new URL(`/project/${project.id}?file=main.kcl`, baseURL).href
    await expect(dialog.getByLabel('Project link')).toHaveValue(url)
    await dialog.getByRole('button', { name: 'Copy link' }).click()
    await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)
    await dialog.getByRole('button', { name: 'Done' }).click()

    await page.getByTestId('project-sidebar-toggle').click()
    await expect(
      page.getByTestId('project-sidebar-open-in-desktop')
    ).toBeVisible()
    await page.getByTestId('project-sidebar-share').click()
    await expect(dialog.getByLabel('Project link')).toHaveValue(url)
    await page.keyboard.press('Escape')
    const commands = new CmdBarFixture(page)
    await commands.openCmdBar()
    await commands.cmdSearchInput.fill('Share project')
    await commands.chooseCommand('Share project')
    await expect(dialog.getByLabel('Project link')).toHaveValue(url)
    expect(calls.creates).toHaveLength(0)
    expect(calls.updates).toHaveLength(0)
  }
)

test(
  'duplicates a view-only project into a writable library and opens the selected file',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const { calls } = await routeCloudProjects(context, {
      remoteProjects: [project],
      listedProjects: [],
    })
    await context.route(`**/user/projects/${project.id}`, (route) =>
      route.fulfill({
        json: { ...cloudProjectResponse(project), access: { can_edit: false } },
      })
    )
    await setup(context, page, testInfo, [], { cloudSyncEnabled: true })
    await page.goto(`/project/${project.id}?file=parts%2Fother.kcl`)
    const editor = new EditorFixture(page)
    await editor.openPane()
    await editor.expectEditor.toContain('nestedValue = 23')
    const originalPath = await page.evaluate(() => window.app.project!.path)
    await page.getByTestId('duplicate-project-to-edit').click()
    await expect(page.getByTestId('view-only-indicator')).toHaveCount(0)
    await editor.expectEditor.toContain('nestedValue = 23')
    await expect(page).toHaveURL(/\/file\//)
    const copy = await page.evaluate(async () => {
      const { project: current, fileOperations, singletons } = window.app
      const manager = singletons.kclManager
      manager.editorView.dispatch({
        changes: { from: manager.code.length, insert: '\ncopyEdit = 42\n' },
      })
      await manager.flushWriteToFile()
      return {
        path: current!.path,
        content: new TextDecoder().decode(
          await fileOperations.readFile(manager.path)
        ),
        settings: new TextDecoder().decode(
          await fileOperations.readFile(`${current!.path}/project.toml`)
        ),
      }
    })
    expect(copy.path).not.toBe(originalPath)
    expect(copy.settings).not.toContain(project.id)
    expect(copy.content).toContain('copyEdit = 42')
    expect(
      calls.updates.some(({ projectId }) => projectId === project.id)
    ).toBe(false)
    await expect
      .poll(() =>
        page.evaluate(
          (path) => window.app.fileOperations.exists(path),
          originalPath
        )
      )
      .toBe(false)
  }
)
