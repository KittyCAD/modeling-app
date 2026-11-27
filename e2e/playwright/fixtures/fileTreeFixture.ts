import { editorSelector } from '@e2e/playwright/lib/editorSupport'
import { closeFilePanel, openFilePanel } from '@e2e/playwright/lib/paneSupport'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
export class FileTreeFixture {
  createFileBtn: Locator
  treeInputField: Locator
  fileCreateToast: Locator
  constructor(private readonly page: Page) {
    this.createFileBtn = page.getByTestId('create-file-button')
    this.treeInputField = page.getByTestId('file-rename-field')
    this.fileCreateToast = page.getByText('Successfully created')
  }
  openPane = () => openFilePanel(this.page)

  closePane = () => closeFilePanel(this.page)

  createFileAndWaitForNavigation = async (name: string) => {
    return test?.step(`Create a file named ${name}`, async () => {
      await this.page.getByTestId('create-file-button').click()
      await this.page.getByTestId('file-rename-field').fill(name)
      await this.page.keyboard.press('Enter')
      await expect
        .poll(() =>
          this.page.evaluate((name) => {
            const current = window.app.project?.executingPath
            const basename = current ? window.fsZds.basename(current) : ''
            return basename === name || basename === `${name}.kcl`
          }, name)
        )
        .toBe(true)
      await expect(this.page.locator(editorSelector)).toBeEditable()
    })
  }

  createFolder = async (name: string) => {
    return test?.step(`Create a folder named ${name}`, async () => {
      await this.page.getByTestId('create-folder-button').click()
      await this.page.getByTestId('file-rename-field').fill(name)
      await this.page.keyboard.press('Enter')
    })
  }

  selectFile = async (name: string) => {
    return test?.step(`Select ${name}`, async () => {
      await this.page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: name })
        .click()
      await expect(
        this.page.getByTestId('project-sidebar-toggle')
      ).toContainText(name)
    })
  }

  renameFile = async (fromName: string, toName: string) => {
    return test?.step(`Rename ${fromName} to ${toName}`, async () => {
      await this.page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: fromName })
        .click({ button: 'right' })
      await this.page.getByTestId('context-menu-rename').click()
      await this.page.getByTestId('file-rename-field').fill(toName)
      await this.page.keyboard.press('Enter')
      await this.page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: toName })
        .click()
    })
  }

  deleteFile = async (name: string) => {
    return test?.step(`Delete ${name}`, async () => {
      await this.page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: name })
        .click({ button: 'right' })
      await this.page.getByTestId('context-menu-delete').click()
      await this.page.getByTestId('delete-confirmation').click()
    })
  }

  file = (name: string) => {
    return this.page
      .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
      .filter({ hasText: name })
  }

  folder = (name: string) => {
    return this.page
      .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
      .filter({ hasText: name })
  }

  private _serialiseFileTree = async () => {
    return this.page
      .locator('#files-pane')
      .getByTestId('file-tree-item')
      .allInnerTexts()
  }

  /**
   * TODO folders, in expect state
   */
  expectFileTreeState = async (expected: string[]) => {
    await expect.poll(this._serialiseFileTree).toEqual(expected)
  }

  createFile = async (args: {
    fileName: string
    waitForToastToDisappear: boolean
  }) => {
    await this.createFileBtn.click()
    await this.treeInputField.fill(args.fileName)
    await this.treeInputField.press('Enter')
    await expect(this.fileCreateToast).toBeVisible()
    if (args.waitForToastToDisappear) {
      await this.fileCreateToast.waitFor({ state: 'detached' })
    }
  }

  /**
   * Opens file by it's name
   */
  openFile = async (fileName: string) => {
    const fileTreeItem = this.page
      .getByTestId('file-pane-scroll-container')
      .getByRole('treeitem', { name: fileName, exact: true })
    await expect(fileTreeItem).toBeVisible()
    await fileTreeItem.click()
  }

  ensureFolderOpen = async (folder: Locator, open: boolean) => {
    const expanded = await folder.getAttribute('aria-expanded')
    const isOpen = expanded === 'true'
    if (isOpen !== open) {
      await folder.click()
    }
  }
}
