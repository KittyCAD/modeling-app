import { ActionIcon } from '@src/components/ActionIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'
import { useEffect, useRef, useState } from 'react'

export function DownloadDesktopAppStatusBarItem() {
  const [showingWarning, setShowingWarning] = useState(true)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showingWarning) {
      return
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShowingWarning(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showingWarning])

  useEffect(() => {
    if (!showingWarning) {
      return
    }
    const timeout = setTimeout(() => setShowingWarning(false), 8_000)
    return () => clearTimeout(timeout)
  }, [showingWarning])

  return (
    <div ref={wrapperRef} className="relative flex items-stretch">
      <a
        href={withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)}
        className={`${defaultStatusBarItemClassNames} flex items-center gap-2`}
        aria-label="Install desktop app"
        data-testid="download-desktop-app"
        onMouseEnter={() => setShowingWarning(true)}
      >
        <ActionIcon
          icon="download"
          bgClassName="bg-transparent dark:bg-transparent"
        />
        <span>Install desktop app</span>
      </a>
      {showingWarning && (
        <div
          role="tooltip"
          className="absolute left-0 bottom-full mb-1 z-50 w-72 rounded-lg border border-chalkboard-20 dark:border-chalkboard-90 bg-chalkboard-10 dark:bg-chalkboard-90 p-3 text-sm text-chalkboard-110 dark:text-chalkboard-20 shadow-lg"
        >
          <span className="flex items-center gap-2">
            ⚠ This demo project is only stored in your browser. Our desktop app
            will allow you to work on multiple projects.
          </span>
        </div>
      )}
    </div>
  )
}
