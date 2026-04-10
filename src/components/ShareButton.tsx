import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ShareDialog } from '@src/components/ShareDialog'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { useApp, useSingletons } from '@src/lib/boot'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import {
  copyCurrentFileShareLink,
  type CurrentProjectPublicationDetails,
  getCurrentProjectPublicationDetails,
  publishCurrentProject,
} from '@src/lib/share'
import { err } from '@src/lib/trap'
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

const shareHotkey = 'mod+alt+s'

/** Share Zoo link button shown in the upper-right of the modeling view */
export const ShareButton = memo(function ShareButton() {
  const app = useApp()
  const { billing } = app
  const platform = usePlatform()

  const billingContext = billing.useContext()
  const billingLoading = billingContext.hasSubscription === undefined
  const shareButtonRef = useRef<HTMLButtonElement>(null)

  const onShareClick = useCallback(() => {
    shareButtonRef.current?.click()
  }, [])

  useHotkeys(shareHotkey, onShareClick, {
    scopes: ['modeling'],
  })

  return (
    <Popover className="relative hidden sm:flex">
      {(popover) => {
        return (
          <SharePopoverContent
            billingLoading={billingLoading}
            shareButtonRef={shareButtonRef}
            close={() => popover.close()}
            open={popover.open}
            platform={platform}
          />
        )
      }}
    </Popover>
  )
})

function SharePopoverContent({
  billingLoading,
  shareButtonRef,
  close,
  open,
  platform,
}: {
  billingLoading: boolean
  shareButtonRef: RefObject<HTMLButtonElement | null>
  close: () => void
  open: boolean
  platform: ReturnType<typeof usePlatform>
}) {
  const app = useApp()
  const { auth, billing } = app
  const { kclManager } = useSingletons()
  const token = auth.useToken()
  const billingContext = billing.useContext()
  const currentProject = app.projectSignal.value?.projectIORefSignal.value
  const allowOrgRestrict = !!billingContext.isOrg
  const ast = kclManager.astSignal.value
  const shareDisabled = ast.body.some((n) => n.type === 'ImportStatement')

  const [publicationDetails, setPublicationDetails] =
    useState<CurrentProjectPublicationDetails | null>(null)
  const [isLoadingPublicationDetails, setIsLoadingPublicationDetails] =
    useState(false)

  const onCopyShareLink = useCallback(
    async ({ isRestrictedToOrg }: { isRestrictedToOrg: boolean }) => {
      const wasmInstance = await kclManager.wasmInstancePromise

      return copyCurrentFileShareLink({
        token,
        project: currentProject,
        currentFilePath: kclManager.path,
        currentFileContents: kclManager.code,
        wasmInstance,
        isRestrictedToOrg,
      })
    },
    [currentProject, kclManager, token]
  )

  const onPublishProject = useCallback(async () => {
    const wasmInstance = await kclManager.wasmInstancePromise

    return publishCurrentProject({
      token,
      project: currentProject,
      currentFilePath: kclManager.path,
      currentFileContents: kclManager.code,
      wasmInstance,
    })
  }, [currentProject, kclManager, token])

  useEffect(() => {
    let isCancelled = false

    if (!open) {
      setPublicationDetails(null)
      setIsLoadingPublicationDetails(false)
      return
    }

    if (!token || !currentProject) {
      setPublicationDetails(null)
      setIsLoadingPublicationDetails(false)
      return
    }

    setIsLoadingPublicationDetails(true)
    void (async () => {
      const wasmInstance = await kclManager.wasmInstancePromise
      if (isCancelled) {
        return
      }

      const details = await getCurrentProjectPublicationDetails({
        token,
        project: currentProject,
        wasmInstance,
      })

      if (isCancelled) {
        return
      }

      if (err(details)) {
        console.error('Failed to load project publication details', details)
        setPublicationDetails(null)
      } else {
        setPublicationDetails(details)
      }

      setIsLoadingPublicationDetails(false)
    })()

    return () => {
      isCancelled = true
    }
  }, [currentProject, kclManager, open, token])

  return (
    <>
      <Popover.Button
        ref={shareButtonRef}
        disabled={billingLoading}
        className="relative group border-0 w-fit min-w-max p-0 rounded-l-full focus-visible:outline-appForeground flex gap-1 items-center py-0 pl-0.5 pr-1.5 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid active:border-primary"
        data-testid="share-button"
      >
        <CustomIcon name="link" className="w-5 h-5" />
        <span className="flex-1">Share</span>
        <Tooltip
          position="bottom-right"
          contentClassName="max-w-none flex items-center gap-4"
        >
          <span className="flex-1">
            {billingLoading
              ? 'Loading share options'
              : shareDisabled
                ? `Share links are not currently supported for multi-file assemblies, but you can still publish this project`
                : `Share or publish this project`}
          </span>
          {!billingLoading && (
            <kbd className="hotkey text-xs capitalize">
              {hotkeyDisplay(shareHotkey, platform)}
            </kbd>
          )}
        </Tooltip>
      </Popover.Button>
      {open && (
        <ShareDialog
          onClose={close}
          onCopyLink={onCopyShareLink}
          onPublish={onPublishProject}
          allowOrgRestrict={allowOrgRestrict}
          shareDisabled={shareDisabled}
          publicationDetails={publicationDetails}
          isLoadingPublicationDetails={isLoadingPublicationDetails}
        />
      )}
    </>
  )
}
