import { mkdir, writeFile } from 'node:fs/promises'
import { expect } from '@e2e/playwright/base-test'
import { test } from '@e2e/playwright/fixtures/cloudSyncProjectFixture'
import {
  createProject,
  expectCloudFeatureEnabled,
  setup,
  token,
} from '@e2e/playwright/test-utils'
import type { CreatedRemoteProject } from '@src/lib/cloudSync/types'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

const apiUrl = 'https://api.dev.zoo.dev'
const headers = { Authorization: `Bearer ${token}` }
let createdProject: { id: string; title: string } | undefined
const evidence = {
  schemaVersion: 1,
  calibration: false,
  runStartedAtMs: Date.now(),
  fixtureSourceCommit: 'ebc1f257420be002935d02f26b5962d39a6248fa',
  testTimeoutMs: 0,
  successfulPostObserved: false,
  postStatus: 0,
  postAtTestBodyMs: 0,
  creationResponseCount: 0,
  validationWaitEntered: false,
  statusAfterFixtureTeardown: 0,
  readbackError: false,
  fallbackCleanupAttempted: false,
  fallbackDeleteStatus: 0,
  statusAfterFallback: 0,
}

test('cleans a held first upload after the original test deadline', async ({
  context,
  page,
  firstUploadProject,
}, testInfo) => {
  const started = performance.now()
  evidence.testTimeoutMs = testInfo.timeout
  expect(testInfo.timeout).toBe(120_000)
  await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
    cloudSyncEnabled: true,
  })
  await expectCloudFeatureEnabled(page)
  await page.getByPlaceholder(/^Search projects/).fill(firstUploadProject.name)
  await expect(page.getByTestId('project-link')).toHaveCount(0)
  await createProject({ name: firstUploadProject.name, page })
  await expect(page).toHaveURL(/\/file\/.*main\.kcl/, { timeout: 20_000 })

  const response = await firstUploadProject.firstUpload
  evidence.postStatus = response.status()
  expect(response.ok()).toBe(true)
  const created: CreatedRemoteProject = await response.json()
  createdProject = { id: created.id, title: firstUploadProject.name }
  evidence.successfulPostObserved = true
  evidence.postAtTestBodyMs = performance.now() - started
  evidence.creationResponseCount = firstUploadProject.createCount
  expect(created.id).toBeTruthy()
  expect(created.revision).toBeTruthy()
  expect(created.files.map((file) => file.relative_path)).toEqual(
    expect.arrayContaining(['main.kcl', 'project.toml'])
  )
  for (const file of created.files) {
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(file.byte_size).toBeGreaterThanOrEqual(0)
  }

  // Keep the real fixture's response hold pending until Playwright's original
  // test deadline. This unresolved wait deliberately cannot run test-body cleanup.
  evidence.validationWaitEntered = true
  await new Promise<void>(() => {})
})

test.afterAll(async ({ request }) => {
  // This hook gets its own request fixture after the test's resource teardown.
  // Keep project identity in memory; publish only normalized evidence below.
  try {
    if (createdProject) {
      const url = `${apiUrl}/user/projects/${createdProject.id}`
      const response = await request.get(url, { headers })
      evidence.statusAfterFixtureTeardown = response.status()
      if (response.status() === 200) {
        const actual: { id: string; title: string } = await response.json()
        if (
          actual.id === createdProject.id &&
          actual.title === createdProject.title
        ) {
          // A leftover resource still needs cleanup, but fallback cannot prove
          // the fixture worked and must never count as diagnostic success.
          evidence.fallbackCleanupAttempted = true
          evidence.fallbackDeleteStatus = (
            await request.delete(url, { headers })
          ).status()
          evidence.statusAfterFallback = (
            await request.get(url, { headers })
          ).status()
        }
      }
    }
  } catch {
    evidence.readbackError = true
  } finally {
    await mkdir('test-results/cloud-cleanup', { recursive: true })
    await writeFile(
      'test-results/cloud-cleanup/cleanup-receipt.json',
      JSON.stringify(evidence, null, 2)
    )
  }
  expect(evidence.successfulPostObserved).toBe(true)
  expect(evidence.validationWaitEntered).toBe(true)
  expect(evidence.readbackError).toBe(false)
  expect(evidence.statusAfterFixtureTeardown).toBe(404)
})
