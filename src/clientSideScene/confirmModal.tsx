import { Fragment } from 'react'
import { create, type InstanceProps } from 'react-modal-promise'

import { Dialog, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'

type ConfirmModalProps = InstanceProps<boolean, boolean> & { text: string }

export const ConfirmModal = ({
  isOpen,
  onResolve,
  onReject,
  text,
}: ConfirmModalProps) => {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10"
        onClose={() => onResolve(false)}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="rounded relative mx-auto px-4 py-8 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
                <div>{text}</div>
                <div className="mt-8 flex justify-between">
                  <ActionButton
                    Element="button"
                    onClick={() => onResolve(true)}
                  >
                    Continue and unconstrain
                  </ActionButton>
                  <ActionButton
                    Element="button"
                    onClick={() => onReject(false)}
                  >
                    Cancel
                  </ActionButton>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export const confirmModal = create<ConfirmModalProps, boolean, boolean>(
  ConfirmModal
)
