import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CDPSession, Page, TestInfo } from '@playwright/test'
import { isArray } from '@src/lib/utils'

/** Temporary diagnostic only. Records method names/counts/timings, never arguments. */
export async function installCloudTimingDiagnostic(
  page: Page,
  testInfo: TestInfo,
  creationGate: 'baseline' | 'project-list-response' = 'baseline'
) {
  const directory = testInfo.outputPath('timings')
  mkdirSync(directory, { recursive: true })
  const preview = process.env.VERCEL_BASE_URL
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (preview && bypass) {
    const origin = new URL(preview).origin
    await page.context().route(`${origin}/**`, (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          'X-Vercel-Protection-Bypass': bypass,
        },
      })
    )
  }
  const receipt = path.join(directory, 'events.jsonl')
  let writeFailed = false
  const record = (value: unknown) => {
    try {
      appendFileSync(receipt, JSON.stringify(value) + '\n')
    } catch {
      if (!writeFailed)
        console.error('Cloud timing diagnostic could not write its event log.')
      writeFailed = true
    }
  }
  record({
    kind: 'metadata',
    at: Date.now(),
    diagnostic: 'cross-environment-diagnostic',
    creationGate,
    sourceCommit: '7c093a1c16090b68047aca5bef141d5da3df5f8c',
    rendererOrigin: preview ? new URL(preview).origin : undefined,
    platform: process.platform,
    project: testInfo.project.name,
    browserVersion: page.context().browser()?.version(),
  })
  const secretValues = Object.entries(process.env)
    .filter(
      ([name, value]) =>
        /token|secret|password|api.?key/i.test(name) &&
        value &&
        value.length > 8
    )
    .flatMap(([, value]) => (value ? [value] : []))
  const redact = (value: string) => {
    for (const secret of secretValues)
      value = value.replaceAll(secret, '[redacted]')
    return value.replace(/https?:\/\/[^\s)]+/g, (url) => {
      try {
        const parsed = new URL(url)
        return parsed.origin + parsed.pathname
      } catch {
        return '[url]'
      }
    })
  }
  page.on('console', async (message) => {
    const text = message.text()
    if (text.startsWith('__CLOUD_DIAG__')) {
      try {
        record(JSON.parse(text.slice(14)))
      } catch {
        /* Ignore unrelated console text. */
      }
    }
    if (message.type() === 'error') {
      for (const argument of message.args()) {
        const error = await argument
          .evaluate((value) =>
            value instanceof Error
              ? { name: value.name, message: value.message, stack: value.stack }
              : null
          )
          .catch(() => null)
        if (error)
          record({
            kind: 'error',
            at: Date.now(),
            name: error.name,
            stack: error.stack
              ? redact(error.stack.split('\n').slice(1).join('\n'))
              : undefined,
          })
      }
    }
  })
  let firstProjectListResponse: { status: number; count: number } | undefined
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (url.pathname === '/user/projects') {
      const method = response.request().method()
      let count: number | undefined
      if (method === 'GET') {
        const projects: unknown = await response.json().catch(() => null)
        if (isArray(projects)) count = projects.length
        if (url.origin === 'https://api.dev.zoo.dev' && count !== undefined) {
          firstProjectListResponse ??= { status: response.status(), count }
        }
      }
      record({
        kind: 'project-api-response',
        at: Date.now(),
        method,
        host: url.hostname,
        count,
        status: response.status(),
      })
    }
  })
  await page.addInitScript(() => {
    const totals = new Map<
      string,
      {
        count: number
        total: number
        max: number
        pending: number
        errors: number
      }
    >()
    const emit = (data: unknown) =>
      console.info('__CLOUD_DIAG__' + JSON.stringify(data))
    const measure = <T>(name: string, run: () => T): T => {
      const start = performance.now()
      const metric = totals.get(name) ?? {
        count: 0,
        total: 0,
        max: 0,
        pending: 0,
        errors: 0,
      }
      totals.set(name, metric)
      metric.pending++
      const finish = (error = false) => {
        metric.pending--
        metric.count++
        metric.errors += Number(error)
        const ms = performance.now() - start
        metric.total += ms
        metric.max = Math.max(metric.max, ms)
      }
      try {
        const result = run()
        if (result instanceof Promise)
          void result.then(
            () => finish(),
            () => finish(true)
          )
        else finish()
        return result
      } catch (error) {
        finish(true)
        throw error
      }
    }
    const wrap = (target: object, method: string, label: string) => {
      const original = Reflect.get(target, method)
      if (typeof original !== 'function') return
      Reflect.set(target, method, function (this: unknown, ...args: unknown[]) {
        return measure(label, () => Reflect.apply(original, this, args))
      })
    }
    if (typeof StorageManager !== 'undefined')
      wrap(StorageManager.prototype, 'getDirectory', 'opfs.root')
    if (typeof FileSystemDirectoryHandle !== 'undefined') {
      for (const method of [
        'getDirectoryHandle',
        'getFileHandle',
        'removeEntry',
      ])
        wrap(FileSystemDirectoryHandle.prototype, method, 'opfs.' + method)
      // The wrapper supplies the original receiver through call().
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const entries = FileSystemDirectoryHandle.prototype.entries
      Reflect.set(
        FileSystemDirectoryHandle.prototype,
        'entries',
        function (this: FileSystemDirectoryHandle) {
          const iterator = entries.call(this)
          const next = iterator.next.bind(iterator)
          iterator.next = (...args) =>
            measure('opfs.entries.next', () => next(...args))
          return iterator
        }
      )
    }
    if (typeof FileSystemFileHandle !== 'undefined')
      for (const method of ['getFile', 'createWritable'])
        wrap(FileSystemFileHandle.prototype, method, 'opfs.' + method)
    if (typeof FileSystemWritableFileStream !== 'undefined')
      for (const method of ['write', 'close'])
        wrap(FileSystemWritableFileStream.prototype, method, 'opfs.' + method)
    for (const method of ['text', 'arrayBuffer'])
      wrap(Blob.prototype, method, 'blob.' + method)
    // The wrapper supplies the original receiver through apply().
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (...args) {
      const start = performance.now()
      const request = open.apply(this, args)
      const metric = totals.get('idb.open') ?? {
        count: 0,
        total: 0,
        max: 0,
        pending: 0,
        errors: 0,
      }
      totals.set('idb.open', metric)
      metric.pending++
      const finish = (error = false) => {
        const ms = performance.now() - start
        metric.pending--
        metric.count++
        metric.errors += Number(error)
        metric.total += ms
        metric.max = Math.max(metric.max, ms)
      }
      request.addEventListener('success', () => finish())
      request.addEventListener('error', () => finish(true))
      return request
    }
    // The wrapper supplies the original receiver through apply().
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const result = transaction.apply(this, args)
      const start = performance.now()
      const name = 'idb.transaction.' + result.mode
      const metric = totals.get(name) ?? {
        count: 0,
        total: 0,
        max: 0,
        pending: 0,
        errors: 0,
      }
      totals.set(name, metric)
      metric.pending++
      const finish = (error = false) => {
        const ms = performance.now() - start
        metric.pending--
        metric.count++
        metric.errors += Number(error)
        metric.total += ms
        metric.max = Math.max(metric.max, ms)
      }
      result.addEventListener('complete', () => finish())
      result.addEventListener('abort', () => finish(true))
      return result
    }
    const mark = (stage: string) =>
      emit({ kind: 'stage', stage, at: Date.now(), pageMs: performance.now() })
    window.addEventListener('popstate', () => {
      mark(
        location.pathname.startsWith('/file/')
          ? 'route:file'
          : location.pathname === '/home'
            ? 'route:home'
            : 'route:other'
      )
    })
    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return
        const button = event.target.closest('button')
        const label = button?.textContent?.trim()
        if (label === 'Continue' || label?.endsWith('Create project'))
          mark(label === 'Continue' ? 'continue-click' : 'create-project-click')
      },
      true
    )
    const seen = new Set<string>()
    const observer = new MutationObserver(() => {
      for (const id of ['cmd-bar-arg-value', 'stream']) {
        if (!seen.has(id) && document.querySelector(`[data-testid="${id}"]`)) {
          seen.add(id)
          mark(id + '-mounted')
        }
      }
    })
    observer.observe(document, { subtree: true, childList: true })
    const timer = setInterval(
      () =>
        emit({
          kind: 'storage',
          at: Date.now(),
          pageMs: performance.now(),
          totals: Object.fromEntries(totals),
        }),
      1000
    )
    window.addEventListener(
      'pagehide',
      () => {
        clearInterval(timer)
        observer.disconnect()
      },
      { once: true }
    )
    mark('document')
  })
  let profiler: CDPSession | undefined
  try {
    profiler = await page.context().newCDPSession(page)
    await profiler.send('Profiler.enable')
    await profiler.send('Profiler.start')
  } catch {
    record({ kind: 'profiler-start-unavailable', at: Date.now() })
    await profiler?.detach().catch(() => undefined)
    profiler = undefined
  }
  const finish = async () => {
    if (!profiler) return
    try {
      const { profile } = await profiler.send('Profiler.stop')
      for (const node of profile.nodes)
        node.callFrame.url = redact(node.callFrame.url)
      writeFileSync(
        path.join(directory, 'cpu-profile.json'),
        JSON.stringify(profile)
      )
    } catch {
      record({ kind: 'profiler-unavailable', at: Date.now() })
    } finally {
      await profiler.detach().catch(() => undefined)
    }
  }
  return {
    finish,
    getProjectListResponse: () => firstProjectListResponse,
  }
}
