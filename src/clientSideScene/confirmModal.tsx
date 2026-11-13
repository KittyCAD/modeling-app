import { type InstanceProps, create } from 'react-modal-promise'

import { Dialog } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'

type ConfirmModalProps = InstanceProps<boolean, boolean> & { text: string }

export const ConfirmModal = ({
  isOpen,
  onResolve,
  onReject,
  text,
}: ConfirmModalProps) => {
  return (
    <Dialog
      open={isOpen}
      as="div"
      className="relative z-10"
      onClose={() => onResolve(false)}
    >
      <div className="fixed inset-0 bg-black bg-opacity-25" />

      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4 text-center">
          <Dialog.Panel className="rounded relative mx-auto px-4 py-8 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
            <div>{text}</div>
            <div className="mt-8 flex justify-between">
              <ActionButton Element="button" onClick={() => onResolve(true)}>
                Continue and unconstrain
              </ActionButton>
              <ActionButton Element="button" onClick={() => onReject(false)}>
                Cancel
              </ActionButton>
            </div>
          </Dialog.Panel>
        </div>
      </div>
    </Dialog>
  )
}

export const confirmModal = create<ConfirmModalProps, boolean, boolean>(
  ConfirmModal
)
