import { isErr } from '@src/lib/trap'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { billingActor, commandBarActor } from '@src/lib/singletons'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Popover } from '@headlessui/react'
import { useSelector } from '@xstate/react'
import { useKclContext } from '@src/lang/KclProvider'
import { Tier } from '@src/machines/billingMachine'
import type { SubscriptionsOrError } from '@src/machines/billingMachine'

const shareHotkey = 'mod+alt+s'

const canPasswordProtectShareLinks = (
  subOrErr: undefined | SubscriptionsOrError
): boolean => {
  if (subOrErr === undefined || typeof subOrErr === 'number' || isErr(subOrErr))
    return false
  return subOrErr.modeling_app.share_links[0] === 'password_protected'
}

/** Share Zoo link button shown in the upper-right of the modeling view */
export const ShareButton = () => {
  const platform = usePlatform()

  const [showOptions, setShowOptions] = useState(false)
  const [isRestrictedToOrg, setIsRestrictedToOrg] = useState(false)
  const [password, setPassword] = useState('')

  const billingContext = useSelector(billingActor, ({ context }) => context)

  const allowOrgRestrict = billingContext.tier === Tier.Organization
  const allowPassword = canPasswordProtectShareLinks(
    billingContext.subscriptionsOrError
  )
  const hasOptions = allowOrgRestrict || allowPassword

  // Prevents Organization and Pro tier users from one-click sharing,
  // and give them a chance to set a password and restrict to org.
  const onShareClickFreeOrUnknownRestricted = () => {
    if (hasOptions) {
      setShowOptions(true)
      return
    }

    commandBarActor.send({
      type: 'Find and select command',
      data: {
        name: 'share-file-link',
        groupId: 'code',
        isRestrictedToOrg: false,
      },
    })
  }

  const onShareClickProOrOrganization = () => {
    setShowOptions(false)

    commandBarActor.send({
      type: 'Find and select command',
      data: {
        name: 'share-file-link',
        groupId: 'code',
        isRestrictedToOrg,
        password,
      },
    })
  }

  useHotkeys(shareHotkey, onShareClickFreeOrUnknownRestricted, {
    scopes: ['modeling'],
  })

  const kclContext = useKclContext()

  // It doesn't make sense for the user to be able to click on this
  // until we get what their subscription allows for.
  const disabled =
    kclContext.ast.body.some((n) => n.type === 'ImportStatement') ||
    billingContext.tier === undefined

  return (
    <Popover className="relative flex">
      <Popover.Button className="relative group border-0 w-fit min-w-max p-0 rounded-l-full focus-visible:outline-appForeground">
        <button
          type="button"
          onClick={onShareClickFreeOrUnknownRestricted}
          disabled={disabled}
          className="flex gap-1 items-center py-0 pl-0.5 pr-1.5 m-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid active:border-primary"
          data-testid="share-button"
        >
          <CustomIcon name="link" className="w-5 h-5" />
          <span className="flex-1">Share</span>
          <Tooltip
            position="bottom-right"
            contentClassName="max-w-none flex items-center gap-4"
          >
            <span className="flex-1">
              {disabled
                ? `Share links are not currently supported for multi-file assemblies`
                : `Share part via Zoo link`}
            </span>
            {!disabled && (
              <kbd className="hotkey text-xs capitalize">
                {hotkeyDisplay(shareHotkey, platform)}
              </kbd>
            )}
          </Tooltip>
        </button>
      </Popover.Button>
      {showOptions && (
        <Popover.Panel
          focus={true}
          className={`z-10 absolute top-full right-0 mt-1 pb-1 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
        border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
        shadow-lg`}
        >
          <div className="flex flex-col px-2">
            <div className="flex flex-row gap-1 items-center">
              <CustomIcon name="lockClosed" className="w-6 h-6" />
              <input
                disabled={!allowPassword}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className={`${allowPassword ? 'cursor-pointer' : 'cursor-not-allowed'} text-xs w-full py-1 bg-transparent text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:outline-none focus:ring-0`}
                type="text"
                placeholder="Set a password"
              />
            </div>
            <div>
              <label
                htmlFor="org-only"
                className="pl-1 inline-flex items-center"
              >
                <input
                  disabled={!allowOrgRestrict}
                  checked={isRestrictedToOrg}
                  onChange={(_) => setIsRestrictedToOrg(!isRestrictedToOrg)}
                  type="checkbox"
                  name="org-only"
                  className="form-checkbox"
                />
                <span
                  className={`text-xs ml-2 ${allowOrgRestrict ? 'cursor-pointer' : 'cursor-not-allowed text-chalkboard-50'}`}
                >
                  Org. only access
                </span>
              </label>
              {!allowOrgRestrict && (
                <Tooltip>Upgrade to Organization to use this feature.</Tooltip>
              )}
            </div>
            <button disabled={disabled} onClick={onShareClickProOrOrganization}>
              Generate
            </button>
          </div>
        </Popover.Panel>
      )}
    </Popover>
  )
}
