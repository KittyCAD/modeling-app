import { useState } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

export const MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY =
  'zoo.makeathonAnnouncement.dismissed'

export const MAKEATHON_ANNOUNCEMENT_TITLE = `Big news: Registration is OPEN for our virtual Zoo Design Studio Makeathon! 🎉`

export const MAKEATHON_ANNOUNCEMENT_COPY = `Any industry, any problem, any idea worth sharing. If you’ve got a CAD model idea you’ve been wanting to make, this is your moment! Zoo credits, Bambu Lab printers, and more to win.`

function getStoredDismissal() {
  try {
    return (
      window.localStorage?.getItem(
        MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY
      ) === 'true'
    )
  } catch {
    return false
  }
}

interface MakeathonAnnouncementProps {
  className?: string
  presentation?: 'inline' | 'dialog'
}

export function MakeathonAnnouncement(props: MakeathonAnnouncementProps) {
  const makeathonHref = withSiteBaseURL('/makeathon')
  const [isDismissed, setIsDismissed] = useState(getStoredDismissal)
  const presentation = props.presentation ?? 'inline'

  if (isDismissed) {
    return null
  }

  const onDismiss = () => {
    setIsDismissed(true)
    try {
      window.localStorage?.setItem(
        MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY,
        'true'
      )
    } catch {}
  }

  const announcement = (
    <section
      role={presentation === 'dialog' ? 'dialog' : undefined}
      aria-modal={presentation === 'dialog' ? true : undefined}
      aria-labelledby="makeathon-announcement-title"
      data-testid="zookeeper-makeathon-announcement"
      className={`rounded-lg border border-primary/40 bg-chalkboard-10 px-4 py-3 text-xs shadow-lg dark:border-primary/40 dark:bg-chalkboard-90 ${
        props.className ?? ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            id="makeathon-announcement-title"
            className="font-bold text-primary"
          >
            {MAKEATHON_ANNOUNCEMENT_TITLE}
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss Makeathon announcement"
          onClick={onDismiss}
          className="-mr-1 -mt-1 m-0 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-60 hover:text-chalkboard-100 dark:text-chalkboard-40 dark:hover:text-chalkboard-10"
        >
          <CustomIcon name="close" className="h-4 w-4" />
          <Tooltip position="top" hoverOnly={true}>
            <span>Dismiss</span>
          </Tooltip>
        </button>
      </div>
      <p className="mt-1 leading-5 text-chalkboard-90 dark:text-chalkboard-20">
        {MAKEATHON_ANNOUNCEMENT_COPY}
      </p>
      <ActionButton
        Element="externalLink"
        to={makeathonHref}
        className="mt-2 py-2 w-fit !bg-primary !text-chalkboard-10"
      >
        Register now
      </ActionButton>
    </section>
  )

  if (presentation === 'dialog') {
    return (
      <div
        data-testid="zookeeper-makeathon-announcement-overlay"
        className="absolute inset-0 z-20 flex items-center justify-center bg-chalkboard-10/40 p-4 backdrop-blur-sm dark:bg-chalkboard-110/45"
      >
        {announcement}
      </div>
    )
  }

  return announcement
}
