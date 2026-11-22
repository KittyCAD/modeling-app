import { Popover } from '@headlessui/react'
import { getAquariumStatusBadge } from '@src/components/AquariumStatusBadge'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import {
  PublishDialog,
  type PublishDialogMarkdownEditorKeymap,
} from '@src/components/PublishDialog'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
import type {
  CurrentProjectPublicationDetails,
  ProjectPublishSubmission,
} from '@src/lib/publishing/publication'
import type { PublicationWorkflow } from '@src/lib/publishing/workflow'
import { err } from '@src/lib/trap'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

/** Publication UI receives account state and a source-bound workflow, without legacy services. */
export interface PublishControlProps {
  workflow: PublicationWorkflow
  disabled: boolean
  isCheckingUser: boolean
  publishRequiresUsername: boolean
  willCloneProjectToCloud: boolean
  accountUrl: string
  projectStatus: ProjectStatus | null
  markdownEditorKeymap?: PublishDialogMarkdownEditorKeymap
}

export function PublishControl(props: PublishControlProps) {
  return (
    <Popover className="relative hidden sm:flex">
      {({ open }) => <PublishPopoverContent {...props} open={open} />}
    </Popover>
  )
}

function PublishPopoverContent({
  workflow,
  disabled,
  isCheckingUser,
  publishRequiresUsername,
  willCloneProjectToCloud,
  accountUrl,
  projectStatus: fetchedProjectStatus,
  markdownEditorKeymap,
  open,
}: PublishControlProps & { open: boolean }) {
  const [publicationDetails, setPublicationDetails] =
    useState<CurrentProjectPublicationDetails | null>(null)
  const [isLoadingPublicationDetails, setIsLoadingPublicationDetails] =
    useState(false)
  const [submitted, setSubmitted] = useState<{
    workflow: PublicationWorkflow
    status: ProjectStatus
  } | null>(null)
  const activeWorkflow = useRef<PublicationWorkflow | undefined>(workflow)
  const requestVersion = useRef(0)
  const submissionVersion = useRef(0)
  useEffect(() => {
    activeWorkflow.current = workflow
    return () => {
      activeWorkflow.current = undefined
    }
  }, [workflow])
  const projectStatus =
    submitted?.workflow === workflow ? submitted.status : fetchedProjectStatus
  const buttonPresentation = getPublishButtonPresentation(projectStatus)
  useEffect(() => {
    let active = true
    const request = ++requestVersion.current
    setPublicationDetails(null)
    setIsLoadingPublicationDetails(open)
    if (open) {
      void (async () => {
        try {
          const details = await workflow.loadDetails()
          if (active && request === requestVersion.current)
            setPublicationDetails(err(details) ? null : details)
        } catch (error) {
          console.error('Failed to load project publication details', error)
        } finally {
          if (active && request === requestVersion.current)
            setIsLoadingPublicationDetails(false)
        }
      })()
    }
    return () => {
      active = false
    }
  }, [workflow, open])
  const handlePublish = async (submission: ProjectPublishSubmission) => {
    const submissionRequest = ++submissionVersion.current
    ++requestVersion.current
    setIsLoadingPublicationDetails(false)
    const result = await workflow
      .submit(submission)
      .catch((error: unknown) =>
        error instanceof Error
          ? error
          : new Error('Publishing the project failed.')
      )
    if (err(result)) {
      toast.error(result.message, { duration: 5000 })
      return false
    }
    if (!result) return false
    if (
      activeWorkflow.current !== workflow ||
      submissionRequest !== submissionVersion.current
    )
      return true
    ++requestVersion.current
    setIsLoadingPublicationDetails(false)
    const details = err(result.details) ? null : result.details
    setPublicationDetails(details)
    if (details)
      setSubmitted({
        workflow,
        status: {
          publicationStatus: details.publicationStatus,
          feedback:
            details.publicationStatus ===
            fetchedProjectStatus?.publicationStatus
              ? fetchedProjectStatus.feedback
              : undefined,
        },
      })
    return true
  }
  return (
    <>
      <Popover.Button
        type="button"
        disabled={disabled}
        className={`relative inline-flex min-w-max items-center gap-1 border py-0 pl-0.5 pr-2 focus-visible:outline-appForeground active:border-primary disabled:cursor-wait disabled:opacity-70 ${buttonPresentation.highlight ? 'border-warn-80 bg-warn-10/60 text-warn-90 hover:bg-warn-20 dark:border-warn-40 dark:bg-warn-80/30 dark:text-warn-10 dark:hover:bg-warn-80/50' : 'border-chalkboard-30 bg-chalkboard-10/80 text-chalkboard-100 hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100'}`}
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
          willCloneProjectToCloud={willCloneProjectToCloud}
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
