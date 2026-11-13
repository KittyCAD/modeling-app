import { selectCommand } from '@src/lib/commandUtils'
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
            selectCommand(commands, {
              groupId: 'code',
              name: 'parameter.create',
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
            selectCommand(commands, {
              groupId: 'code',
              name: 'Import',
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
