import { faSignInAlt } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'

const SignIn = () => {
  return (
    <main className="h-full min-h-screen bg-chalkboard-20 m-0 p-0 pt-24">
      <div className="max-w-2xl mx-auto">
        <div>
          <img src="/kittycad-logomark.svg" alt="KittyCAD" className='w-48 inline-block'/>
          <span className='text-3xl leading-none w-auto inline-block align-middle ml-2'>Modeling App</span>
        </div>
        <h1 className="font-bold text-2xl mt-12 mb-6 text-chalkboard-110">
          Sign in to get started with the KittyCAD Modeling App
        </h1>
        <p className="py-4">
            KCMA is an open-source CAD application for creating accurate 3D models for use in manufacturing. 
            It is built on top of the KittyCAD API. KittyCAD is the first software infrastructure company 
            built specifically for the needs of the manufacturing industry. With KCMA we are showing how the KittyCAD API can be used to build 
            entirely new kinds of software for manufacturing.
        </p>
        <p className="py-4">
            KCMA is currently in development. If you would like to be notified when KCMA is 
            ready for production, please sign up for our mailing list at <a href="https://kittycad.io" className='font-bold text-liquid-80 hover:text-liquid-70'>kittycad.io</a>.
        </p>
        <ActionButton
          as="link"
          to={`https://dev.kittycad.io/signin?callbackUrl=${encodeURIComponent(
            typeof window !== 'undefined' && window.location.href
          )}`}
          icon={{ icon: faSignInAlt }}
          className="w-fit mt-4"
        >
          Sign in
        </ActionButton>
      </div>
    </main>
  )
}

export default SignIn
