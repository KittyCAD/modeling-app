import { Popover } from '@headlessui/react'
import { User, useStore } from '../useStore'
import { ActionButton } from './ActionButton'
import { faBars, faGear, faSignOutAlt } from '@fortawesome/free-solid-svg-icons'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const navigate = useNavigate()
  const { setToken } = useStore((s) => ({
    setToken: s.setToken,
  }))

  // Fallback logic for displaying user's name:
  // 1. user.name
  // 2. user.first_name + ' ' + user.last_name
  // 3. user.first_name
  // 4. user.email
  const displayedName = user
    ? user.name
      ? user.name
      : user.first_name
      ? user.last_name
        ? user.first_name + ' ' + user.last_name
        : user.first_name
      : user.email
    : ''

  return (
    <Popover className="relative">
      {user?.image && !imageLoadFailed ? (
        <Popover.Button
          className="border-0 rounded-full w-fit p-0"
          data-testid="user-sidebar-toggle"
        >
          <div className="rounded-full border border-chalkboard-70/50 hover:border-liquid-50 overflow-hidden">
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
      <Popover.Overlay className="fixed z-20 inset-0 bg-chalkboard-110/50" />

      <Popover.Panel className="fixed inset-0 left-auto z-30 w-64 bg-chalkboard-10 dark:bg-chalkboard-100 border border-liquid-100 shadow-md rounded-l-lg">
        {user && (
          <div className="flex items-center gap-4 px-4 py-3 bg-liquid-100">
            {user.image && !imageLoadFailed && (
              <div className="rounded-full shadow-inner overflow-hidden">
                <img
                  src={user?.image || ''}
                  alt={user?.name || ''}
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
                {displayedName}
              </p>
              {displayedName !== user.email && (
                <p className="m-0 text-liquid-40 text-xs" data-testid="email">
                  {user.email}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="p-4 flex flex-col gap-2">
          <ActionButton
            Element="link"
            icon={{ icon: faGear }}
            to="/settings"
            className="border-transparent dark:border-transparent dark:hover:border-liquid-60"
          >
            Settings
          </ActionButton>
          <ActionButton
            Element="button"
            onClick={() => {
              setToken('')
              navigate('/signin')
            }}
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
      </Popover.Panel>
    </Popover>
  )
}

export default UserSidebarMenu
