import { factory, contribute } from 'plankton'
import { inputs, observeService } from '@src/registry/inputs'
import { computed, effect, signal, untracked } from '@preact/signals-core'
import { watchCloudEditorSession } from '@src/lib/cloudProjects/next/session'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import {
  editorsService,
  editorReadOnlyPoliciesFacet,
} from '@src/lib/editors/registry/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  editorSaveService,
  editorAutosavePoliciesFacet,
} from '@src/lib/save/registry/contract'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import { CloudProjectStatus } from '@src/lib/cloudProjects/next/CloudProjectStatus'
import { routerService } from '@src/registry/contracts/router'
import { PATHS } from '@src/lib/paths'
import { isOffline } from '@src/lib/networkStatus'

const extension = factory({
  key: 'cloud-projects.next-session',
  dependencies: {
    observed: inputs({
      projects: observeService(projectSessionService),
      cloud: observeService(cloudStorageService),
      editors: observeService(editorsService),
      saving: observeService(editorSaveService),
      router: observeService(routerService),
    }),
  },
  create: ({ observed }) => {
    const offline = signal(isOffline())
    const updateNetwork = () => {
      offline.value = isOffline()
    }
    const cloudProject = computed(() => {
      const project = observed.projects.current.value?.currentProject.value
      const pathname = observed.router.current.value?.location.value.pathname
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
    return {
      start: () => {
        window.addEventListener('online', updateNetwork)
        window.addEventListener('offline', updateNetwork)
        const stop = effect(() => {
          if (!cloudProject.value) return
          const projects = observed.projects.current.value
          const cloud = observed.cloud.current.value
          const editors = observed.editors.current.value
          const saving = observed.saving.current.value
          const session = projects?.currentSession.value
          if (!projects || !cloud || !editors || !saving || !session) return
          if (!session.project.peek().storage) return
          return untracked(() =>
            watchCloudEditorSession({
              cloud,
              session,
              projects,
              editors,
              saving,
            })
          )
        })
        return () => {
          window.removeEventListener('online', updateNetwork)
          window.removeEventListener('offline', updateNetwork)
          stop()
        }
      },
      items: [
        contribute(appHeaderEndItemsFacet, () => ({
          id: 'cloud-projects.status',
          order: 20,
          Component: CloudProjectStatus,
        })),
        contribute(editorAutosavePoliciesFacet, () => ({
          id: 'cloud.autosave',
          matches: '*' as const,
          required: cloudProject,
        })),
        contribute(editorReadOnlyPoliciesFacet, () => ({
          id: 'cloud.offline',
          matches: '*' as const,
          readOnly,
        })),
      ],
    }
  },
})

export default withProjectShellFeature(extension, 'cloud-projects.next-session')
