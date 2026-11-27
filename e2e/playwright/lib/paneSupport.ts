import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export type PaneId = 'variables' | 'code' | 'files' | 'logs'

export async function checkIfPaneIsOpen(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  return (await paneButtonLocator?.getAttribute('aria-pressed')) === 'true'
}

export async function openPane(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  const isOpen = await checkIfPaneIsOpen(page, testId)

  if (!isOpen) {
    await paneButtonLocator.click()
  }
  await expect(paneButtonLocator).toHaveAttribute('aria-pressed', 'true')
}

export async function closePane(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  const isOpen = await checkIfPaneIsOpen(page, testId)

  if (isOpen) {
    await paneButtonLocator.click()
  }
  await expect(paneButtonLocator).toHaveAttribute('aria-pressed', 'false')
}

export async function openFilePanel(page: Page) {
  await openPane(page, 'files-pane-button')
}

export async function closeFilePanel(page: Page) {
  const fileLocator = page.getByTestId('files-pane-button')
  await expect(fileLocator).toBeVisible()
  const isOpen = (await fileLocator?.getAttribute('aria-pressed')) === 'true'
  if (isOpen) {
    await fileLocator.click()
    await expect(fileLocator).not.toHaveAttribute('aria-pressed', 'true')
  }
}

export async function openVariablesPane(page: Page) {
  await openPane(page, 'variables-pane-button')
}

export async function openLogsPane(page: Page) {
  await openPane(page, 'logs-pane-button')
}
