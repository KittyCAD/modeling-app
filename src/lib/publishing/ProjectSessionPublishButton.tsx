import { useSignals } from '@preact/signals-react/runtime'
import type { App } from '@src/lib/app'
import { useIsOffline } from '@src/hooks/network/useIsOffline'
import { useProjectStatus } from '@src/hooks/useProjectStatus'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { editorsService } from '@src/lib/editors/registry/contract'
import { PATHS } from '@src/lib/paths'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { PublishControl } from '@src/lib/publishing/PublishControl'
import { createProjectSessionPublicationWorkflow } from '@src/lib/publishing/projectSessionWorkflow'
import { createPublicationArchiveValidator } from '@src/lib/publishing/validateProjectArchive'
import { editorSaveService } from '@src/lib/save/registry/contract'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { keymapService } from '@src/registry/contracts/keymap'
import {
  markdownEditorService,
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
} from '@src/registry/contracts/markdownEditor'
import { routerService } from '@src/registry/contracts/router'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import { useMemo } from 'react'

/** The header binds the visible opening; all publication operations retain that session. */
export function ProjectSessionPublishButton({
  app,
  session,
}: {
  app: Pick<App, 'registry' | 'auth' | 'fileOperations'>
  session: OpenProjectSession
}) {
  useSignals()
  const project = session.project.value
  const token = app.auth.useToken()
  const user = app.auth.useUser()
  const auth = app.auth.useAuthState()
  const offline = useIsOffline()
  const cloud = app.registry.required(cloudStorageService)
  const editors = app.registry.required(editorsService)
  const saving = app.registry.required(editorSaveService)
  const projects = app.registry.required(projectSessionService)
  const router = app.registry.required(routerService)
  const wasm = app.registry.observe(wasmPromiseFacet).value
  const files = app.fileOperations
  const remote = cloud.projects.value.find(
    (item) => item.id === project.storage?.projectId
  )
  const fetchedStatus = useProjectStatus(
    cloud,
    remote?.publication_status ? undefined : project.storage?.projectId,
    token
  )
  const status = remote?.publication_status
    ? {
        publicationStatus: remote.publication_status,
        feedback: remote.publication?.feedback ?? undefined,
      }
    : fetchedStatus
  const workflow = useMemo(
    () =>
      createProjectSessionPublicationWorkflow({
        session,
        editors,
        saving,
        cloud,
        fileOperations: files,
        token,
        isCurrent: () =>
          projects.currentSession.peek() === session &&
          app.auth.token.peek() === token,
        updateMetadata: projects.updateMetadata,
        openCloudProject: async (id) => {
          await router.navigate(`${PATHS.PROJECT}/${encodeURIComponent(id)}`)
        },
        validate: async (archive) =>
          wasm
            ? createPublicationArchiveValidator(wasm)(archive)
            : new Error('The KCL parser is unavailable.'),
      }),
    [app, session, editors, saving, cloud, files, token, projects, router, wasm]
  )
  const keymap = app.registry.optional(keymapService)
  const markdown = app.registry.optional(markdownEditorService)
  const markdownEditorKeymap = useMemo(
    () =>
      keymap && markdown
        ? {
            focusScope: keymap.focusScope(MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE),
            registerActions: markdown.registerActiveEditor,
          }
        : undefined,
    [keymap, markdown]
  )
  const checking = auth.matches('checkIfLoggedIn') && Boolean(token)
  return (
    <PublishControl
      key={project.contents.path}
      workflow={workflow}
      disabled={
        !wasm ||
        offline ||
        session.signal.aborted ||
        !project.metadata.readWriteAccess
      }
      isCheckingUser={checking}
      publishRequiresUsername={
        !checking && Boolean(token) && !user?.username?.trim()
      }
      willCloneProjectToCloud={!project.storage}
      accountUrl={withSiteBaseURL('/account')}
      projectStatus={status}
      markdownEditorKeymap={markdownEditorKeymap}
    />
  )
}
