import { Combobox, Dialog } from '@headlessui/react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { type BaseActionObject } from 'xstate'
import { ActionIcon } from './ActionIcon'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import Fuse from 'fuse.js'

const defaultActions = '_'
  .repeat(13)
  .split('')
  .map((_, i) => ({ type: `action-${i}` }))

const ActionBar = ({
  actions = defaultActions,
}: {
  actions?: BaseActionObject[]
}) => {
  const [isOpen, setIsOpen] = useState(false)
  useHotkeys('meta+k', () => setIsOpen(!isOpen))
  const [selectedAction, setSelectedAction] = useState()
  const [query, setQuery] = useState('')

  const fuse = new Fuse(actions, { keys: ['type'] })

  const filteredActions = query
    ? fuse.search(query)
    : actions.map((a) => ({ item: a }))

  return (
    <Dialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      className="relative z-50"
    >
      <Dialog.Backdrop className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="rounded-sm relative p-2 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
          <Combobox value={selectedAction} onChange={setSelectedAction}>
            <div className="flex gap-2 items-center">
              <ActionIcon icon={faSearch} size="xl" />
              <Combobox.Input
                onChange={(event) => setQuery(event.target.value)}
                className="bg-transparent focus:outline-none"
                onKeyDown={(event) =>
                  event.metaKey && event.key === 'k' && setIsOpen(false)
                }
                displayValue={(action: { item: BaseActionObject }) =>
                  action.item.type
                }
              />
            </div>
            <Combobox.Options className="max-h-96 overflow-y-auto">
              {filteredActions.map((actionResult) => (
                <Combobox.Option
                  key={actionResult.item.type}
                  value={actionResult}
                  className="ui-active:bg-liquid-10 dark:ui-active:bg-liquid-90 py-1 px-2"
                >
                  {actionResult.item.type}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          </Combobox>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export default ActionBar
