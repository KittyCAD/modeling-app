import { createProject } from '@e2e/playwright/test-utils'
import { test } from '@e2e/playwright/zoo-test'

test.describe('Stress test', () => {
  test('Create project and load stress test', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'stress-test-project'
    // Create and load project
    await createProject({ name: projectName, page })
    await scene.settled(cmdBar)
  })
})
