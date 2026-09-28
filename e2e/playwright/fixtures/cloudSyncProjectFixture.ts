import { randomUUID } from 'node:crypto'
import { test as base, expect } from '@e2e/playwright/base-test'
import { token } from '@e2e/playwright/test-utils'
import type { Response } from '@playwright/test'

interface FirstUploadProject {
  name: string
  firstUpload: Promise<Response>
  releaseUpload: () => void
  readonly createCount: number
}

export const test = base.extend<{ firstUploadProject: FirstUploadProject }>({
  firstUploadProject: async ({ page, request }, provide) => {
    const apiUrl = 'https://api.dev.zoo.dev'
    const headers = { Authorization: `Bearer ${token}` }
    const projectName = `cloud-sync-e2e-${randomUUID()}`
    const firstUpload = Promise.withResolvers<Response>()
    const releaseUpload = Promise.withResolvers<undefined>()
    let createCount = 0

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
    const onResponse = (response: Response) => {
      if (
        response.url() === `${apiUrl}/user/projects` &&
        response.request().method() === 'POST'
      ) {
        createCount += 1
        firstUpload.resolve(response)
      }
    }
    page.on('response', onResponse)

    try {
      await provide({
        name: projectName,
        firstUpload: firstUpload.promise,
        releaseUpload: () => releaseUpload.resolve(undefined),
        get createCount() {
          return createCount
        },
      })
    } finally {
      // Fixture teardown runs even when the test times out on firstUpload.
      // Its request dependency stays alive until this cleanup has completed.
      try {
        await page.close()
      } finally {
        releaseUpload.resolve(undefined)
        page.off('response', onResponse)
        // Stop the app's sync loop before deleting only this run's projects.
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
  },
})
