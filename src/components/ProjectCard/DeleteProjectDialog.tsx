import { Dialog } from '@headlessui/react'

import { ActionButton } from '@src/components/ActionButton'

type DeleteConfirmationDialogProps = React.PropsWithChildren<{
  title: string
  onConfirm: () => void
  onDismiss: () => void
}>

export function DeleteConfirmationDialog({
  title,
  onConfirm,
  onDismiss,
  children,
}: DeleteConfirmationDialogProps) {
  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center">
        <Dialog.Panel className="max-w-2xl p-4 border rounded bg-chalkboard-10 dark:bg-chalkboard-100 border-destroy-80">
          <Dialog.Title as="h2" className="mb-4 text-2xl font-bold">
            {title}
          </Dialog.Title>
          <Dialog.Description>{children}</Dialog.Description>

          <div className="flex justify-between">
            <ActionButton
              Element="button"
              onClick={onConfirm}
              iconStart={{
                icon: 'trash',
                bgClassName: 'bg-destroy-10 dark:bg-destroy-80',
                iconClassName: '!text-destroy-80 dark:!text-destroy-20',
              }}
              className="hover:border-destroy-40 dark:hover:border-destroy-40 hover:bg-destroy-10/20 dark:hover:bg-destroy-80/20"
              data-testid="delete-confirmation"
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
