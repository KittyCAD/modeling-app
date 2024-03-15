import { UpdateManifest } from '@tauri-apps/api/updater'
import { create, InstanceProps } from 'react-modal-promise'

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
      <h1>New version available</h1>
      <p>v{version}, {date}</p>
      <p>{body}</p>
      <button onClick={() => onResolve({ wantUpdate: true })}>Update</button>
      <button onClick={() => onResolve({ wantUpdate: false })}>Not now</button>
    </div>
  </div>
)
