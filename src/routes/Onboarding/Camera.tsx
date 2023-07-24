import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../../useStore'
import { ActionButton } from '../../components/ActionButton'

interface IntroductionProps extends React.PropsWithChildren {}

const Units = ({ children, ...props }: IntroductionProps) => {
  const {
    setOnboardingStatus,
  } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
  }))

  return (
    <div className="fixed grid place-content-center inset-0 bg-black bg-opacity-50 z-50">
      <div className="max-w-3xl bg-white p-8 rounded">
        <h1 className="text-2xl font-bold">Camera</h1>
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
