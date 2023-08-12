import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { useDismiss } from '.'

export default function Sketching() {
  const dismiss = useDismiss()

  return (
    <div className="fixed grid justify-center items-end inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Sketching</h1>
        <p className="mt-6">
          We still have to implement this step, and the rest of the tutorial!
        </p>
        <div className="flex justify-between mt-6">
          <ActionButton
            onClick={dismiss}
            icon={{
              icon: faXmark,
              bgClassName: 'bg-destroy-80',
              iconClassName:
                'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
            }}
            className="hover:border-destroy-40"
          >
            Dismiss
          </ActionButton>
          <ActionButton onClick={dismiss} icon={{ icon: faArrowRight }}>
            Finish
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
