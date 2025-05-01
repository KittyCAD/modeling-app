import { APP_NAME } from '@src/lib/constants'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import { OnboardingButtons } from '@src/routes/Onboarding/utils'

export default function Export() {
  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">Export</h2>
          <p className="my-4">
            In addition to the "Export current part" button in the project menu,
            you can also click the Export button icon at the bottom of the left
            sidebar. Try clicking it now.
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
            Our teammate Katie is working on the file format, check out{' '}
            <a
              href="https://github.com/KhronosGroup/glTF/pull/2343"
              target="_blank"
              rel="noreferrer noopener"
            >
              her standards proposal on GitHub
            </a>
            !
          </p>
        </section>
        <OnboardingButtons currentSlug={onboardingPaths.EXPORT} />
      </div>
    </div>
  )
}
