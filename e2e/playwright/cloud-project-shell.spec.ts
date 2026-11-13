import { expect, test } from '@e2e/playwright/base-test'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'

const id = '12902000-0000-4000-8000-000000000091'
const local = '@settings(kclVersion = 3.0)\nlength = 10\n'
const remote = '@settings(kclVersion = 3.0)\nlength = 20\n'

test(
  'automatically saves cloud edits and adopts the remote version after a conflicting write',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const storage = await mockCloudStorage(context)
    await setup(context, page, testInfo, ['zds_project_shell_refactor'])
    await page.goto('/home')
    await page
      .getByTestId('project-link')
      .filter({ hasText: 'Cloud memory model' })
      .click({ modifiers: ['Shift'] })
    await expect(page).toHaveURL(new RegExp(`/project/${id}$`))
    const code = page
      .getByRole('main', { name: 'Editor views' })
      .locator('.cm-content')
      .first()
    await code.fill(local)
    await expect.poll(() => storage.project.files['main.kcl']).toBe(local)
    await expect(
      page.getByRole('img', { name: 'Unsaved changes' })
    ).toHaveCount(0)

    // The local mount still has the last acknowledged revision when this edit starts.
    storage.project.files['main.kcl'] = remote
    storage.project.revision = '3'
    await code.fill('@settings(kclVersion = 3.0)\nlength = 15\n')
    await expect(code).toContainText('length = 20')
    await expect(
      page.getByRole('img', { name: 'Unsaved changes' })
    ).toHaveCount(0)
    expect(storage.project.files['main.kcl']).toBe(remote)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(
      page
        .getByRole('main', { name: 'Editor views' })
        .locator('.cm-content')
        .first()
    ).toContainText('length = 20')
  }
)

test(
  'makes cloud editors read-only offline and saves pending edits after reconnecting',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const storage = await mockCloudStorage(context)
    await setup(context, page, testInfo, ['zds_project_shell_refactor'])
    await page.goto(`/project/${id}`)
    const code = page
      .getByRole('main', { name: 'Editor views' })
      .locator('.cm-content')
      .first()
    await code.fill(local)
    await context.setOffline(true)
    await expect(page.getByRole('banner').getByRole('status')).toHaveText(
      'Offline'
    )
    await expect(
      page.getByRole('tab').filter({ hasText: 'main.kcl' })
    ).toContainText('Read-only')
    await expect(code).toHaveAttribute('contenteditable', 'false')
    await code.click()
    await page.keyboard.type('blocked edit')
    await expect(code).toContainText('length = 10')
    await expect(code).not.toContainText('blocked edit')
    await context.setOffline(false)
    await expect(code).toHaveAttribute('contenteditable', 'true')
    await expect(
      page.getByRole('tab').filter({ hasText: 'main.kcl' })
    ).not.toContainText('Read-only')
    await expect(
      page.getByRole('banner').getByText('Offline', { exact: true })
    ).toHaveCount(0)
    await expect.poll(() => storage.project.files['main.kcl']).toBe(local)
    await expect(
      page.getByRole('img', { name: 'Unsaved changes' })
    ).toHaveCount(0)
  }
)
