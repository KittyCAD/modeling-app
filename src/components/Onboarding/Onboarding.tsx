import { faXmark } from "@fortawesome/free-solid-svg-icons"
import { useStore } from "../../useStore"
import { ActionButton } from "../ActionButton"

const onboardingConfig = [
    {
        id: 'introduction',
        component: 'Introduction',
    },
    {
        id: 'units',
        component: 'Units',
    },
    {
        id: 'camera-controls',
        component: 'CameraControls',
    },
]

interface OnboardingProps extends React.PropsWithChildren {}

const Onboarding = ({children, ...props}: OnboardingProps) => {
    const {
        onboardingStatus,
        setOnboardingStatus,
    } = useStore((s) => ({
        onboardingStatus: s.onboardingStatus,
        setOnboardingStatus: s.setOnboardingStatus,
    }))

    return onboardingStatus !== 'new' ? children
        : (
            <>
                {children}
                <div className="absolute z-10 inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    <div className="bg-white p-8 rounded-lg">
                        <p>let's do some onboarding shall we?</p>
                        <ActionButton onClick={() => setOnboardingStatus('done')} as="button"
                            icon={{
                                icon: faXmark,
                                bgClassName: 'bg-destroy-80',
                                iconClassName:
                                  'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
                              }}
                              className="hover:border-destroy-40"
                        >
                            I'm done
                        </ActionButton>
                    </div>
                </div>
            </>
        )
}

export default Onboarding