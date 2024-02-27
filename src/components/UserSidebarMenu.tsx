import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { faBars, faBug, faSignOutAlt } from '@fortawesome/free-solid-svg-icons'
import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fragment, useState } from 'react'
import { paths } from 'lib/paths'
import { Models } from '@kittycad/lib'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'

type User = Models['User_type']

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const displayedName = getDisplayName(user)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const navigate = useNavigate()
  const send = useGlobalStateContext()?.auth?.send

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
      {user?.image && !imageLoadFailed ? (
        <Popover.Button
          className="border-0 rounded-full w-fit min-w-max p-0 group"
          data-testid="user-sidebar-toggle"
        >
          <div className="rounded-full border overflow-hidden">
            <img
              src={user?.image || ''}
              alt={user?.name || ''}
              className="h-8 w-8 rounded-full"
              referrerPolicy="no-referrer"
              onError={() => setImageLoadFailed(true)}
            />
          </div>
        </Popover.Button>
      ) : (
        <ActionButton
          Element={Popover.Button}
          icon={{ icon: faBars }}
          className="border-transparent"
          data-testid="user-sidebar-toggle"
        >
          Menu
        </ActionButton>
      )}
      <Transition
        enter="duration-200 ease-out"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="duration-100 ease-in"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        as={Fragment}
      >
        <Popover.Overlay className="fixed z-20 inset-0 bg-chalkboard-110/50" />
      </Transition>

      <Transition
        enter="duration-100 ease-out"
        enterFrom="opacity-0 translate-x-1/4"
        enterTo="opacity-100 translate-x-0"
        leave="duration-75 ease-in"
        leaveFrom="opacity-100 translate-x-0"
        leaveTo="opacity-0 translate-x-4"
        as={Fragment}
      >
        <Popover.Panel className="fixed inset-0 left-auto z-30 w-64 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-30 dark:border-chalkboard-80 shadow-md rounded-l-md overflow-hidden">
          {({ close }) => (
            <>
              {user && (
                <div className="flex items-center gap-4 px-4 py-3 bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-b border-b-chalkboard-30 dark:border-b-chalkboard-80">
                  {user.image && !imageLoadFailed && (
                    <div className="rounded-full shadow-inner overflow-hidden">
                      <img
                        src={user.image}
                        alt={user.name || ''}
                        className="h-8 w-8"
                        referrerPolicy="no-referrer"
                        onError={() => setImageLoadFailed(true)}
                      />
                    </div>
                  )}

                  <div>
                    <p className="m-0 text-mono" data-testid="username">
                      {displayedName || ''}
                    </p>
                    {displayedName !== user.email && (
                      <p
                        className="m-0 text-chalkboard-70 dark:text-chalkboard-40 text-xs"
                        data-testid="email"
                      >
                        {user.email}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="p-4 flex flex-col gap-2">
                <ActionButton
                  Element="button"
                  icon={{ icon: 'settings' }}
                  className="border-transparent dark:border-transparent hover:bg-transparent"
                  onClick={() => {
                    // since /settings is a nested route the sidebar doesn't close
                    // automatically when navigating to it
                    close()
                    const targetPath = location.pathname.includes(paths.FILE)
                      ? filePath + paths.SETTINGS
                      : paths.HOME + paths.SETTINGS
                    navigate(targetPath)
                  }}
                  data-testid="settings-button"
                >
                  Settings
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://github.com/KittyCAD/modeling-app/discussions"
                  icon={{ icon: faGithub, className: 'p-1', size: 'sm' }}
                  className="border-transparent dark:border-transparent"
                >
                  Request a feature
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://github.com/KittyCAD/modeling-app/issues/new/choose"
                  icon={{ icon: faBug, className: 'p-1', size: 'sm' }}
                  className="border-transparent dark:border-transparent"
                >
                  Report a bug
                </ActionButton>
                <ActionButton
                  Element="button"
                  onClick={() => send('Log out')}
                  icon={{
                    icon: faSignOutAlt,
                    className: 'p-1',
                    bgClassName: 'bg-destroy-80',
                    size: 'sm',
                    iconClassName:
                      'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
                  }}
                  className="border-transparent dark:border-transparent hover:border-destroy-40 dark:hover:border-destroy-60 hover:bg-destroy-10/20 dark:hover:bg-destroy-80/20"
                  data-testid="user-sidebar-sign-out"
                >
                  Sign out
                </ActionButton>
              </div>
            </>
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default UserSidebarMenu
