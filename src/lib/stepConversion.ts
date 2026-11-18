/* eslint-disable suggest-no-throw/suggest-no-throw -- Promise failures are caught by the durable queue and presented as retryable status. */
import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { decode } from '@msgpack/msgpack'
import type { CompilationIssue } from '@rust/kcl-lib/bindings/CompilationIssue'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { getKclVersion } from '@src/lib/kclVersion'
import { webSafeJoin, webSafePathSplit } from '@src/lib/paths'
import { buildStepToKclPrompt, isStepFileName } from '@src/lib/stepToKcl'
import { isArray } from '@src/lib/utils'
import { getModule } from '@src/lib/wasm_lib_wrapper'
import { withMlephantWebSocketURL } from '@src/lib/withBaseURL'

export type ConversionStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ConversionFiles = Record<string, string>
export interface StepConversion {
  id: string
  ownerId: string
  projectPath: string
  source: File
  status: ConversionStatus
  attempts: number
  error?: string
  files?: ConversionFiles
  savedPath?: string
  summary?: string
}

export function validateConversionFiles(value: unknown): ConversionFiles {
  if (!value || typeof value !== 'object' || isArray(value)) {
    throw new Error('Conversion did not return KCL files.')
  }
  const entries = Object.entries(value)
  if (entries.length > 128)
    throw new Error('Conversion returned too many files.')
  let bytes = 0
  const files: ConversionFiles = {}
  for (const [name, content] of entries) {
    if (
      !name.endsWith('.kcl') ||
      /[\\:\x00-\x1f]/.test(name) ||
      webSafePathSplit(name).some(
        (part) => !part || part === '.' || part === '..'
      ) ||
      typeof content !== 'string'
    )
      throw new Error(
        'Conversion returned an unsupported file path or content.'
      )
    bytes += new TextEncoder().encode(content).length
    if (bytes > 16 * 1024 * 1024)
      throw new Error('Conversion result is too large.')
    files[name] = content
  }
  if (!files['main.kcl']?.trim())
    throw new Error('Conversion returned no main.kcl.')
  return files
}

/** The parser must see native KCL whose module graph stays in the output set. */
export function validateNativeConversion(files: ConversionFiles) {
  for (const [name, code] of Object.entries(files)) {
    let program: Program
    let issues: CompilationIssue[]
    try {
      ;[program, issues] = getModule().parse_wasm(code)
    } catch {
      throw new Error(
        `Conversion returned invalid KCL in ${name}. Please retry.`
      )
    }
    if (issues.some((issue) => issue.severity !== 'Warning')) {
      throw new Error(
        `Conversion returned invalid KCL in ${name}. Please retry.`
      )
    }
    for (const statement of program.body) {
      if (statement.type !== 'ImportStatement' || statement.path.type === 'Std')
        continue
      if (statement.path.type !== 'Kcl')
        throw new Error(
          'Conversion contains imported geometry instead of native KCL. Please retry.'
        )
      const imported = statement.path.filename
      if (/^[\/]|[\\:\x00-\x1f]/.test(imported))
        throw new Error(
          'Conversion imports a file outside its result. Please retry.'
        )
      const parts = webSafePathSplit(name).slice(0, -1)
      for (const part of webSafePathSplit(imported)) {
        if (part === '..') {
          if (!parts.length)
            throw new Error(
              'Conversion imports a file outside its result. Please retry.'
            )
          parts.pop()
        } else if (part && part !== '.') parts.push(part)
      }
      if (!Object.hasOwn(files, webSafeJoin(parts)))
        throw new Error(
          'Conversion is missing an imported KCL file. Please retry.'
        )
    }
  }
}

export interface ConversionStorage {
  load: (ownerId: string) => Promise<StepConversion[]>
  put: (job: StepConversion) => Promise<void>
}
export type ConversionRunner = (
  job: StepConversion,
  token: string,
  signal: AbortSignal
) => Promise<{ files: ConversionFiles; summary?: string }>

/** App-owned queue. Closing a pane does not own or cancel its work. */
export class StepConversionQueue {
  private jobs: StepConversion[] = []
  private listeners = new Set<() => void>()
  private ownerId = ''
  private token = ''
  private generation = 0
  private active?: AbortController
  private loaded = false
  constructor(
    private storage: ConversionStorage,
    private runner: ConversionRunner
  ) {}

  getSnapshot = () => this.jobs
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish() {
    this.listeners.forEach((listener) => listener())
  }
  private async update(job: StepConversion) {
    await this.storage.put(job)
    if (job.ownerId !== this.ownerId) return
    this.jobs = this.jobs.map((item) => (item.id === job.id ? job : item))
    this.publish()
  }
  async configure(ownerId: string, token: string) {
    if (ownerId === this.ownerId && this.loaded && token) {
      this.token = token
      return
    }
    const generation = ++this.generation
    this.active?.abort()
    this.ownerId = ownerId
    this.token = token
    this.loaded = false
    this.jobs = []
    this.publish()
    if (!ownerId || !token) return
    const loaded = await this.storage.load(ownerId)
    if (generation !== this.generation) return
    // A closed app cannot attest whether a remote turn finished. Never restart
    // paid inference automatically; keep the source for an explicit retry.
    const jobs = loaded.map(
      (job): StepConversion =>
        job.status === 'running' || job.status === 'queued'
          ? {
              ...job,
              status: 'failed',
              error:
                'Conversion was interrupted. Retry to start a new attempt using reasoning credits.',
            }
          : job
    )
    for (let index = 0; index < jobs.length; index++) {
      if (generation !== this.generation) return
      if (jobs[index].status === loaded[index].status) continue
      try {
        await this.storage.put(jobs[index])
      } catch {
        jobs[index] = {
          ...jobs[index],
          error:
            'Conversion was interrupted and recovery status could not be saved. Check available storage before retrying.',
        }
      }
    }
    if (generation !== this.generation) return
    this.jobs = jobs
    this.loaded = true
    this.publish()
  }
  async enqueue(projectPath: string, source: File) {
    if (!this.loaded || !this.token)
      throw new Error('Sign in before converting a file.')
    if (
      !isStepFileName(source.name) ||
      !source.size ||
      source.size > 64 * 1024 * 1024
    ) {
      throw new Error('Choose a non-empty STEP file smaller than 64 MiB.')
    }
    const job: StepConversion = {
      id: crypto.randomUUID(),
      ownerId: this.ownerId,
      projectPath,
      source,
      status: 'queued',
      attempts: 0,
    }
    await this.storage.put(job)
    if (job.ownerId !== this.ownerId) return
    this.jobs = [...this.jobs, job]
    this.publish()
    void this.pump()
  }
  async retry(id: string) {
    const job = this.jobs.find((item) => item.id === id)
    if (!job || job.status !== 'failed' || !this.token) return
    await this.update({ ...job, status: 'queued', error: undefined })
    void this.pump()
  }
  async savePath(id: string, savedPath: string) {
    const job = this.jobs.find((item) => item.id === id)
    if (!job) return
    const saved = { ...job, savedPath }
    try {
      await this.update(saved)
    } catch {
      // The KCL has already been written to disk. Do not block opening it
      // merely because the browser cannot retain the destination metadata.
      if (job.ownerId === this.ownerId) {
        this.jobs = this.jobs.map((item) =>
          item.id === id
            ? {
                ...saved,
                error:
                  'KCL was saved, but its location could not be saved for recovery.',
              }
            : item
        )
        this.publish()
      }
    }
  }
  private async pump() {
    if (this.active || !this.loaded || !this.token) return
    const job = this.jobs.find((item) => item.status === 'queued')
    if (!job) return
    const controller = new AbortController()
    const token = this.token
    this.active = controller
    const running: StepConversion = {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
    }
    try {
      await this.update(running)
      if (controller.signal.aborted)
        throw new Error('Conversion interrupted. Retry when signed in.')
      const result = await this.runner(running, token, controller.signal)
      const files = validateConversionFiles(result.files)
      if (controller.signal.aborted)
        throw new Error('Conversion interrupted. Retry when signed in.')
      const completed: StepConversion = {
        ...running,
        files,
        summary: result.summary,
        status: 'completed',
      }
      try {
        await this.update(completed)
      } catch {
        // Keep the paid result available for an immediate disk save even if
        // browser storage runs out of space at the end of the attempt.
        if (job.ownerId === this.ownerId) {
          this.jobs = this.jobs.map((item) =>
            item.id === job.id
              ? {
                  ...completed,
                  error:
                    'Conversion finished, but could not be saved for recovery. Open KCL before closing ZDS.',
                }
              : item
          )
          this.publish()
        }
      }
    } catch (error) {
      const failed: StepConversion = {
        ...running,
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Conversion failed. Please retry.',
      }
      // Preserve failed state even if saving to IndexedDB itself failed.
      try {
        await this.update(failed)
      } catch {
        if (job.ownerId === this.ownerId) {
          this.jobs = this.jobs.map((item) =>
            item.id === job.id ? failed : item
          )
          this.publish()
        }
      }
    } finally {
      this.active = undefined
      void this.pump()
    }
  }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('zds-step-conversions', 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore('jobs', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new Error('Could not access saved conversions.'))
  })
}

export const conversionStorage: ConversionStorage = {
  async load(ownerId) {
    const db = await database()
    try {
      return await new Promise<StepConversion[]>((resolve, reject) => {
        const request = db.transaction('jobs').objectStore('jobs').getAll()
        request.onsuccess = () =>
          resolve(
            (request.result as StepConversion[]).filter(
              (job) => job.ownerId === ownerId
            )
          )
        request.onerror = () =>
          reject(new Error('Could not read saved conversions.'))
      })
    } finally {
      db.close()
    }
  },
  async put(job) {
    const db = await database()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('jobs', 'readwrite')
        transaction.objectStore('jobs').put(job)
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () =>
          reject(
            new Error(
              'Could not save the conversion. Check available storage and retry.'
            )
          )
      })
    } finally {
      db.close()
    }
  },
}

export const runStepConversion: ConversionRunner = async (
  job,
  token,
  signal
) => {
  const data = Array.from(new Uint8Array(await job.source.arrayBuffer()))
  if (signal.aborted)
    throw new Error('Conversion interrupted. Retry when signed in.')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(withMlephantWebSocketURL(''))
    ws.binaryType = 'arraybuffer'
    let files: ConversionFiles | undefined
    let summary: string | undefined
    let submitted = false
    let settled = false
    const finish = (error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      if (error && submitted && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'system',
            command: 'cancel',
          } satisfies MlCopilotClientMessage)
        )
      }
      ws.close()
      if (error) reject(new Error(error))
      else if (files) resolve({ files, summary })
      else
        reject(
          new Error(
            'Zookeeper finished without a KCL result. Review the source and retry.'
          )
        )
    }
    const abort = () =>
      finish('Conversion interrupted. Retry to start a new attempt.')
    const timeout = setTimeout(
      () => finish('Conversion timed out. Retry to start a new attempt.'),
      20 * 60 * 1000
    )
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'ping' }))
    }, 4000)
    signal.addEventListener('abort', abort, { once: true })
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'headers',
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    ws.onerror = () =>
      finish('Could not connect to Zookeeper. Check your connection and retry.')
    ws.onclose = () =>
      finish('Connection to Zookeeper was lost. Retry to start a new attempt.')
    ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      try {
        const message = (
          typeof event.data === 'string'
            ? JSON.parse(event.data)
            : decode(new Uint8Array(event.data))
        ) as MlCopilotServerMessage
        if (!message || typeof message !== 'object') return
        if ('error' in message) {
          const detail = message.error?.detail
          // The server may request auth before processing the headers just sent.
          if (
            !submitted &&
            typeof detail === 'string' &&
            detail.includes('Please send `{ headers:')
          )
            return
          finish(
            typeof detail === 'string'
              ? detail
              : 'Zookeeper could not convert the file. Please retry.'
          )
        } else if ('conversation_id' in message && !submitted) {
          submitted = true
          ws.send(
            JSON.stringify({
              type: 'user',
              mode: 'thoughtful',
              kcl_version: getKclVersion(),
              content: buildStepToKclPrompt(job.source.name, 'main.kcl'),
              project_name: `step-conversion-${job.id}`,
              current_files: { 'main.kcl': [] },
              additional_files: [
                { name: job.source.name, mimetype: 'model/step', data },
              ],
            } satisfies MlCopilotClientMessage & { kcl_version: string })
          )
        } else if ('access_denied' in message) {
          finish(
            'Zookeeper access was denied. Check your account and reasoning credits, then retry.'
          )
        } else if (
          'tool_output' in message &&
          message.tool_output?.result?.type === 'edit_kcl_code'
        ) {
          const result = message.tool_output.result
          if (
            result.status_code >= 200 &&
            result.status_code < 300 &&
            !result.error
          ) {
            // Snapshots may be incomplete while the model creates helper files.
            files = result.outputs
          } else {
            files = undefined
          }
        } else if ('end_of_stream' in message) {
          summary = message.end_of_stream.whole_response ?? undefined
          if (files) {
            files = validateConversionFiles(files)
            validateNativeConversion(files)
          }
          finish()
        }
      } catch (error) {
        finish(
          error instanceof Error
            ? error.message
            : 'The conversion returned an unreadable result. Please retry.'
        )
      }
    }
  })
}

export const stepConversions = new StepConversionQueue(
  conversionStorage,
  runStepConversion
)
