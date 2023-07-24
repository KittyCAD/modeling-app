import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../../useStore'
import { ActionButton } from '../../components/ActionButton'
import { createBackdropHighlight } from '../../lib/createBackdropHighlight'
import { useEffect, useState } from 'react'

interface IntroductionProps extends React.PropsWithChildren {}

const Units = ({ children, ...props }: IntroductionProps) => {
  const [clipPath, setClipPath] = useState('')
  const {
    setOnboardingStatus,
  } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
  }))

  useEffect(() => {
    setClipPath(createBackdropHighlight('stream'))
  }, [])

  return (
    <div className="fixed grid justify-center items-end inset-0 bg-chalkboard-110/50 z-50"
      style={{ clipPath }}
    >
      <div className="max-w-2xl flex flex-col justify-center bg-white p-8 rounded"
      >
        <h1 className="text-2xl font-bold">Camera</h1>
        <p className="mt-6">
          Moving the camera is easy. Just click and drag anywhere in the scene to rotate the camera, or hold down the <kbd>Ctrl</kbd> key and drag to pan the camera.
        </p>
        <div className="flex justify-between mt-6">
          <ActionButton
            as="link"
            to="/"
            onClick={() => setOnboardingStatus('done')}
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
          <ActionButton
            as="link"
            to="/onboarding/units"
            onClick={() => setOnboardingStatus('sketching')}
            icon={{ icon: faArrowRight }}
          >
            Next: Sketching
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

export default Units
