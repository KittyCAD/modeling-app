import { APP_NAME } from 'lib/constants'
import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useModelingContext } from 'hooks/useModelingContext'

export default function Export() {
  const { context } = useModelingContext()
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.SKETCHING)

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (context.store?.buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">Export</h2>
          <p className="my-4">
            Try opening the project menu and clicking the "Export Part" at the
            bottom of the pane.
          </p>
          <p className="my-4">
            {APP_NAME} uses{' '}
            <a
              href="https://zoo.dev/gltf-format-extension"
              rel="noopener noreferrer"
              target="_blank"
            >
              our open-source extension proposal
            </a>{' '}
            for the glTF file format.{' '}
            <a
              href="https://zoo.dev/docs/api/convert-cad-file"
              rel="noopener noreferrer"
              target="_blank"
            >
              Our conversion API
            </a>{' '}
            can convert to and from most common CAD file formats, allowing
            export to almost any CAD software.
          </p>
          <p className="my-4">
            Our teammate David is working on the file format, check out{' '}
            <a
              href="https://www.youtube.com/watch?v=8SuW0qkYCZo"
              target="_blank"
              rel="noreferrer noopener"
            >
              his talk with the Metaverse Standards Forum
            </a>
            !
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.EXPORT}
          next={next}
          dismiss={dismiss}
          nextText="Next: Sketching"
        />
      </div>
    </div>
  )
}
