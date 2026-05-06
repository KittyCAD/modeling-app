import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ShareDialog } from '@src/components/ShareDialog'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { useApp, useSingletons } from '@src/lib/boot'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { copyFileShareLink } from '@src/lib/links'
import { useSignals } from '@preact/signals-react/runtime'
import { memo, type RefObject, useCallback, useRef } from 'react'
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
  useSignals()
  const app = useApp()
  const { auth, billing } = app
  const { kclManager } = useSingletons()
  const token = auth.useToken()
  const billingContext = billing.useContext()
  const currentProject = app.projectSignal.value?.projectIORefSignal.value
  const allowOrgRestrict = !!billingContext.isOrg
  const allowPassword = !!billingContext.hasSubscription
  const ast = kclManager.astSignal.value
  const shareDisabled = ast.body.some((n) => n.type === 'ImportStatement')

  const onCopyShareLink = useCallback(
    async ({
      isRestrictedToOrg,
      password,
    }: {
      isRestrictedToOrg: boolean
      password: string
    }) => {
      return copyFileShareLink({
        token,
        code: kclManager.code,
        name: currentProject?.name || '',
        isRestrictedToOrg,
        password: password || undefined,
      })
    },
    [currentProject, kclManager, token]
  )

  return (
    <>
      <Popover.Button
        ref={shareButtonRef}
        disabled={billingLoading || shareDisabled}
        className="relative inline-flex min-w-max items-center gap-1 rounded-md border border-chalkboard-30 bg-chalkboard-10/80 py-0 pl-0.5 pr-1.5 text-chalkboard-100 transition-colors hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100 focus-visible:outline-appForeground active:border-primary disabled:cursor-wait disabled:opacity-70"
        data-testid="share-button"
      >
        <CustomIcon name="link" className="h-5 w-5" />
        <span className="flex-1">Share</span>
        <Tooltip
          position="bottom-right"
          contentClassName="max-w-none flex items-center gap-4"
          hoverOnly
        >
          <span className="flex-1">
            {billingLoading
              ? 'Loading share options'
              : shareDisabled
                ? `Share links are not currently supported for multi-file assemblies`
                : `Share this project`}
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
          allowOrgRestrict={allowOrgRestrict}
          allowPassword={allowPassword}
          shareDisabled={shareDisabled}
        />
      )}
    </>
  )
}
