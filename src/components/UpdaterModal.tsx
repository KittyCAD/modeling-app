import { UpdateManifest } from '@tauri-apps/api/updater'
import { create, InstanceProps } from 'react-modal-promise'
import { ActionButton } from './ActionButton'

type ModalResolve = {
  wantUpdate: boolean
}

type ModalReject = boolean

type UpdaterModalProps = InstanceProps<ModalResolve, ModalReject> &
  UpdateManifest

export const createUpdaterModal = create<
  UpdaterModalProps,
  ModalResolve,
  ModalReject
>

export const UpdaterModal = ({
  onResolve,
  version,
  date,
  body,
}: UpdaterModalProps) => (
  <div className="fixed inset-0 z-50 grid place-content-center bg-chalkboard-110/50">
    <div className="max-w-3xl p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
      <h1 className="text-3xl font-bold">New version available!</h1>
      <p className="my-4">v{version}</p>
      <p className="my-4">Published on {date}</p>
      <p className="my-4 max-h-60 overflow-y-auto">{body}</p>
      <div className="flex justify-between">
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantUpdate: false })}
          icon={{
            icon: 'close',
            bgClassName: 'bg-destroy-80',
            iconClassName: 'text-destroy-20 group-hover:text-destroy-10',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
        >
          Not now
        </ActionButton>
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantUpdate: true })}
          icon={{ icon: 'arrowRight', bgClassName: 'dark:bg-chalkboard-80' }}
          className="dark:hover:bg-chalkboard-80/50"
        >
          Update
        </ActionButton>
      </div>
    </div>
  </div>
)
