import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { Themes } from 'lib/theme'
import { useEffect } from 'react'
import { bracket } from 'lib/exampleKcl'
import { useStore } from 'useStore'

export default function Introduction() {
  const { setCode, code } = useStore((s) => ({
    code: s.code,
    setCode: s.setCode,
  }))
  const {
    settings: {
      state: {
        context: { theme },
      },
    },
  } = useGlobalStateContext()
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.CAMERA)

  useEffect(() => {
    if (code !== '') return
    setCode(bracket)
  }, [code, setCode])

  return (
    <div className="fixed grid place-content-center inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-3xl bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold flex gap-4 flex-wrap items-center">
          <img
            src={`/kcma-logomark${theme === Themes.Light ? '-dark' : ''}.svg`}
            alt="KittyCAD Modeling App"
            className="max-w-full h-20"
          />
          <span className="bg-energy-10 text-energy-80 px-3 py-1 rounded-full text-base">
            Alpha
          </span>
        </h1>
        <section className="my-12">
          <p className="my-4">
            Welcome to KittyCAD Modeling App! This is a hardware design tool
            that lets you edit visually, with code, or both. It's powered by the
            first API created for anyone to build hardware design tools. The 3D
            view is not running on your computer, but is instead being streamed
            to you from a remote GPU as video.
          </p>
          <p className="my-4">
            This is an alpha release, so you will encounter bugs and missing
            features. You can read our{' '}
            <a
              href="https://gist.github.com/jgomez720/5cd53fb7e8e54079f6dc0d2625de5393"
              target="_blank"
              rel="noreferrer noopener"
            >
              expectations for alpha users here
            </a>
            . Please give us feedback on your experience! We are trying to
            release as early as possible to get feedback from users like you.
          </p>
        </section>
        <div className="flex justify-between mt-6">
          <ActionButton
            Element="button"
            onClick={() => dismiss('../')}
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
            Element="button"
            onClick={next}
            icon={{ icon: faArrowRight }}
          >
            Get Started
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
