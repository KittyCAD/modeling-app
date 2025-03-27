import fsp from 'fs/promises'
import { join } from 'path'

import { executorInputPath } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'When machine-api server not found butt is disabled and shows the reason',
  { tag: '@electron' },
  async ({ context, page, scene, cmdBar }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        join(bracketDir, 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await expect(page.getByText('bracket')).toBeVisible()

    await page.getByText('bracket').click()

    await scene.settled(cmdBar)

    const notFoundText = 'Machine API server was not discovered'
    await expect(page.getByText(notFoundText).first()).not.toBeVisible()

    // Find the make button
    const makeButton = page.getByRole('button', { name: 'Make part' })
    // Make sure the button is visible but disabled
    await expect(makeButton).toBeVisible()
    await expect(makeButton).toBeDisabled()

    // When you hover over the button, the tooltip should show
    // that the machine-api server is not found
    await makeButton.hover()
    await expect(page.getByText(notFoundText).first()).toBeVisible()
  }
)

test(
  'When machine-api server not found home screen & project status shows the reason',
  { tag: '@electron' },
  async ({ context, page, scene, cmdBar }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        join(bracketDir, 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    const notFoundText = 'Machine API server was not discovered'

    await expect(page.getByText(notFoundText)).not.toBeVisible()

    const networkMachineToggle = page.getByTestId('network-machine-toggle')
    await networkMachineToggle.hover()
    await expect(page.getByText(notFoundText)).toBeVisible()

    await expect(page.getByText('bracket')).toBeVisible()

    await page.getByText('bracket').click()

    await scene.settled(cmdBar)

    await expect(page.getByText(notFoundText).nth(1)).not.toBeVisible()

    await networkMachineToggle.hover()
    await expect(page.getByText(notFoundText).nth(1)).toBeVisible()
  }
)
