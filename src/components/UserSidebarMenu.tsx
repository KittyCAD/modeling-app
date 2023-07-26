import { Popover } from '@headlessui/react'
import { User } from '../useStore'
import { ActionButton } from './ActionButton'
import { faGear } from '@fortawesome/free-solid-svg-icons'

const UserSidebarMenu = ({ user }: { user: User }) => {
  return (
    <Popover className="relative">
      <Popover.Button className="rounded-full border border-chalkboard-70 hover:border-liquid-50 overflow-hidden">
        <img
          src={user?.image || ''}
          alt={user?.name || ''}
          className="h-8 w-8"
        />
      </Popover.Button>
      <Popover.Overlay className="fixed z-20 inset-0 bg-chalkboard-110/50" />

      <Popover.Panel className="fixed inset-0 left-auto z-30 w-64 bg-chalkboard-10 border border-liquid-100 shadow-md rounded-l-lg">
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
        <div className="p-4">
          <ActionButton
            as="link"
            icon={{ icon: faGear }}
            to="/settings"
            className="border-transparent"
          >
            Settings
          </ActionButton>
        </div>
      </Popover.Panel>
    </Popover>
  )
}

export default UserSidebarMenu
