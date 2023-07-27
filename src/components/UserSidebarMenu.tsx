import { Popover } from '@headlessui/react'
import { User, useStore } from '../useStore'
import { ActionButton } from './ActionButton'
import { faBars, faGear, faSignOutAlt } from '@fortawesome/free-solid-svg-icons'
import { useNavigate } from 'react-router-dom'
import { A } from '@tauri-apps/api/path-c062430b'

const UserSidebarMenu = ({ user }: { user?: User }) => {
  const navigate = useNavigate()
  const { setToken } = useStore((s) => ({
    setToken: s.setToken,
  }))

  return (
    <Popover className="relative">
      {user?.image ? (
        <Popover.Button>
          <div className="rounded-full border border-chalkboard-70 hover:border-liquid-50 overflow-hidden">
            <img
              src={user?.image || ''}
              alt={user?.name || ''}
              className="h-8 w-8"
            />
          </div>
        </Popover.Button>
      ) : (
        <ActionButton
          Element={Popover.Button}
          icon={{ icon: faBars }}
          className="border-transparent"
        >
          Menu
        </ActionButton>
      )}
      <Popover.Overlay className="fixed z-20 inset-0 bg-chalkboard-110/50" />

      <Popover.Panel className="fixed inset-0 left-auto z-30 w-64 bg-chalkboard-10 border border-liquid-100 shadow-md rounded-l-lg">
        {user && (
          <div className="flex items-center gap-4 px-4 py-3 bg-liquid-100">
            <div className="rounded-full shadow-inner overflow-hidden">
              <img
                src={user?.image || ''}
                alt={user?.name || ''}
                className="h-8 w-8"
              />
            </div>

            <div>
              <p className="m-0 text-liquid-10 text-mono">
                {user.name ||
                  user.first_name + ' ' + user.last_name ||
                  user.email}
              </p>
              {(user.name || user.first_name) && (
                <p className="m-0 text-liquid-40 text-xs">{user.email}</p>
              )}
            </div>
          </div>
        )}
        <div className="p-4 flex flex-col gap-2">
          <ActionButton
            Element="link"
            icon={{ icon: faGear }}
            to="/settings"
            className="border-transparent"
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
            className="border-transparent hover:border-destroy-40"
          >
            Sign out
          </ActionButton>
        </div>
      </Popover.Panel>
    </Popover>
  )
}

export default UserSidebarMenu
