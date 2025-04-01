import { Popover, Transition } from '@headlessui/react'
import { ActionButton, ActionButtonProps } from './ActionButton'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fragment, useMemo, useState } from 'react'
import { PATHS } from 'lib/paths'
import { Models } from '@kittycad/lib'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import Tooltip from './Tooltip'
import usePlatform from 'hooks/usePlatform'
import { isDesktop } from 'lib/isDesktop'
import { CustomIcon } from './CustomIcon'
import { authActor } from 'machines/appMachine'

type User = Models['User_type']

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const platform = usePlatform()
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const displayedName = getDisplayName(user)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const navigate = useNavigate()
  const send = authActor.send

  // We filter this memoized list so that no orphan "break" elements are rendered.
  const userMenuItems = useMemo<(ActionButtonProps | 'break')[]>(
    () =>
      [
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
        {
          id: 'account',
          Element: 'externalLink',
          to: 'https://zoo.dev/account',
          children: (
            <>
              <span className="flex-1">Manage account</span>
              <CustomIcon
                name="link"
                className="w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
              />
            </>
          ),
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
        'break',
        {
          id: 'sign-out',
          Element: 'button',
          'data-testid': 'user-sidebar-sign-out',
          children: 'Sign out',
          onClick: () => send({ type: 'Log out' }),
          className: '', // Just making TS's filter type coercion happy 😠
        },
      ].filter(
        (props) =>
          props === 'break' ||
          (typeof props !== 'string' && !props.className?.includes('hidden'))
      ) as (ActionButtonProps | 'break')[],
    [platform, location, filePath, navigate, send]
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
    <Popover className="relative">
      <Popover.Button
        className="relative group border-0 w-fit min-w-max p-0 rounded-l-full focus-visible:outline-appForeground"
        data-testid="user-sidebar-toggle"
      >
        <div className="flex items-center">
          <div className="rounded-full border overflow-hidden">
            {user?.image && !imageLoadFailed ? (
              <img
                src={user?.image || ''}
                alt={user?.name || ''}
                className="h-7 w-7 rounded-full"
                referrerPolicy="no-referrer"
                onError={() => setImageLoadFailed(true)}
              />
            ) : (
              <CustomIcon
                name="person"
                className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40 bg-chalkboard-20 dark:bg-chalkboard-80"
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
