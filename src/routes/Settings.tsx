import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'

export const Settings = () => {
  return (
    <>
      <AppHeader showToolbar={false}>
        <ActionButton as="link"  to="/" icon={{
            icon: faXmark,
            bgClassName: 'bg-destroy-80',
            iconClassName: 'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
        }} className='hover:border-destroy-40'>
          Close
        </ActionButton>
      </AppHeader>
      <div className="mt-24 max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold">Settings</h1>
        <p className="text-2xl font-bold">Coming soon!</p>
      </div>
    </>
  )
}
