import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { OutputFormat3d } from '@kittycad/lib'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import fsp from 'fs/promises'
import path from 'path'

const PLAYWRIGHT_DOWNLOAD_DIR = 'downloads-during-playwright'

export const getPlaywrightDownloadDir = (rootDir: string) => {
  return path.resolve(rootDir, PLAYWRIGHT_DOWNLOAD_DIR)
}

const moveDownloadedFileTo = async (rootDir: string, toLocation: string) => {
  await fsp.mkdir(path.dirname(toLocation), { recursive: true })

  const downloadDir = getPlaywrightDownloadDir(rootDir)

  // Expect there to be at least one file
  await expect
    .poll(async () => {
      const files = await fsp.readdir(downloadDir)
      return files.length
    })
    .toBeGreaterThan(0)

  // Go through the downloads dir and move files to new location
  const files = await fsp.readdir(downloadDir)

  // Assumption: only ever one file here.
  for (let file of files) {
    await fsp.rename(path.resolve(downloadDir, file), toLocation)
  }
}

export interface Paths {
  modelPath: string
  imagePath: string
  outputType: string
}

export const doExport = async (
  output: OutputFormat3d,
  rootDir: string,
  page: Page,
  cmdBar: CmdBarFixture,
  testInfo: TestInfo,
  exportFrom: 'dropdown' | 'sidebarButton' | 'commandBar' = 'dropdown'
): Promise<Paths> => {
  const relPathToSpec = path.relative(testInfo.project.testDir, testInfo.file)
  const specSubdir = path.dirname(relPathToSpec)
  const snapshotsDirName = `${path.basename(testInfo.file)}-snapshots`
  const exportFolder =
    specSubdir === '.' || specSubdir === ''
      ? path.join(testInfo.project.testDir, snapshotsDirName)
      : path.join(testInfo.project.testDir, specSubdir, snapshotsDirName)
  if (exportFrom === 'dropdown') {
    await page.getByTestId('project-sidebar-toggle').click()

    const exportMenuButton = page
      .getByTestId('project-sidebar-menu')
      .getByText('Export 3D model', { exact: true })
    await expect(exportMenuButton).toBeVisible()
    await exportMenuButton.click()
  } else if (exportFrom === 'sidebarButton') {
    await expect(page.getByTestId('export-pane-button')).toBeVisible()
    await page.getByTestId('export-pane-button').click()
  } else if (exportFrom === 'commandBar') {
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const exportCommand = cmdBar.cmdOptions.getByText('Export 3D model', {
      exact: true,
    })
    await expect(exportCommand).toBeVisible()
    await exportCommand.click()
  }
  await expect(page.getByTestId('command-bar')).toBeVisible()

  // Go through export via command bar
  await page.getByRole('option', { name: output.type, exact: false }).click()
  await page.locator('#arg-form').waitFor({ state: 'detached' })
  if ('storage' in output) {
    await page.getByTestId('arg-name-storage').waitFor({ timeout: 1000 })
    await page.getByRole('button', { name: 'storage', exact: false }).click()
    await page
      .getByRole('option', { name: output.storage, exact: false })
      .click()
    await page.locator('#arg-form').waitFor({ state: 'detached' })
  }
  await cmdBar.submit()

  await expect(page.getByText('Exported successfully')).toBeVisible()

  if (exportFrom === 'sidebarButton' || exportFrom === 'commandBar') {
    return {
      modelPath: '',
      imagePath: '',
      outputType: output.type,
    }
  }

  // Handle download
  const downloadLocationer = (extra = '', isImage = false) =>
    path.join(
      exportFolder,
      `${output.type}-${'storage' in output ? output.storage : ''}${extra}.${
        isImage ? 'png' : output.type
      }`
    )
  const downloadLocation = downloadLocationer()

  if (output.type === 'step') {
    // stable timestamps for step files
    const fileContents = await fsp.readFile(downloadLocation, 'utf-8')
    const newFileContents = fileContents.replace(
      /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+[0-9]+[0-9]\+[0-9]{2}:[0-9]{2}/g,
      '1970-01-01T00:00:00.0+00:00'
    )
    await fsp.writeFile(downloadLocation, newFileContents)
  } else {
    // By default all files are downloaded to the same place in playwright
    // (declared in src/lib/exportSave)
    // To remain consistent with our old web tests, we want to move some downloads
    // (images) to another directory.
    await moveDownloadedFileTo(rootDir, downloadLocation)
  }

  return {
    modelPath: downloadLocation,
    imagePath: downloadLocationer('', true),
    outputType: output.type,
  }
}
