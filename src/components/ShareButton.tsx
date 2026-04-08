import { CustomIcon } from '@src/components/CustomIcon'
import { ShareDialog } from '@src/components/ShareDialog'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { useApp, useSingletons } from '@src/lib/boot'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { copyCurrentFileShareLink, publishCurrentProject } from '@src/lib/share'
import { memo, useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

const shareHotkey = 'mod+alt+s'

/** Share Zoo link button shown in the upper-right of the modeling view */
export const ShareButton = memo(function ShareButton() {
  const app = useApp()
  const { auth, billing } = app
  const { kclManager } = useSingletons()
  const platform = usePlatform()
  const token = auth.useToken()

  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const billingContext = billing.useContext()
  const currentProject = app.projectSignal.value?.projectIORefSignal.value

  const allowOrgRestrict = !!billingContext.isOrg
  const billingLoading = billingContext.hasSubscription === undefined

  const onShareClick = useCallback(() => {
    setIsDialogOpen(true)
  }, [])

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

  useHotkeys(shareHotkey, onShareClick, {
    scopes: ['modeling'],
  })

  const ast = kclManager.astSignal.value
  const shareDisabled = ast.body.some((n) => n.type === 'ImportStatement')

  return (
    <>
      <div className="relative hidden sm:flex">
        <button
          type="button"
          onClick={onShareClick}
          disabled={billingLoading}
          className="relative group flex gap-1 items-center py-0 pl-0.5 pr-1.5 rounded-l-full bg-chalkboard-10/80 border border-solid active:border-primary dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100"
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
        </button>
      </div>
      <ShareDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCopyLink={onCopyShareLink}
        onPublish={onPublishProject}
        allowOrgRestrict={allowOrgRestrict}
        shareDisabled={shareDisabled}
      />
    </>
  )
})
