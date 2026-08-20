import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { getAquariumStatusBadge } from '@src/components/AquariumStatusBadge'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { PublishDialog } from '@src/components/PublishDialog'
import {
  type ProjectStatus,
  useProjectStatus,
} from '@src/hooks/useProjectStatus'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  type CurrentProjectPublicationDetails,
  getCurrentProjectPublicationDetails,
  publishCurrentProject,
} from '@src/lib/share'
import { err } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { keymapService } from '@src/registry/contracts/keymap'
import {
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
  markdownEditorService,
} from '@src/registry/contracts/markdownEditor'
import { projectSession } from '@src/registry/contracts/projectSession'
import {
  type ComponentProps,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

type PublishButtonProps = {
  app: App
}

export const PublishButton = memo(function PublishButton({
  app,
}: PublishButtonProps) {
  useSignals()
  const project =
    app.registry.get(projectSession).project.value?.projectIORefSignal.value

  return (
    <Popover className="relative hidden sm:flex">
      {(popover) => (
        <PublishPopoverContent
          app={app}
          project={project}
          open={popover.open}
        />
      )}
    </Popover>
  )
})

function PublishPopoverContent({
  app,
  project,
  open,
}: {
  app: App
  project: Project | undefined
  open: boolean
}) {
  useSignals()
  const { auth } = app
  const { kclManager } = app.singletons
  const ast = kclManager.astSignal.value
  const kclEmpty = kclManager.isAstBodyEmpty(ast)
  const hasKclErrors = kclManager.hasErrors()
  const authState = auth.useAuthState()
  const token = auth.useToken()
  const user = auth.useUser()
  const fetchedProjectStatus = useProjectStatus(project?.cloudProjectId, token)
  const [submittedProjectStatus, setSubmittedProjectStatus] = useState<{
    projectId: string | undefined
    status: ProjectStatus
  } | null>(null)
  const [publicationDetails, setPublicationDetails] =
    useState<CurrentProjectPublicationDetails | null>(null)
  const [isLoadingPublicationDetails, setIsLoadingPublicationDetails] =
    useState(false)
  const username = user?.username?.trim() || ''
  const isCheckingUser = authState.matches('checkIfLoggedIn') && !!token
  const publishRequiresUsername = !isCheckingUser && !!token && !username
  const accountUrl = withSiteBaseURL('/account')
  const buttonDisabled = kclEmpty || hasKclErrors
  const projectStatus =
    submittedProjectStatus &&
    submittedProjectStatus.projectId === project?.cloudProjectId
      ? submittedProjectStatus.status
      : fetchedProjectStatus
  const buttonPresentation = getPublishButtonPresentation(projectStatus)
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

  const fetchPublicationDetails = useCallback(async () => {
    if (!token || !project) {
      return null
    }

    const wasmInstance = await kclManager.wasmInstancePromise
    const details = await getCurrentProjectPublicationDetails({
      token,
      project,
      wasmInstance,
    })

    if (err(details)) {
      console.error('Failed to load project publication details', details)
      return null
    }

    return details
  }, [kclManager, project, token])

  useEffect(() => {
    let isCancelled = false

    if (!open) {
      setPublicationDetails(null)
      setIsLoadingPublicationDetails(false)
      return
    }

    setIsLoadingPublicationDetails(true)
    void (async () => {
      const details = await fetchPublicationDetails()

      if (isCancelled) {
        return
      }

      setPublicationDetails(details)
      setIsLoadingPublicationDetails(false)
    })()

    return () => {
      isCancelled = true
    }
  }, [fetchPublicationDetails, open])

  const handlePublish = useCallback<
    Required<ComponentProps<typeof PublishDialog>>['onSubmit']
  >(
    async (submission) => {
      const wasmInstance = await kclManager.wasmInstancePromise
      const published = await publishCurrentProject({
        token,
        project,
        currentFilePath: kclManager.path,
        currentFileContents: kclManager.code,
        wasmInstance,
        submission,
      })

      if (!published) {
        return false
      }

      const details = await fetchPublicationDetails()
      setPublicationDetails(details)
      if (details) {
        setSubmittedProjectStatus({
          projectId: project?.cloudProjectId,
          status: {
            publicationStatus: details.publicationStatus,
            feedback:
              details.publicationStatus ===
              fetchedProjectStatus?.publicationStatus
                ? fetchedProjectStatus.feedback
                : undefined,
          },
        })
      }
      return true
    },
    [fetchPublicationDetails, fetchedProjectStatus, kclManager, project, token]
  )

  return (
    <>
      <Popover.Button
        type="button"
        disabled={buttonDisabled}
        className={`relative inline-flex min-w-max items-center gap-1 border py-0 pl-0.5 pr-2 transition-colors focus-visible:outline-appForeground active:border-primary disabled:cursor-wait disabled:opacity-70 ${
          buttonPresentation.highlight
            ? 'border-warn-80 bg-warn-10/60 text-warn-90 hover:bg-warn-20 dark:border-warn-40 dark:bg-warn-80/30 dark:text-warn-10 dark:hover:bg-warn-80/50'
            : 'border-chalkboard-30 bg-chalkboard-10/80 text-chalkboard-100 hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100'
        }`}
        data-testid="publish-button"
      >
        <CustomIcon
          name={buttonPresentation.icon}
          className="h-5 w-5"
          aria-hidden="true"
          data-testid="publish-button-icon"
          data-icon={buttonPresentation.icon}
        />
        <span className="flex-1">{buttonPresentation.label}</span>
      </Popover.Button>
      {open && (
        <PublishDialog
          onSubmit={handlePublish}
          initialTitle={''}
          publishDisabled={isCheckingUser || publishRequiresUsername}
          publishRequiresUsername={publishRequiresUsername}
          accountUrl={accountUrl}
          publicationDetails={publicationDetails}
          isLoadingPublicationDetails={isLoadingPublicationDetails}
          markdownEditorKeymap={markdownEditorKeymap}
          projectStatus={projectStatus}
        />
      )}
    </>
  )
}

const aquariumStatusIcons = {
  private: 'share',
  draft: 'share',
  pending_review: 'eyeOpen',
  published: 'checkmark',
  rejected: 'close',
  deleted: 'share',
  changes_requested: 'triangleExclamation',
} satisfies Record<ProjectStatus['publicationStatus'], CustomIconName>

function getPublishButtonPresentation(projectStatus: ProjectStatus | null): {
  label: string
  icon: CustomIconName
  highlight: boolean
} {
  const aquariumStatus = getAquariumStatusBadge(projectStatus)

  if (!projectStatus || !aquariumStatus) {
    return {
      label: 'Publish',
      icon: 'share',
      highlight: false,
    }
  }

  return {
    label: aquariumStatus.label,
    icon: aquariumStatusIcons[projectStatus.publicationStatus],
    highlight: projectStatus.publicationStatus === 'changes_requested',
  }
}
