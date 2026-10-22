import { cloneElement } from 'react'
import {
  ActionIconFrame,
  getActionIconSvgProps,
} from '@src/components/ActionIconFrame'
import { Logo } from '@src/components/Logo'
import { getActionButtonClasses } from '@src/components/actionButtonStyles'
import {
  arrowShortLeftIcon,
  arrowShortRightIcon,
  linkIcon,
} from '@src/components/commonIcons'
import { getDesktopHandoffUrl } from '@src/lib/browserHandoff'
import { platform } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/lib/appVersion'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import toast from 'react-hot-toast'

/** Shared by the cold browser entry and subsequent in-app link navigation. */
export function OpenInDesktopApp({
  onContinue,
}: {
  onContinue: () => void | Promise<void>
}) {
  const buttonClasses =
    'bg-transparent flex-0 hover:bg-primary/10 dark:hover:bg-primary/10'
  const downloadUrl = withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)

  /**
   * Navigate to the same route with our custom protocol
   * `zoo-studio:` instead of `https://${BASE_URL}`, to trigger the user's
   * desktop app to open.
   */
  function onOpenInDesktopApp() {
    const newURL = getDesktopHandoffUrl(new URL(globalThis.location.href))

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

    globalThis.location.href = newURL
  }

  return (
    <div className="fixed inset-0 grid p-4 place-content-center bg-chalkboard-10 dark:bg-chalkboard-110">
      <div
        className={`max-w-3xl py-6 px-10 flex flex-col items-center gap-12
          mx-auto border rounded-lg shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100`}
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
              <button
                tabIndex={-1}
                className={getActionButtonClasses({
                  hasIconEnd: true,
                  className: buttonClasses + ' !text-base',
                })}
                onClick={onOpenInDesktopApp}
              >
                Open in desktop app
                <ActionIconFrame>
                  {cloneElement(arrowShortRightIcon, getActionIconSvgProps())}
                </ActionIconFrame>
              </button>
              <a
                className={getActionButtonClasses({
                  hasIconEnd: true,
                  className:
                    buttonClasses +
                    ' text-sm border-transparent justify-center dark:bg-transparent',
                })}
                href={downloadUrl}
                onClick={openExternalBrowserIfDesktop(downloadUrl)}
                target="_blank"
              >
                Download desktop app
                <ActionIconFrame bgClassName="!bg-transparent">
                  {cloneElement(linkIcon, getActionIconSvgProps())}
                </ActionIconFrame>
              </a>
            </div>
            <button
              tabIndex={-1}
              className={getActionButtonClasses({
                hasIconStart: true,
                className: buttonClasses + ' -order-1 !text-base',
              })}
              onClick={() => {
                void Promise.resolve(onContinue()).catch(reportRejection)
              }}
              data-testid="continue-to-web-app-button"
            >
              <ActionIconFrame>
                {cloneElement(arrowShortLeftIcon, getActionIconSvgProps())}
              </ActionIconFrame>
              Continue to web app
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
