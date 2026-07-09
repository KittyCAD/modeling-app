import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { PublishDialog } from '@src/components/PublishDialog'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  type CurrentProjectPublicationDetails,
  getCurrentProjectPublicationDetails,
  publishCurrentProject,
} from '@src/lib/share'
import { err } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import {
  type ComponentProps,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'

type PublishButtonProps = {
  app: App
}

export const PublishButton = memo(function PublishButton({
  app,
}: PublishButtonProps) {
  useSignals()
  const project = app.projectSignal.value?.projectIORefSignal.value

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
  const [publicationDetails, setPublicationDetails] =
    useState<CurrentProjectPublicationDetails | null>(null)
  const [isLoadingPublicationDetails, setIsLoadingPublicationDetails] =
    useState(false)
  const username = user?.username?.trim() || ''
  const isCheckingUser = authState.matches('checkIfLoggedIn') && !!token
  const publishRequiresUsername = !isCheckingUser && !!token && !username
  const accountUrl = withSiteBaseURL('/account')
  const buttonDisabled = kclEmpty || hasKclErrors

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
      return true
    },
    [fetchPublicationDetails, kclManager, project, token]
  )

  return (
    <>
      <Popover.Button
        type="button"
        disabled={buttonDisabled}
        className="relative inline-flex min-w-max items-center gap-1 rounded-md border border-chalkboard-30 bg-chalkboard-10/80 py-0 pl-0.5 pr-1.5 text-chalkboard-100 transition-colors hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100 focus-visible:outline-appForeground active:border-primary disabled:cursor-wait disabled:opacity-70"
        data-testid="publish-button"
      >
        <CustomIcon name="share" className="h-5 w-5" />
        <span className="flex-1">Publish</span>
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
        />
      )}
    </>
  )
}
