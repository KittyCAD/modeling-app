import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { projectSession } from '@src/registry/contracts/projectSession'
import { projectStorageProvidersValueSpec } from '@src/lib/projectSession/storage'
import { createCloudProjectStorageProvider } from '@src/lib/cloudProjects/storage'
import fsZds from '@src/lib/fs-zds'
import { isOffline } from '@src/lib/networkStatus'
import { flushActiveTextFileWrite } from '@src/lib/activeTextFile'
import { reportRejection } from '@src/lib/trap'

/** Binds cloud storage to sessions; the session retains ownership of editors and Rust. */
export const cloudProjectSessionExtension = defineRegistryItemFactory((ctx) => {
  const offline = signal(isOffline())
  const clouds = ctx.services.signal(cloudStorageService)
  const sessions = ctx.services.signal(projectSession)
  let provider: ReturnType<typeof createCloudProjectStorageProvider> | undefined
  let boundCloud: typeof clouds.value
  const resolve = (path: string) => {
    const cloud = clouds.value
    if (!cloud) return
    if (cloud !== boundCloud) {
      provider = createCloudProjectStorageProvider(
        cloud,
        {
          resolve: fsZds.resolve,
          relative: fsZds.relative,
          sep: fsZds.sep,
          join: fsZds.join,
        },
        offline
      )
      boundCloud = cloud
    }
    return provider?.(path)
  }
  let disposed = false
  const resume = async () => {
    const session = sessions.peek()
    const current = session?.project.peek()
    const cloud = clouds.peek()
    const id = current?.projectIORefSignal.peek().cloudProjectId
    if (disposed || isOffline() || !session || !current || !cloud || !id) return
    await cloud.retry(id)
    if (disposed || isOffline() || session.project.peek() !== current) return
    await current.executingEditor.peek()?.flushWriteToFile()
    if (disposed || isOffline() || session.project.peek() !== current) return
    await flushActiveTextFileWrite()
  }
  const online = () => {
    offline.value = isOffline()
    void resume().catch(reportRejection)
  }
  const disconnected = () => {
    offline.value = isOffline()
  }
  window.addEventListener('online', online)
  window.addEventListener('offline', disconnected)
  let stop: (() => void) | undefined
  queueMicrotask(() => {
    if (disposed) return
    stop = effect(() => {
      const cloud = clouds.value
      const session = sessions.value
      if (!cloud || !session) return
      return cloud.subscribeReconciled?.((root, files) => {
        void session.applyStorageSnapshot(root, files)?.catch(reportRejection)
      })
    })
  })
  return {
    id: 'cloud-project-session',
    provides: [provide(projectStorageProvidersValueSpec, resolve)],
    dispose: () => {
      disposed = true
      stop?.()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', disconnected)
    },
  }
}, 'cloud-project-session')
