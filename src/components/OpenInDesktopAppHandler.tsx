import { Transition } from '@headlessui/react'
import { VITE_KC_SITE_BASE_URL } from '@src/env'
import { useSearchParams } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import {
  APP_DOWNLOAD_PATH,
  ASK_TO_OPEN_QUERY_PARAM,
  ZOO_STUDIO_PROTOCOL,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { Themes, darkModeMatcher, setThemeClass } from '@src/lib/theme'
import toast from 'react-hot-toast'
import { platform } from '@src/lib/utils'
import { Logo } from '@src/components/Logo'
import { useEffect } from 'react'

/**
 * This component is a handler that checks if a certain query parameter
 * is present, and if so, it will show a modal asking the user if they
 * want to open the current page in the desktop app.
 */
export const OpenInDesktopAppHandler = (props: React.PropsWithChildren) => {
  const buttonClasses =
    'bg-transparent flex-0 hover:bg-primary/10 dark:hover:bg-primary/10'
  const [searchParams, setSearchParams] = useSearchParams()
  // We also ignore this param on desktop, as it is redundant
  const hasAskToOpenParam =
    !isDesktop() && searchParams.has(ASK_TO_OPEN_QUERY_PARAM)

  // Watch the system theme for changes
  useEffect(() => {
    const listener = (e: MediaQueryListEvent) => {
      setThemeClass(e.matches ? Themes.Dark : Themes.Light)
    }

    darkModeMatcher?.addEventListener('change', listener)
    return () => darkModeMatcher?.removeEventListener('change', listener)
  }, [])

  /**
   * This function removes the query param to ask to open in desktop app
   * and then navigates to the same route but with our custom protocol
   * `zoo-studio:` instead of `https://${BASE_URL}`, to trigger the user's
   * desktop app to open.
   */
  function onOpenInDesktopApp() {
    const newSearchParams = new URLSearchParams(globalThis.location.search)
    const newURL = `${ZOO_STUDIO_PROTOCOL}://${globalThis.location.pathname.replace(
      '/',
      ''
    )}${searchParams.size > 0 ? `?${newSearchParams.toString()}` : ''}`

    // TODO: find a way to workaround this limitation, modeling-app#6200
    // Electron issue: https://github.com/electron/electron/issues/40776
    // This 2046 value comes from https://issues.chromium.org/issues/41322340#comment3
    // and empirical testing on Chrome and Windows 11
    const MAX_URL_LENGTH = 2046
    if (platform() === 'windows' && newURL.length > MAX_URL_LENGTH) {
      toast.error(
        'The URL is too long to open in the desktop app on Windows. Try another platform or use the web app.'
      )
      return
    }

    newSearchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
    globalThis.location.href = newURL
  }

  /**
   * Just remove the query param to ask to open in desktop app
   * and continue to the web app.
   */
  function continueToWebApp() {
    searchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
    setSearchParams(searchParams)
  }

  return hasAskToOpenParam ? (
    <Transition
      appear
      show={true}
      as="div"
      className="fixed inset-0 grid p-4 place-content-center bg-chalkboard-10 dark:bg-chalkboard-110"
    >
      <Transition.Child
        as="div"
        className={`max-w-3xl py-6 px-10 flex flex-col items-center gap-12 
          mx-auto border rounded-lg shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100`}
        enter="ease-out duration-300"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="ease-in duration-200"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
        style={{ zIndex: 10 }}
      >
        <h1 className="text-2xl text-center ">
          <div className="mb-4">Launching </div>
          <div className="flex items-center gap-4 flex-wrap text-4xl">
            <Logo className="w-40" aria-label="Zoo" />
            <span>Design Studio</span>
          </div>
        </h1>
        <div className="flex flex-col gap-4 items-center">
          <p className="text-primary">Choose where to open this link...</p>
          <div className="flex flex-col md:flex-row items-start justify-between gap-4 xl:gap-8">
            <div className="flex flex-col gap-2">
              <ActionButton
                Element="button"
                className={buttonClasses + ' !text-base'}
                onClick={onOpenInDesktopApp}
                iconEnd={{ icon: 'arrowRight' }}
              >
                Open in desktop app
              </ActionButton>
              <ActionButton
                Element="externalLink"
                className={
                  buttonClasses +
                  ' text-sm border-transparent justify-center dark:bg-transparent'
                }
                to={`${VITE_KC_SITE_BASE_URL}/${APP_DOWNLOAD_PATH}`}
                iconEnd={{ icon: 'link', bgClassName: '!bg-transparent' }}
              >
                Download desktop app
              </ActionButton>
            </div>
            <ActionButton
              Element="button"
              className={buttonClasses + ' -order-1 !text-base'}
              onClick={continueToWebApp}
              iconStart={{ icon: 'arrowLeft' }}
              data-testid="continue-to-web-app-button"
            >
              Continue to web app
            </ActionButton>
          </div>
        </div>
      </Transition.Child>
    </Transition>
  ) : (
    props.children
  )
}
