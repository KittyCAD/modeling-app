import { randomUUID } from 'node:crypto'
import { expect, test } from '@e2e/playwright/base-test'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import {
  PROJECT_DIR,
  readCloudSyncProjectMetadata,
  readOpfsTextFiles,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { installCloudTimingDiagnostic } from '@e2e/playwright/lib/cloudTimingDiagnostic'
import {
  createProject,
  expectCloudFeatureEnabled,
  setup,
  token,
} from '@e2e/playwright/test-utils'
import type { Page, Response } from '@playwright/test'
import type { CreatedRemoteProject } from '@src/lib/cloudSync/types'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import JSZip from 'jszip'

const CLOUD_SYNC_E2E_TIMEOUT = 20_000

async function expectProjectFileRoute(page: Page) {
  await expect(page).toHaveURL(/\/file\/.*main\.kcl/, {
    timeout: CLOUD_SYNC_E2E_TIMEOUT,
  })
}

test(
  'syncs an edit queued during first upload with the real development API',
  { tag: ['@web'] },
  async ({ context, page, request }, testInfo) => {
    const apiUrl = 'https://api.dev.zoo.dev'
    const headers = { Authorization: `Bearer ${token}` }
    const projectName = `cloud-sync-e2e-${randomUUID()}`
    const projectPath = `${PROJECT_DIR}/${projectName}`
    const firstUpload = Promise.withResolvers<Response>()
    const releaseUpload = Promise.withResolvers<undefined>()
    let createCount = 0

    const creationGate =
      process.env.PLAYWRIGHT_CLOUD_CREATION_GATE ?? 'baseline'
    if (
      creationGate !== 'baseline' &&
      creationGate !== 'project-list-response'
    ) {
      throw new Error('Unknown cloud creation diagnostic gate.')
    }
    const diagnostic = await installCloudTimingDiagnostic(
      page,
      testInfo,
      creationGate
    )
    await expect(await request.get(`${apiUrl}/user`, { headers })).toBeOK()
    await page.exposeFunction(
      'holdCloudCreationResponse',
      () => releaseUpload.promise
    )
    await page.addInitScript((createUrl) => {
      const originalFetch = globalThis.fetch.bind(globalThis)
      globalThis.fetch = async (input, init) => {
        const response = await originalFetch(input, init)
        if (response.url === createUrl && init?.method === 'POST') {
          // WebKit's route.fetch() drops multipart file contents. Let the
          // browser send the upload and only delay delivery of its response.
          await (
            globalThis as typeof globalThis & {
              holdCloudCreationResponse: () => Promise<undefined>
            }
          ).holdCloudCreationResponse()
        }
        return response
      }
    }, `${apiUrl}/user/projects`)
    page.on('response', (response) => {
      if (
        response.url() === `${apiUrl}/user/projects` &&
        response.request().method() === 'POST'
      ) {
        createCount += 1
        firstUpload.resolve(response)
      }
    })

    try {
      await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
        cloudSyncEnabled: true,
      })
      await expectCloudFeatureEnabled(page)
      // The shared CI account has thousands of projects. Filter their cards
      // through the UI without replacing the real project-list response.
      await page.getByPlaceholder(/^Search projects/).fill(projectName)
      await expect(page.getByTestId('project-link')).toHaveCount(0)
      if (creationGate === 'project-list-response') {
        // Start creation after the real list arrives, without waiting for its
        // local reconciliation. Storage timings establish whether they overlap.
        await expect
          .poll(diagnostic.getProjectListResponse, {
            timeout: CLOUD_SYNC_E2E_TIMEOUT,
          })
          .toMatchObject({ status: 200, count: expect.any(Number) })
      }
      await createProject({ name: projectName, page })
      await expectProjectFileRoute(page)

      const response = await firstUpload.promise
      expect(response.ok()).toBe(true)
      const created: CreatedRemoteProject = await response.json()
      expect(created.id).toBeTruthy()
      expect(created.revision).toBeTruthy()
      expect(created.files.map((file) => file.relative_path)).toEqual(
        expect.arrayContaining(['main.kcl', 'project.toml'])
      )
      for (const file of created.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        expect(file.byte_size).toBeGreaterThanOrEqual(0)
      }

      const editor = new EditorFixture(page)
      await editor.openPane()
      await editor.codeContent.fill('queuedCloudEdit = 42\n')
      await expect
        .poll(
          () => readOpfsTextFiles(page, { main: `${projectPath}/main.kcl` }),
          { timeout: CLOUD_SYNC_E2E_TIMEOUT }
        )
        .toMatchObject({ main: 'queuedCloudEdit = 42\n' })

      const updatedResponse = page.waitForResponse(
        (result) =>
          new URL(result.url()).pathname === `/user/projects/${created.id}` &&
          result.request().method() === 'PUT',
        { timeout: CLOUD_SYNC_E2E_TIMEOUT }
      )
      releaseUpload.resolve(undefined)
      const uploaded = await updatedResponse
      expect(uploaded.ok()).toBe(true)
      expect(
        new URL(uploaded.url()).searchParams.get('expected_revision')
      ).toBe(created.revision)
      const updated = await uploaded.json()
      await expect
        .poll(() => readCloudSyncProjectMetadata(page, projectPath), {
          timeout: CLOUD_SYNC_E2E_TIMEOUT,
        })
        .toMatchObject({
          remoteProjectId: created.id,
          remoteRevision: updated.revision,
          lastSyncedAt: expect.any(String),
          pendingCount: 0,
          conflict: undefined,
          lastFailure: undefined,
        })
      const files = await readOpfsTextFiles(page, {
        projectToml: `${projectPath}/project.toml`,
      })
      expect(files.projectToml).toContain(`project_id = "${created.id}"`)

      const download = await request.get(
        `${apiUrl}/user/projects/${created.id}/download?format=zip`,
        { headers }
      )
      await expect(download).toBeOK()
      const archive = await JSZip.loadAsync(await download.body())
      expect(await archive.file(/(^|\/)main\.kcl$/)[0]?.async('string')).toBe(
        'queuedCloudEdit = 42\n'
      )
      expect(
        await archive.file(/(^|\/)project\.toml$/)[0]?.async('string')
      ).toContain(`project_id = "${created.id}"`)
      expect(createCount).toBe(1)
      await expect(
        page.getByTestId('project-sidebar-cloud-conflict-badge')
      ).toHaveCount(0)
      await expect(page.getByTestId('cloud-conflict-dialog')).toHaveCount(0)
    } finally {
      releaseUpload.resolve(undefined)
      await diagnostic.finish().catch(() => {
        console.error('Cloud timing diagnostic teardown could not complete.')
      })
      await page.close()
      // A failed run may have created duplicates. Delete only this run's
      // uniquely named projects, after stopping the app's sync loop.
      const listed = await request.get(`${apiUrl}/user/projects`, { headers })
      await expect(listed).toBeOK()
      const projects: { id: string; title: string }[] = await listed.json()
      for (const project of projects.filter((p) => p.title === projectName)) {
        const url = `${apiUrl}/user/projects/${project.id}`
        await expect(await request.delete(url, { headers })).toBeOK()
        expect((await request.get(url, { headers })).status()).toBe(404)
      }
    }
  }
)
