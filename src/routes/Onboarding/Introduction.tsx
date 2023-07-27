import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { useDismiss, useNextClick } from '.'

const Introduction = () => {
  const dismiss = useDismiss()
  const next = useNextClick('units')

  return (
    <div className="fixed grid place-content-center inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-3xl bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">
          Welcome to the KittyCAD Modeling App
        </h1>
        <p className="my-2">
          A browser-first, GPU-streaming hardware design tool that lets you edit
          visually, with code, or both.
        </p>
        <p className="my-2">
          Powered by the first API created for anyone to build hardware design
          tools.
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
            Get Started
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

export default Introduction
