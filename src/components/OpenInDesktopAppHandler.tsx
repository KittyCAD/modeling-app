import { getSystemTheme, Themes } from 'lib/theme'
import { ZOO_STUDIO_PROTOCOL } from 'lib/link'
import { isDesktop } from 'lib/isDesktop'
import { Spinner } from './Spinner'
import { useSearchParams } from 'react-router-dom'
import { ASK_TO_OPEN_QUERY_PARAM } from 'lib/constants'
import { VITE_KC_SITE_BASE_URL } from 'env'
import { ActionButton } from './ActionButton'

export const OpenInDesktopAppHandler = (props: React.PropsWithChildren) => {
  const buttonClasses =
    'bg-transparent self-center w-full py-1 hover:bg-primary/10 dark:hover:bg-primary/10'
  const [searchParams, setSearchParams] = useSearchParams()
  // We also ignore this param on desktop, as it is redundant
  const hasAskToOpenParam =
    !isDesktop() && searchParams.has(ASK_TO_OPEN_QUERY_PARAM)

  /**
   * This function removes the query param to ask to open in desktop app
   * and then navigates to the same route but with our custom protocol
   * `zoo-studio:` instead of `https://${BASE_URL}`, to trigger the user's
   * desktop app to open.
   */
  function onOpenInDesktopApp() {
    const newSearchParams = new URLSearchParams(globalThis.location.search)
    newSearchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
    const newURL = `${ZOO_STUDIO_PROTOCOL}${globalThis.location.pathname.replace(
      '/',
      ''
    )}${searchParams.size > 0 ? `?${newSearchParams.toString()}` : ''}`
    console.log('Opening in desktop app:', newURL)
    globalThis.location.href = newURL
  }

  function continueToWebApp() {
    searchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
    setSearchParams(searchParams)
  }

  const pathLogomarkSvg = `${isDesktop() ? '.' : ''}/zma-logomark${
    getSystemTheme() === Themes.Light ? '-dark' : ''
  }.svg`

  return hasAskToOpenParam ? (
    <div className="flex items-center justify-center h-full">
      <div
        className="flex items-center justify-center h-full"
        style={{ zIndex: 10 }}
      >
        <div className="p-4 mx-auto border rounded rounded-tl-none shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70">
          <div className="gap-4 flex flex-col items-center">
            <div>
              <h1 className="text-2xl">
                Launching{' '}
                <img
                  src={pathLogomarkSvg}
                  className="w-48"
                  alt="Zoo Modeling App"
                />
              </h1>
            </div>
            <Spinner />
            <div className="flex flex-col">
              <ActionButton
                Element="button"
                className={buttonClasses + ' !text-base'}
                onClick={onOpenInDesktopApp}
              >
                Open in desktop app
              </ActionButton>
              <ActionButton
                Element="externalLink"
                className={buttonClasses + ' text-sm text-chalkboard-70 dark:text-chalkboard-40 border-transparent align-center'}
                to={`${VITE_KC_SITE_BASE_URL}/modeling-app/download`}
              >
                Download desktop app
              </ActionButton>
              <ActionButton
                Element="button"
                className={buttonClasses + ' mt-8 !text-base'}
                onClick={continueToWebApp}
              >
                Continue to web app
              </ActionButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : (
    props.children
  )
}
