import { signal } from '@preact/signals-core'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import {
  createPluginRuntime,
  type PluginRuntime,
} from '@src/lib/communityPlugins/runtime'
import { isErr } from '@src/lib/trap'

/** One explicit development installation, owned by the backing editor rather than a pane. */
export function createPluginSession(
  publish: (
    runtime: PluginRuntime | undefined,
    source?: PluginSource,
    grants?: ReadonlySet<string>
  ) => Promise<Error | undefined>,
  notify: (message: string) => void
) {
  const status = signal('Stopped')
  const enabled = signal(false)
  let latest: PluginSource | undefined
  let installed: PluginSource | undefined
  let runtime: PluginRuntime | undefined
  let candidate: PluginRuntime | undefined
  let grants: ReadonlySet<string> = new Set()
  let generation = 0
  let disposed = false
  let pending = Promise.resolve()
  const enqueue = (work: () => Promise<void>) => {
    pending = pending.then(work).catch((cause) => {
      status.value = isErr(cause) ? cause.message : String(cause)
    })
    return pending
  }
  const reload = (force = false) => {
    const approved = grants
    const target = latest
    const revision = ++generation
    return enqueue(async () => {
      if (
        disposed ||
        !enabled.peek() ||
        !target ||
        revision !== generation ||
        (!force && installed?.source === target.source)
      )
        return
      if (
        target.manifest.permissions.some(
          (permission) => !approved.has(permission)
        )
      ) {
        status.value =
          'Permission changes require approval. The previous instance remains active.'
        return
      }
      status.value = 'Starting...'
      const next = await createPluginRuntime(target, approved, notify)
      if (isErr(next)) {
        status.value = next.message
        return
      }
      if (disposed || revision !== generation) {
        next.dispose()
        return
      }
      candidate = next
      let error: Error | undefined
      try {
        error = await publish(next, target, approved)
      } catch (cause) {
        error = isErr(cause) ? cause : new Error(String(cause))
      } finally {
        candidate = undefined
      }
      if (error) {
        next.dispose()
        status.value = error.message
        return
      }
      runtime?.dispose()
      runtime = next
      installed = target
      status.value = 'Running'
    })
  }
  return {
    status,
    enabled,
    update: (source: PluginSource) => {
      latest = source
      return enabled.peek() ? reload() : Promise.resolve()
    },
    start: (source: PluginSource, approved: ReadonlySet<string>) => {
      if (disposed) return Promise.resolve()
      latest = source
      grants = new Set(approved)
      enabled.value = true
      return reload(true)
    },
    stop: () => {
      enabled.value = false
      generation++
      candidate?.dispose()
      runtime?.dispose()
      return enqueue(async () => {
        const error = await publish(undefined)
        if (error) {
          status.value = error.message
          return
        }
        runtime?.dispose()
        runtime = undefined
        installed = undefined
        status.value = 'Stopped'
      })
    },
    dispose() {
      disposed = true
      return this.stop()
    },
    settled: () => pending,
  }
}

export type PluginSession = ReturnType<typeof createPluginSession>
