import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'

const Units = () => {
  const { isMouseDownInStream } = useStore((s) => ({
    isMouseDownInStream: s.isMouseDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick('sketching')

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-2xl flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (isMouseDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <h1 className="text-2xl font-bold">Camera</h1>
        <p className="mt-6">
          Moving the camera is easy. Just click and drag anywhere in the scene
          to rotate the camera, or hold down the <kbd>Ctrl</kbd> key and drag to
          pan the camera.
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
          <ActionButton onClick={next} icon={{ icon: faArrowRight }}>
            Next: Sketching
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

export default Units
