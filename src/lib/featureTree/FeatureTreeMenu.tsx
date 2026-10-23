import { Menu } from '@headlessui/react'

import { useApp } from '@src/lib/boot'

import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'

export const FeatureTreeMenu = () => {
  const { commands } = useApp()
  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() =>
            commands.send({
              type: 'Find and select command',
              data: {
                groupId: 'code',
                name: 'parameter.create',
              },
            })
          }
          className="menuButton"
        >
          <span>Create parameter</span>
        </button>
      </Menu.Item>
      <Menu.Item>
        <button
          type="button"
          onClick={() =>
            commands.send({
              type: 'Find and select command',
              data: {
                groupId: 'code',
                name: 'Import',
              },
            })
          }
          className="menuButton"
        >
          <span>Import from a file</span>
        </button>
      </Menu.Item>
    </HeaderMenu>
  )
}
