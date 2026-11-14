import { effect, signal } from '@preact/signals-core'
import { flushActiveTextFileWrite } from '@src/lib/activeTextFile'
import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
import { createCloudProjectStorageProvider } from '@src/lib/cloudProjects/storage'
import fsZds from '@src/lib/fs-zds'
import { isOffline } from '@src/lib/networkStatus'
import { projectStorageProvidersFacet } from '@src/lib/projectSession/storage'
import { reportRejection } from '@src/lib/trap'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { factory as defineFactory, contribute, type Factory } from 'plankton'

/** Binds cloud storage to sessions; the session retains ownership of editors and Rust. */
export const cloudProjectSessionExtension: Factory = defineFactory({
  dependencies: {
    cloudProjects: cloudProjectsObservations,
    projectSession: projectSessionObservations,
  },
  key: 'cloud-project-session',
  create: ({
    cloudProjects: cloudProjectsInputs,
    projectSession: projectSessionInputs,
  }) => {
    const offline = signal(isOffline())
    const clouds = cloudProjectsInputs.cloudStorageService.current
    const sessions = projectSessionInputs.projectSession.current
    let provider:
      | ReturnType<typeof createCloudProjectStorageProvider>
      | undefined
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
      if (disposed || isOffline() || !session || !current || !cloud || !id)
        return
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
    return {
      start: () =>
        effect(() => {
          const cloud = clouds.value
          const session = sessions.value
          if (!cloud || !session) return
          return cloud.subscribeReconciled?.((root, files) => {
            void session
              .applyStorageSnapshot(root, files)
              ?.catch(reportRejection)
          })
        }),
      items: [contribute(projectStorageProvidersFacet, () => resolve)],
      dispose: () => {
        disposed = true
        window.removeEventListener('online', online)
        window.removeEventListener('offline', disconnected)
      },
    }
  },
})
