import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { faBars, faGear, faSignOutAlt } from '@fortawesome/free-solid-svg-icons'
import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fragment, useState } from 'react'
import { paths } from '../Router'
import makeUrlPathRelative from '../lib/makeUrlPathRelative'
import { Models } from '@kittycad/lib'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

type User = Models['User_type']

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const location = useLocation()
  const displayedName = getDisplayName(user)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const navigate = useNavigate()
  const {
    auth: { send },
  } = useGlobalStateContext()

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
          className="border-0 rounded-full w-fit min-w-max p-0 focus:outline-none group"
          data-testid="user-sidebar-toggle"
        >
          <div className="rounded-full border border-chalkboard-70/50 hover:border-liquid-50 group-focus:border-liquid-50 overflow-hidden">
            <img
              src={user?.image || ''}
              alt={user?.name || ''}
              className="h-8 w-8"
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
        <Popover.Panel className="fixed inset-0 left-auto z-30 w-64 bg-chalkboard-10 dark:bg-chalkboard-100 border border-liquid-100 dark:border-liquid-100/50 shadow-md rounded-l-lg overflow-hidden">
          {({ close }) => (
            <>
              {user && (
                <div className="flex items-center gap-4 px-4 py-3 bg-liquid-100">
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
                    <p
                      className="m-0 text-liquid-10 text-mono"
                      data-testid="username"
                    >
                      {displayedName || ''}
                    </p>
                    {displayedName !== user.email && (
                      <p
                        className="m-0 text-liquid-40 text-xs"
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
                  icon={{ icon: faGear }}
                  className="border-transparent dark:border-transparent dark:hover:border-liquid-60"
                  onClick={() => {
                    // since /settings is a nested route the sidebar doesn't close
                    // automatically when navigating to it
                    close()
                    navigate(
                      (location.pathname.endsWith('/')
                        ? location.pathname.slice(0, -1)
                        : location.pathname) + paths.SETTINGS
                    )
                  }}
                >
                  Settings
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://github.com/KittyCAD/modeling-app/discussions"
                  icon={{ icon: faGithub }}
                  className="border-transparent dark:border-transparent dark:hover:border-liquid-60"
                >
                  Request a feature
                </ActionButton>
                <ActionButton
                  Element="button"
                  onClick={() => send('Log out')}
                  icon={{
                    icon: faSignOutAlt,
                    bgClassName: 'bg-destroy-80',
                    iconClassName:
                      'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
                  }}
                  className="border-transparent dark:border-transparent hover:border-destroy-40 dark:hover:border-destroy-60"
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
