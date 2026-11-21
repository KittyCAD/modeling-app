import { useSignals } from '@preact/signals-react/runtime'
import { useProjectStatus } from '@src/hooks/useProjectStatus'
import type { App } from '@src/lib/app'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { PublishControl } from '@src/lib/publishing/PublishControl'
import { createLegacyPublicationWorkflow } from '@src/lib/publishing/legacyWorkflow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import {
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'
import { keymapService } from '@src/registry/contracts/keymap'
import {
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
  markdownEditorService,
} from '@src/registry/contracts/markdownEditor'
import { memo, useMemo } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- The legacy adapter owns navigation after cloning for publication.
import { useNavigate } from 'react-router-dom'

/** Legacy state and services are translated here; reusable publication code does not import App. */
export const LegacyPublishButton = memo(function LegacyPublishButton({
  app,
}: {
  app: App
}) {
  useSignals()
  const owner = app.projectSignal.value
  const project = owner?.projectIORefSignal.value
  return owner && project ? (
    <LegacyProjectPublishButton
      key={project.path}
      app={app}
      owner={owner}
      project={project}
    />
  ) : null
})

function LegacyProjectPublishButton({
  app,
  owner,
  project,
}: {
  app: App
  owner: NonNullable<App['projectSignal']['value']>
  project: Project
}) {
  useSignals()
  const { auth } = app
  const { kclManager } = app.singletons
  const navigate = useNavigate()
  const authState = auth.useAuthState()
  const token = auth.useToken()
  const user = auth.useUser()
  const cloud = app.registry.required(cloudStorageService)
  const actions = app.registry.optional(homeProjectActionsService)
  const fileOperations = app.fileOperations
  const projectStatus = useProjectStatus(cloud, project.cloudProjectId, token)
  const willCloneProjectToCloud =
    project.libraryType !== CLOUD_PROJECT_LIBRARY_TYPE
  const sourcePath = project.path
  const workflow = useMemo(
    () =>
      createLegacyPublicationWorkflow({
        project: owner.projectIORefSignal.value,
        kclManager,
        isCurrent: () =>
          app.projectSignal.value === owner &&
          owner.projectIORefSignal.value.path === sourcePath,
        fileOperations,
        cloud,
        actions,
        getEntries: () => app.registry.get(homeProjectEntriesFacet),
        token,
        navigate,
        willCloneProjectToCloud,
      }),
    [
      app,
      owner,
      sourcePath,
      kclManager,
      fileOperations,
      cloud,
      actions,
      token,
      navigate,
      willCloneProjectToCloud,
    ]
  )
  const keymap = app.registry.optional(keymapService)
  const markdownEditor = app.registry.optional(markdownEditorService)
  const markdownEditorKeymap = useMemo(
    () =>
      keymap && markdownEditor
        ? {
            focusScope: keymap.focusScope(MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE),
            registerActions: markdownEditor.registerActiveEditor,
          }
        : undefined,
    [keymap, markdownEditor]
  )
  const isCheckingUser = authState.matches('checkIfLoggedIn') && !!token
  return (
    <PublishControl
      workflow={workflow}
      disabled={
        kclManager.isAstBodyEmpty(kclManager.astSignal.value) ||
        kclManager.hasErrors()
      }
      isCheckingUser={isCheckingUser}
      publishRequiresUsername={
        !isCheckingUser && !!token && !user?.username?.trim()
      }
      willCloneProjectToCloud={willCloneProjectToCloud}
      accountUrl={withSiteBaseURL('/account')}
      projectStatus={projectStatus}
      markdownEditorKeymap={markdownEditorKeymap}
    />
  )
}
