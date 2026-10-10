import { PATHS } from '@src/lib/paths'
import { isErr } from '@src/lib/trap'
// eslint-disable-next-line zds/no-react-router-hooks -- React Router error boundary reads its loader error (useRouteError).
import { Link, useRouteError } from 'react-router-dom'

export function CloudProjectErrorPage() {
  const error = useRouteError()
  return (
    <main className="h-screen grid place-content-center gap-4 p-8">
      <h1>Unable to open project</h1>
      <p role="alert">
        {isErr(error) ? error.message : 'Unable to open this project.'}
      </p>
      <Link to={PATHS.HOME}>Back to projects</Link>
    </main>
  )
}
