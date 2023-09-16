import { useRouteError } from 'react-router-dom'

export const ErrorPage = () => {
  let error = useRouteError()

  console.error('error', error)

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <section className="max-w-full xl:max-w-4xl mx-auto">
        <h1 className="text-4xl mb-8 font-bold">An unexpected error occurred</h1>
        <p>{String(error)}</p>
      </section>
    </div>
  )
}
