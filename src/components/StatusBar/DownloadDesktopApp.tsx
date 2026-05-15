import { useEffect, useRef, useState } from 'react'
import { ActionIcon } from '@src/components/ActionIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'

export function DownloadDesktopApp() {
  /** NOTE: We're defining a custom warning element here because using the
   * proper `Tooltip` component conflicts with the z-index of the onboarding
   * dialog and making this aware of onboarding status would add significant
   * complexity. This warning can go away once the web app has cloud storage. */

  const [showWarning, setShowWarning] = useState(true)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showWarning) return
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShowWarning(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showWarning])

  useEffect(() => {
    if (!showWarning) return
    const timeout = setTimeout(() => setShowWarning(false), 8_000)
    return () => clearTimeout(timeout)
  }, [showWarning])

  const href = withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)
  const warningContent = (
    <span className="flex items-center gap-2">
      ⚠ This demo project is only stored in your browser. Our desktop app will
      allow you to work on multiple projects.
    </span>
  )

  return (
    <div
      ref={wrapperRef}
      className="relative flex items-stretch"
      onMouseEnter={() => setShowWarning(true)}
    >
      <a
        href={href}
        className={`${defaultStatusBarItemClassNames} flex items-center gap-2`}
        data-testid="download-desktop-app"
      >
        <ActionIcon
          icon="download"
          bgClassName="bg-transparent dark:bg-transparent"
        />
        <span>Install desktop app</span>
      </a>
      {showWarning && (
        <div
          role="tooltip"
          className="absolute left-0 bottom-full mb-1 z-50 w-72 rounded-lg border border-chalkboard-20 dark:border-chalkboard-90 bg-chalkboard-10 dark:bg-chalkboard-90 p-3 text-sm text-chalkboard-110 dark:text-chalkboard-20 shadow-lg"
        >
          {warningContent}
        </div>
      )}
    </div>
  )
}
