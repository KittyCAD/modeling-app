import { Combobox, Dialog } from '@headlessui/react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { type BaseActionObject } from 'xstate'
import { ActionIcon } from './ActionIcon'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import Fuse from 'fuse.js'

const defaultActions = [
  { type: 'navigate.home' },
  { type: 'navigate.settings' },
  { type: 'navigate.file' },
]

const ActionBar = ({
  actions = defaultActions,
}: {
  actions?: BaseActionObject[]
}) => {
  const [isOpen, setIsOpen] = useState(false)
  useHotkeys('meta+k', () => setIsOpen(!isOpen))
  const [selectedAction, setSelectedAction] = useState()
  const [query, setQuery] = useState('')

  const fuse = new Fuse(actions, {})

  const filteredActions = query === '' ? actions : fuse.search(query)

  return (
    <Dialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      className="relative z-50"
    >
      <Dialog.Backdrop className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="rounded-sm relative p-2 pr-4 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-60 max-w-xl shadow-lg w-full flex gap-2">
          <ActionIcon icon={faSearch} size="lg" />
          <Combobox value={selectedAction} onChange={setSelectedAction}>
            <Combobox.Input
              onChange={(event) => setQuery(event.target.value)}
              className="bg-transparent focus:outline-none"
            />
            <Combobox.Options>
              {filteredActions.map((actionOrResult) => {
                const action = (
                  'item' in actionOrResult
                    ? actionOrResult.item
                    : actionOrResult
                ) as BaseActionObject
                return (
                  <Combobox.Option key={action.type} value={action}>
                    {action.type}
                  </Combobox.Option>
                )
              })}
            </Combobox.Options>
          </Combobox>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export default ActionBar
