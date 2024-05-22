import { faTrashAlt } from '@fortawesome/free-solid-svg-icons'
import { Dialog } from '@headlessui/react'
import { ActionButton } from 'components/ActionButton'

interface DeleteProjectDialogProps {
  projectName: string
  onConfirm: () => void
  onDismiss: () => void
}

export function DeleteProjectDialog({
  projectName,
  onConfirm,
  onDismiss,
}: DeleteProjectDialogProps) {
  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center">
        <Dialog.Panel className="max-w-2xl p-4 border rounded bg-chalkboard-10 dark:bg-chalkboard-100 border-destroy-80">
          <Dialog.Title as="h2" className="mb-4 text-2xl font-bold">
            Delete File
          </Dialog.Title>
          <Dialog.Description>
            This will permanently delete "{projectName || 'this file'}
            ".
          </Dialog.Description>

          <p className="my-4">
            Are you sure you want to delete "{projectName || 'this file'}
            "? This action cannot be undone.
          </p>

          <div className="flex justify-between">
            <ActionButton
              Element="button"
              onClick={onConfirm}
              iconStart={{
                icon: faTrashAlt,
                bgClassName: 'bg-destroy-80',
                className: 'p-1',
                size: 'sm',
                iconClassName: '!text-destroy-70 dark:!text-destroy-40',
              }}
              className="hover:border-destroy-40 dark:hover:border-destroy-40"
            >
              Delete
            </ActionButton>
            <ActionButton Element="button" onClick={onDismiss}>
              Cancel
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
