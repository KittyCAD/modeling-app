import { Popover, Transition } from '@headlessui/react'
import type { User } from '@kittycad/lib'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { ActionButtonProps } from '@src/components/ActionButton'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import env from '@src/env'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import usePlatform from '@src/hooks/usePlatform'
import { listAllEnvironmentsWithTokens } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { authActor } from '@src/lib/singletons'
import { commandBarActor } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

let didListEnvironments = false

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const platform = usePlatform()
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const displayedName = getDisplayName(user)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const navigate = useNavigate()
  const send = authActor.send
  const fullEnvironmentName = env().VITE_ZOO_BASE_DOMAIN
  const [hasMultipleEnvironments, setHasMultipleEnvironments] = useState(false)

  useEffect(() => {
    if (!didListEnvironments) {
      didListEnvironments = true
      if (window.electron) {
        listAllEnvironmentsWithTokens(window.electron)
          .then((environmentsWithTokens) => {
            setHasMultipleEnvironments(environmentsWithTokens.length > 1)
          })
          .catch(reportRejection)
      }
    }
  }, [])

  // Do not show the environment items on web
  const hideEnvironmentItems = !isDesktop()

  // We filter this memoized list so that no orphan "break" elements are rendered.
  const userMenuItems = useMemo<(ActionButtonProps | 'break')[]>(
    () =>
      [
        {
          id: 'account',
          Element: 'externalLink',
          to: withSiteBaseURL('/account'),
          children: (
            <>
              <span className="flex-1">Manage Zoo account</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
        },
        {
          id: 'settings',
          Element: 'button',
          children: (
            <>
              <span className="flex-1">User settings</span>
              <kbd className="hotkey">{`${platform === 'macos' ? '⌘' : 'Ctrl'}${
                isDesktop() ? '' : '⬆'
              },`}</kbd>
            </>
          ),
          'data-testid': 'user-settings',
          onClick: () => {
            const targetPath = location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.SETTINGS_USER
              : PATHS.HOME + PATHS.SETTINGS_USER
            navigate(targetPath)
          },
        },
        {
          id: 'keybindings',
          Element: 'button',
          children: 'Keyboard shortcuts',
          onClick: () => {
            const targetPath = location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.SETTINGS_KEYBINDINGS
              : PATHS.HOME + PATHS.SETTINGS_KEYBINDINGS
            navigate(targetPath)
          },
        },
        'break',
        {
          id: 'request-feature',
          Element: 'externalLink',
          to: 'https://github.com/KittyCAD/modeling-app/discussions',
          children: (
            <>
              <span className="flex-1">Request a feature</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
        },
        {
          id: 'report-bug',
          Element: 'externalLink',
          to: 'https://github.com/KittyCAD/modeling-app/issues/new/choose',
          children: (
            <>
              <span className="flex-1">Report a bug</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
        },
        {
          id: 'community',
          Element: 'externalLink',
          to: 'https://discord.gg/JQEpHR7Nt2',
          children: (
            <>
              <span className="flex-1">Ask the community</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
        },
        {
          id: 'release-notes',
          Element: 'externalLink',
          to: 'https://github.com/KittyCAD/modeling-app/releases',
          children: (
            <>
              <span className="flex-1">Release notes</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
        },
        {
          id: 'check-for-updates',
          Element: 'button',
          hide: !isDesktop(),
          onClick: () => {
            window.electron?.appCheckForUpdates().catch(reportRejection)
          },
          children: <span className="flex-1">Check for updates</span>,
        },
        'break',
        {
          id: 'change-environment',
          Element: 'button',
          children: <span>Change environment</span>,
          onClick: () => {
            const environment = env().VITE_ZOO_BASE_DOMAIN
            if (environment) {
              commandBarActor.send({
                type: 'Find and select command',
                data: {
                  groupId: 'application',
                  name: 'switch-environments',
                  argDefaultValues: {
                    environment,
                  },
                },
              })
            }
          },
          className: hideEnvironmentItems ? 'hidden' : '',
        },
        {
          id: 'sign-out',
          Element: 'button',
          'data-testid': 'user-sidebar-sign-out',
          children: (
            <span>
              Sign out{hideEnvironmentItems ? '' : ` of ${fullEnvironmentName}`}
            </span>
          ),
          onClick: () => send({ type: 'Log out' }),
          className: '', // Just making TS's filter type coercion happy 😠
        },
        {
          id: 'sign-out-all',
          Element: 'button',
          'data-testid': 'user-sidebar-sign-out',
          children: <span>Sign out of all environments</span>,
          onClick: () => send({ type: 'Log out all' }),
          className:
            hideEnvironmentItems || !hasMultipleEnvironments ? 'hidden' : '',
        },
      ].filter(
        (props) =>
          props === 'break' ||
          (typeof props !== 'string' && !props.className?.includes('hidden'))
      ) as (ActionButtonProps | 'break')[],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [platform, location, filePath, navigate, send, hasMultipleEnvironments]
  )

  // This image host goes down sometimes. We will instead rewrite the
  // resource to be a local one.
  if (user?.image === 'https://placekitten.com/200/200') {
    user.image = '/cat.jpg'
  }

  // Fallback logic for displaying user's "name":
  // 1. user.name
  // 2. user.first_name + ' ' + user.last_name
  // 3. user.first_name
  // 4. user.email
  function getDisplayName(user?: User) {
    if (!user) return null
    if (user.name) return user.name
    if (user.first_name) {
      if (user.last_name) return user.first_name + ' ' + user.last_name
      return user.first_name
    }
    return user.email
  }

  return (
    <Popover className="relative grid">
      <Popover.Button
        className="m-0 relative group/avatar border-0 w-fit min-w-max p-0 rounded-sm focus-visible:outline-2 hover:bg-transparent"
        data-testid="user-sidebar-toggle"
      >
        <div className="flex items-center">
          <div className="avatar">
            {user?.image && !imageLoadFailed ? (
              <img
                src={user?.image || ''}
                alt={user?.name || ''}
                className="h-6 w-6"
                referrerPolicy="no-referrer"
                onError={() => setImageLoadFailed(true)}
              />
            ) : (
              <CustomIcon
                name="person"
                className="w-6 h-6 text-chalkboard-70 dark:text-chalkboard-40 bg-chalkboard-20 dark:bg-chalkboard-80"
              />
            )}
          </div>
          <CustomIcon
            name="caretDown"
            className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40 ui-open:rotate-180"
          />
        </div>
        <Tooltip position="bottom-right" hoverOnly>
          User menu
        </Tooltip>
      </Popover.Button>
      <Transition
        enter="duration-100 ease-out"
        enterFrom="opacity-0 -translate-y-2"
        enterTo="opacity-100 translate-y-0"
        as={Fragment}
      >
        <Popover.Panel
          data-testid="user-dropdown"
          className={`z-10 absolute top-full right-0 mt-1 pb-1 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
          shadow-lg`}
        >
          {({ close }) => (
            <>
              {user && (
                <div className="flex flex-col gap-1 px-2.5 py-3 bg-chalkboard-20 dark:bg-chalkboard-80/50">
                  <p className="m-0 text-mono text-xs" data-testid="username">
                    {displayedName || ''}
                  </p>
                  {displayedName !== user.email && (
                    <p
                      className="m-0 overflow-ellipsis overflow-hidden text-chalkboard-70 dark:text-chalkboard-40 text-xs"
                      data-testid="email"
                    >
                      {user.email}
                    </p>
                  )}
                </div>
              )}
              <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
                {userMenuItems.map((props, index) => {
                  if (props === 'break') {
                    return index !== userMenuItems.length - 1 ? (
                      <li key={`break-${index}`} className="contents">
                        <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
                      </li>
                    ) : null
                  }

                  const { id, children, ...rest } = props
                  return (
                    <li key={id} className="contents">
                      <ActionButton
                        {...rest}
                        className="!font-sans flex items-center gap-2 rounded-sm py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 !border-none text-left focus-visible:outline-appForeground"
                        onMouseUp={() => {
                          close()
                        }}
                      >
                        {children}
                      </ActionButton>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default UserSidebarMenu
