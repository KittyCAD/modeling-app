import { create, InstanceProps } from 'react-modal-promise'
import { ActionButton } from './ActionButton'
import { Logo } from './Logo'
import { Marked } from '@ts-stack/markdown'

type ModalResolve = {
  wantUpdate: boolean
}

type ModalReject = boolean

type UpdaterModalProps = InstanceProps<ModalResolve, ModalReject> & {
  version: string
  date?: string
  body?: string
}

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
    <div className="max-w-3xl min-w-[45rem] p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
      <div className="flex items-center">
        <h1 className="flex-grow text-3xl font-bold">New version available!</h1>
        <Logo className="h-9" />
      </div>
      <div className="my-4 flex items-baseline">
        <span
          className="px-3 py-1 text-xl rounded-full bg-energy-10 text-energy-80"
          data-testid="update-version"
        >
          v{version}
        </span>
        <span className="ml-4 text-sm text-gray-400">Published on {date}</span>
      </div>
      {/* TODO: fix list bullets */}
      {body && (
        <div
          className="my-4 max-h-60 overflow-y-auto"
          dangerouslySetInnerHTML={{
            __html: Marked.parse(body, {
              gfm: true,
              breaks: true,
              sanitize: true,
            }),
          }}
        ></div>
      )}
      <div className="flex justify-between">
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantUpdate: false })}
          iconStart={{
            icon: 'close',
            bgClassName: 'bg-destroy-80',
            iconClassName: 'text-destroy-20 group-hover:text-destroy-10',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="update-button-cancel"
        >
          Not now
        </ActionButton>
        <ActionButton
          Element="button"
          onClick={() => onResolve({ wantUpdate: true })}
          iconStart={{
            icon: 'arrowRight',
            bgClassName: 'dark:bg-chalkboard-80',
          }}
          className="dark:hover:bg-chalkboard-80/50"
          data-testid="update-button-update"
        >
          Update
        </ActionButton>
      </div>
    </div>
  </div>
)
