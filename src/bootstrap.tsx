import ReactDOM from 'react-dom/client'
import '@src/index.css'
import { isErr } from '@src/lib/trap'

const container = document.getElementById('root')

if (container) {
  const root = ReactDOM.createRoot(container)

  // App construction creates the WebGL renderer during module evaluation.
  // Keep this boundary independent of app imports so it can render if they fail.
  void import('@src/index')
    .then(({ launchApp }) => launchApp(root))
    .catch((error: unknown) => {
      console.error('Unable to start Zoo Design Studio', error)
      const webglUnavailable =
        isErr(error) &&
        (error.message === 'Error creating WebGL context.' ||
          error.message ===
            'Error creating WebGL context with your selected attributes.')

      root.render(
        <main className="flex min-h-screen items-center justify-center p-8">
          <section className="max-w-xl">
            <h1 className="text-4xl mb-8 font-bold">
              {webglUnavailable
                ? 'WebGL is unavailable'
                : 'Zoo Design Studio could not start'}
            </h1>
            <p className="mb-8">
              {webglUnavailable
                ? 'Zoo Design Studio needs WebGL to display models. Restart the app or browser and try again. If you are using a browser, check that graphics acceleration is enabled.'
                : 'Reload to try again. If this keeps happening, contact support.'}
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      )
    })
}
