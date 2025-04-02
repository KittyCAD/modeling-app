import type { InstanceProps } from 'react-modal-promise'
import { create } from 'react-modal-promise'

import { ActionButton } from '@src/components/ActionButton'

type ModalResolve = {
  wantRestart: boolean
}

type ModalReject = boolean

type UpdaterRestartModalProps = InstanceProps<ModalResolve, ModalReject> & {
  version: string
}

export const createUpdaterRestartModal = create<
  UpdaterRestartModalProps,
  ModalResolve,
  ModalReject
>

export const UpdaterRestartModal = ({
  onResolve,
  version,
}: UpdaterRestartModalProps) => (
  <div className="fixed inset-0 z-50 grid place-content-center bg-chalkboard-110/50">
    <div className="max-w-3xl p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
      <h1 className="text-3xl font-bold">Ready to restart?</h1>
      <p className="my-4" data-testid="update-restart-version">
        v{version} is now installed. Restart the app to use the new features.
      </p>
      <div className="flex justify-between">
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantRestart: false })}
          iconStart={{
            icon: 'close',
            bgClassName: 'bg-destroy-80',
            iconClassName: 'text-destroy-20 group-hover:text-destroy-10',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="update-restrart-button-cancel"
        >
          Not now
        </ActionButton>
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantRestart: true })}
          iconStart={{
            icon: 'arrowRight',
            bgClassName: 'dark:bg-chalkboard-80',
          }}
          className="dark:hover:bg-chalkboard-80/50"
          data-testid="update-restrart-button-update"
        >
          Restart
        </ActionButton>
      </div>
    </div>
  </div>
)
