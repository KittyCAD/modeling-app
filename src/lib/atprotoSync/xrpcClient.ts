import { toArrayBuffer } from '@src/lib/cloudSync/projectArchive'
import {
  AtprotoSyncApiError,
  AtprotoSyncStaleRevisionError,
  type AtprotoCadSyncClient,
  type AtprotoRecordDeleteInput,
  type AtprotoRecordWriteInput,
} from '@src/lib/atprotoSync/api'
import type {
  AtprotoBlobRef,
  AtprotoRepoRecord,
} from '@src/lib/atprotoSync/types'

export type AtprotoXrpcClientOptions = {
  serviceUrl: string
  accessToken?: string | (() => string | undefined)
  fetch?: typeof fetch
}

export class AtprotoXrpcError extends AtprotoSyncApiError {
  status: number
  errorName?: string
  retryAfterMs?: number

  constructor(
    status: number,
    message: string,
    options: { errorName?: string; retryAfterMs?: number } = {}
  ) {
    super(message)
    this.name = 'AtprotoXrpcError'
    this.status = status
    this.errorName = options.errorName
    this.retryAfterMs = options.retryAfterMs
  }
}

type ListRecordsResponse<Value> = {
  cursor?: string
  records: AtprotoRepoRecord<Value>[]
}

type UploadBlobResponse = {
  blob: AtprotoBlobRef
}

export class AtprotoXrpcClient implements AtprotoCadSyncClient {
  private readonly serviceUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly accessToken?: string | (() => string | undefined)

  constructor(options: AtprotoXrpcClientOptions) {
    this.serviceUrl = options.serviceUrl.replace(/\/+$/g, '')
    this.fetchImpl = options.fetch ?? fetch
    this.accessToken = options.accessToken
  }

  async listRecords<Value>({
    repo,
    collection,
  }: {
    repo: string
    collection: string
  }) {
    const records: AtprotoRepoRecord<Value>[] = []
    let cursor: string | undefined

    do {
      const response = await this.query<ListRecordsResponse<Value>>(
        'com.atproto.repo.listRecords',
        {
          repo,
          collection,
          limit: '100',
          ...(cursor ? { cursor } : {}),
        }
      )
      records.push(...response.records)
      cursor = response.cursor
    } while (cursor)

    return records
  }

  async getRecord<Value>({
    repo,
    collection,
    rkey,
  }: {
    repo: string
    collection: string
    rkey: string
  }) {
    return this.query<AtprotoRepoRecord<Value>>('com.atproto.repo.getRecord', {
      repo,
      collection,
      rkey,
    })
  }

  async putRecord<Value>(input: AtprotoRecordWriteInput<Value>) {
    try {
      return await this.procedure<AtprotoRepoRecord<Value>>(
        'com.atproto.repo.putRecord',
        input
      )
    } catch (error) {
      if (
        error instanceof AtprotoXrpcError &&
        error.errorName === 'InvalidSwap'
      ) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new AtprotoSyncStaleRevisionError({
          expectedRevision:
            typeof input.swapRecord === 'string' ? input.swapRecord : undefined,
        })
      }

      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
  }

  async deleteRecord(input: AtprotoRecordDeleteInput) {
    try {
      await this.procedure('com.atproto.repo.deleteRecord', input)
    } catch (error) {
      if (
        error instanceof AtprotoXrpcError &&
        error.errorName === 'InvalidSwap'
      ) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new AtprotoSyncStaleRevisionError({})
      }

      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
  }

  async uploadBlob({
    bytes,
    contentType,
  }: {
    repo: string
    bytes: Uint8Array
    contentType: string
  }) {
    const response = await this.request(
      'com.atproto.repo.uploadBlob',
      {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
        },
        body: toArrayBuffer(bytes),
      },
      { auth: true }
    )
    const json = (await response.json()) as UploadBlobResponse
    return json.blob
  }

  async getBlob({ repo, blob }: { repo: string; blob: AtprotoBlobRef }) {
    const cid = atprotoBlobCid(blob)
    if (!cid) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new AtprotoSyncApiError('ATProto blob reference is missing a CID.')
    }

    const response = await this.request(
      'com.atproto.sync.getBlob',
      {
        method: 'GET',
      },
      {
        query: {
          did: repo,
          cid,
        },
      }
    )
    return response.arrayBuffer()
  }

  private async query<T>(method: string, query: Record<string, string>) {
    const response = await this.request(
      method,
      {
        method: 'GET',
      },
      { query }
    )
    return response.json() as Promise<T>
  }

  private async procedure<T = unknown>(method: string, input: unknown) {
    const response = await this.request(
      method,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
      { auth: true }
    )
    return response.json() as Promise<T>
  }

  private async request(
    method: string,
    init: RequestInit,
    options: {
      auth?: boolean
      query?: Record<string, string>
    } = {}
  ) {
    const url = new URL(`/xrpc/${method}`, this.serviceUrl)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }

    const headers = new Headers(init.headers)
    if (options.auth) {
      const token = this.getAccessToken()
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
    }

    const response = await this.fetchImpl(url.toString(), {
      ...init,
      headers,
    })

    if (!response.ok) {
      await throwXrpcError(response)
    }

    return response
  }

  private getAccessToken() {
    return typeof this.accessToken === 'function'
      ? this.accessToken()
      : this.accessToken
  }
}

export function atprotoBlobCid(blob: AtprotoBlobRef) {
  if (typeof blob.ref === 'string') {
    return blob.ref
  }
  if (typeof blob.ref?.$link === 'string') {
    return blob.ref.$link
  }
  if (typeof blob.cid === 'string') {
    return blob.cid
  }
  return undefined
}

function retryAfterDelayMs(value: string | null) {
  if (!value?.trim()) {
    return undefined
  }

  const numericSeconds = Number(value)
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000
  }

  const retryAtMs = Date.parse(value)
  if (Number.isNaN(retryAtMs)) {
    return undefined
  }

  return Math.max(0, retryAtMs - Date.now())
}

async function throwXrpcError(response: Response): Promise<never> {
  let message = response.statusText || `HTTP ${response.status}`
  let errorName: string | undefined

  try {
    const body = await response.json()
    if (typeof body?.error === 'string') {
      errorName = body.error
    }
    if (typeof body?.message === 'string') {
      message = body.message
    }
  } catch {
    const text = await response.text().catch(() => '')
    if (text) {
      message = text
    }
  }

  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new AtprotoXrpcError(response.status, message, {
    errorName,
    retryAfterMs: retryAfterDelayMs(response.headers.get('Retry-After')),
  })
}
