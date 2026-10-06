import {
  getProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const metadata = {
  schemaVersion: 1 as const,
  localProjectPath: '/projects/bracket',
  projectName: 'bracket',
}

describe('cloud sync transaction outcomes', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects a metadata write that aborts after its request succeeds', async () => {
    let aborted!: Promise<void>
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof put>
    ) {
      aborted = new Promise((resolve) =>
        this.transaction.addEventListener('abort', () => resolve())
      )
      const request = put.apply(this, args)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    })

    const outcome = await putProjectMetadata(metadata).then(
      () => 'resolved',
      () => 'rejected'
    )
    await aborted
    expect(outcome).toBe('rejected')
    await expect(
      getProjectMetadata(metadata.localProjectPath)
    ).resolves.toBeUndefined()
  })
})
