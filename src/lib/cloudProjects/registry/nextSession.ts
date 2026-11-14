import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { computed, effect, signal, untracked } from '@preact/signals-core'
import { watchCloudEditorSession } from '@src/lib/cloudProjects/next/session'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import {
  editorsService,
  editorReadOnlyPoliciesValueSpec,
} from '@src/lib/editors/registry/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  editorSaveService,
  editorAutosavePoliciesValueSpec,
} from '@src/lib/save/registry/contract'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { CloudProjectStatus } from '@src/lib/cloudProjects/next/CloudProjectStatus'
import { routerService } from '@src/registry/contracts/router'
import { PATHS } from '@src/lib/paths'
import { isOffline } from '@src/lib/networkStatus'

const extension = defineRegistryItemFactory(({ services }) => {
  const offline = signal(isOffline())
  const updateNetwork = () => {
    offline.value = isOffline()
  }
  window.addEventListener('online', updateNetwork)
  window.addEventListener('offline', updateNetwork)
  const cloudProject = computed(() => {
    const project = services.signal(projectSessionService).value?.currentProject
      .value
    const pathname =
      services.signal(routerService).value?.location.value.pathname
    const id = project?.storage?.projectId
    return (
      project?.storage?.type === 'cloud' &&
      id !== undefined &&
      pathname === `${PATHS.PROJECT}/${encodeURIComponent(id)}`
    )
  })
  // TODO: relax this restriction for cloud documents when a CRDT extension
  // provides offline editing and reconciliation on reconnect.
  const readOnly = computed(() => cloudProject.value && offline.value)
  let disposed = false
  let stop: (() => void) | undefined
  queueMicrotask(() => {
    if (disposed) return
    stop = effect(() => {
      if (!cloudProject.value) return
      const projects = services.signal(projectSessionService).value
      const cloud = services.signal(cloudStorageService).value
      const editors = services.signal(editorsService).value
      const saving = services.signal(editorSaveService).value
      const session = projects?.currentSession.value
      if (!projects || !cloud || !editors || !saving || !session) return
      if (!session.project.peek().storage) return
      return untracked(() =>
        watchCloudEditorSession({ cloud, session, projects, editors, saving })
      )
    })
  })
  return {
    provides: [
      provide(appHeaderItemsValueSpec, {
        id: 'cloud-projects.status',
        order: 20,
        Component: CloudProjectStatus,
      }),
      provide(editorAutosavePoliciesValueSpec, {
        id: 'cloud.autosave',
        matches: '*',
        required: cloudProject,
      }),
      provide(editorReadOnlyPoliciesValueSpec, {
        id: 'cloud.offline',
        matches: '*',
        readOnly,
      }),
    ],
    dispose: () => {
      disposed = true
      window.removeEventListener('online', updateNetwork)
      window.removeEventListener('offline', updateNetwork)
      stop?.()
    },
  }
}, 'cloud-projects.next-session')

export default withProjectShellFeature(extension, 'cloud-projects.next-session')
