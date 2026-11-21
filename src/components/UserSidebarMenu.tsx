import { Popover } from '@headlessui/react'
import type { UserResponse } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  HeaderMenuItems,
  type HeaderMenuItem,
  headerMenuPanelClassName,
} from '@src/components/HeaderMenu'
import Tooltip from '@src/components/Tooltip'
import env from '@src/env'
import usePlatform from '@src/hooks/usePlatform'
import { listAllEnvironmentsWithTokens } from '@src/lib/desktop'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { useEffect, useState } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- Account settings use the route supplied by the header host.
import { useNavigate } from 'react-router-dom'

function externalItem(id: string, label: string, to: string): HeaderMenuItem {
  return {
    id,
    Element: 'externalLink',
    to,
    children: (
      <>
        <span className="flex-1">{label}</span>
        <CustomIcon name="link" className="h-3 w-3 text-2" />
      </>
    ),
  }
}

function displayName(user: UserResponse) {
  return (
    user.name ||
    [user.first_name, user.last_name].filter(Boolean).join(' ') ||
    user.email
  )
}

function UserAvatar({ image }: { image?: string | null }) {
  const [failed, setFailed] = useState(false)
  return image && !failed ? (
    <img
      src={image}
      alt=""
      className="h-6 w-6"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <CustomIcon name="person" className="h-6 w-6 bg-3 text-2" />
  )
}

/** Account actions use an explicit settings route, independent of the active modeling file. */
export default function UserSidebarMenu({
  user,
  settingsBasePath = PATHS.HOME,
  fileOperations,
  onSignOut,
  onSignOutAll,
}: {
  user?: UserResponse
  settingsBasePath?: string
  fileOperations: FileOperationsRegistryService
  onSignOut: () => void
  onSignOutAll: () => void
}) {
  const navigate = useNavigate()
  const platform = usePlatform()
  const desktop = isDesktop()
  const [hasMultipleEnvironments, setHasMultipleEnvironments] = useState(false)
  useEffect(() => {
    if (!desktop) return
    let active = true
    void listAllEnvironmentsWithTokens(fileOperations)
      .then((environments) => {
        if (active) setHasMultipleEnvironments(environments.length > 1)
      })
      .catch(reportRejection)
    return () => {
      active = false
    }
  }, [desktop, fileOperations])

  const name = user ? displayName(user) : undefined
  const image =
    user?.image === 'https://placekitten.com/200/200' ? '/cat.jpg' : user?.image
  const groups: HeaderMenuItem[][] = [
    [
      externalItem(
        'account',
        'Manage Zoo account',
        withSiteBaseURL('/account')
      ),
      {
        id: 'settings',
        Element: 'button',
        'data-testid': 'user-settings',
        children: (
          <>
            <span className="flex-1">User settings</span>
            <kbd className="hotkey">
              {hotkeyDisplay(desktop ? 'mod+,' : 'mod+shift+,', platform)}
            </kbd>
          </>
        ),
        onClick: () => {
          void navigate(settingsBasePath + PATHS.SETTINGS_USER)
        },
      },
      {
        id: 'keybindings',
        Element: 'button',
        children: 'Keyboard shortcuts',
        onClick: () => {
          void navigate(settingsBasePath + PATHS.SETTINGS_KEYBINDINGS)
        },
      },
    ],
    [
      externalItem(
        'request-feature',
        'Request a feature',
        'https://github.com/KittyCAD/modeling-app/discussions'
      ),
      externalItem(
        'report-bug',
        'Report a bug',
        'https://github.com/KittyCAD/modeling-app/issues/new/choose'
      ),
      externalItem(
        'community',
        'Ask the community',
        'https://discord.gg/JQEpHR7Nt2'
      ),
      externalItem(
        'release-notes',
        'Release notes',
        'https://github.com/KittyCAD/modeling-app/releases'
      ),
      ...(desktop
        ? [
            {
              id: 'check-for-updates',
              Element: 'button',
              children: 'Check for updates',
              onClick: () => {
                window.electron?.appCheckForUpdates().catch(reportRejection)
              },
            } satisfies HeaderMenuItem,
          ]
        : []),
    ],
    [
      {
        id: 'sign-out',
        Element: 'button',
        'data-testid': 'user-sidebar-sign-out',
        children: desktop
          ? `Sign out of ${env().VITE_ZOO_BASE_DOMAIN}`
          : 'Sign out',
        onClick: onSignOut,
      },
      ...(desktop && hasMultipleEnvironments
        ? [
            {
              id: 'sign-out-all',
              Element: 'button',
              'data-testid': 'user-sidebar-sign-out',
              children: 'Sign out of all environments',
              onClick: onSignOutAll,
            } satisfies HeaderMenuItem,
          ]
        : []),
    ],
  ]
  return (
    <Popover className="relative grid">
      <Popover.Button
        aria-label="User menu"
        data-testid="user-sidebar-toggle"
        className="relative m-0 flex w-fit min-w-max items-center rounded-sm border-0 p-0 hover:bg-transparent focus-visible:outline-appForeground"
      >
        <UserAvatar key={image} image={image} />
        <CustomIcon
          name="caretDown"
          className="h-4 w-4 text-2 ui-open:rotate-180"
        />
        <Tooltip position="bottom-right" hoverOnly>
          User menu
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        data-testid="user-dropdown"
        className={`${headerMenuPanelClassName} right-0`}
      >
        {({ close }) => (
          <>
            {user && (
              <div className="flex flex-col gap-1 bg-3 px-2.5 py-3">
                <p className="m-0 text-mono text-xs" data-testid="username">
                  {name}
                </p>
                {name !== user.email && (
                  <p
                    className="m-0 truncate text-xs text-2"
                    data-testid="email"
                  >
                    {user.email}
                  </p>
                )}
              </div>
            )}
            <HeaderMenuItems groups={groups} close={close} />
          </>
        )}
      </Popover.Panel>
    </Popover>
  )
}
