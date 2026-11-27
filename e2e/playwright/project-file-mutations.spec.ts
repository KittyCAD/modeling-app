import { test as browserTest, expect } from '@e2e/playwright/base-test'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import { FileTreeFixture } from '@e2e/playwright/fixtures/fileTreeFixture'
import { prepareStorage } from '@e2e/playwright/lib/projectStorageFixture'
import { test as appTest } from '@e2e/playwright/zoo-test'

const web = process.env.TARGET === 'web'
const storageBrowserTest = browserTest.extend<{
  editor: EditorFixture
  fileTree: FileTreeFixture
}>({
  editor: async ({ page }, provide) => {
    await provide(new EditorFixture(page))
  },
  fileTree: async ({ page }, provide) => {
    await provide(new FileTreeFixture(page))
  },
})
const test = web ? storageBrowserTest : appTest

const code = '@settings(kclVersion = 3.0)\nvalue = 100\n'

const storageKinds = web ? (['cloud'] as const) : (['local', 'cloud'] as const)

for (const backing of storageKinds) {
  test(
    `file creation, sibling rename, and open-file moves preserve edits (${backing})`,
    { tag: backing === 'local' ? '@desktop' : ['@web', '@desktop'] },
    async (
      { context, page, fileTree: fileTreeFixture, editor: editorFixture },
      testInfo
    ) => {
      const storage = await prepareStorage(backing, page, context, testInfo)
      const root = await storage.seedAndOpen('Mutation test', code, {
        'parts/component.kcl': code,
        'parts-extra/live.kcl': code,
      })
      await page.locator('.cm-content').first().waitFor({ state: 'visible' })

      await fileTreeFixture.openPane()
      await editorFixture.openPaneAndRevealCode()
      await expect(page.locator('.cm-content').first()).toContainText(
        'value = 100'
      )
      const tree = page.getByTestId('file-pane-scroll-container')
      const row = (name: string) =>
        tree.getByRole('treeitem', { name, exact: true })
      const waitForExplorerReady = async () => {
        await expect(tree.getByRole('treeitem').first()).toHaveAttribute(
          'aria-disabled',
          'false',
          { timeout: 30_000 }
        )
      }
      const finishNamingEntry = async (name: string) => {
        const field = page.getByTestId('file-rename-field')
        await field.fill(name)
        await field.press('Enter')
        await expect(field).toBeHidden()
        // Rows can appear before the mutation and project refresh finish.
        await waitForExplorerReady()
      }
      const read = (name: string) => storage.read(root, name)

      await test.step('a filename collision allocates a sibling without replacing bytes', async () => {
        await page.getByTestId('create-file-button').click()
        await finishNamingEntry('main')
        await expect(page).toHaveURL(/main-1\.kcl$/)
        expect(await read('main.kcl')).toBe(code)
        await expect(row('main.kcl')).toBeVisible()
      })
      await row('parts-extra').click()
      await row('live.kcl').click()
      await expect(page).toHaveURL(/live\.kcl$/)
      await test.step('renaming a sibling prefix leaves the active file in place', async () => {
        const activeUrl = page.url()
        await row('parts').click({ button: 'right' })
        await page.getByRole('button', { name: 'Rename', exact: true }).click()
        await finishNamingEntry('components')
        await expect(row('components')).toBeVisible()
        await expect(page).toHaveURL(activeUrl)
      })
      await test.step('moving an open file keeps subsequent edits durable', async () => {
        await row('live.kcl').dragTo(row('components'))
        await waitForExplorerReady()
        await expect(page).toHaveURL(
          new RegExp(
            encodeURIComponent(
              await storage.fs.join(root, 'components', 'live.kcl')
            )
          )
        )
        const editor = page.locator('.cm-content').first()
        await editor.click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.insertText('\n// saved after moving\n')
        await expect
          .poll(() => read('components/live.kcl'))
          .toContain('saved after moving')
        await page.reload()
        await editor.waitFor({ state: 'visible' })
        await expect(editor).toContainText('saved after moving')
      })
      await test.step('an empty folder survives reloading either backing', async () => {
        await page.getByTestId('create-folder-button').click()
        await finishNamingEntry('empty-folder')
        await expect(row('empty-folder')).toBeVisible()
        if (backing === 'cloud')
          await expect
            .poll(
              () => storage.remote.projects[0].files['.zoo-directories.json']
            )
            .toContain('empty-folder')
        await page.reload()
        await row('empty-folder').waitFor({ state: 'visible' })
      })
      await test.step('moving the entrypoint updates its durable metadata', async () => {
        await row('main.kcl').click()
        await expect(page).toHaveURL(/main\.kcl$/)
        await row('main.kcl').dragTo(row('components'))
        await waitForExplorerReady()
        const movedEntrypoint = new RegExp(
          encodeURIComponent(
            await storage.fs.join(root, 'components', 'main.kcl')
          )
        )
        await expect(page).toHaveURL(movedEntrypoint)
        await expect
          .poll(() => read('project.toml'))
          .toContain('default_file = "components/main.kcl"')
        await page.reload()
        await expect(page).toHaveURL(movedEntrypoint)
        await page.locator('.cm-content').first().waitFor({ state: 'visible' })
        await expect(page.locator('.cm-content').first()).toContainText(
          'value = 100'
        )
      })
    }
  )
}
