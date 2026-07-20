import type { Announcement } from '@kittycad/lib'
import { meta } from '@kittycad/lib'
import { MarkdownText } from '@src/components/MarkdownText'
import { createKCClient } from '@src/lib/kcClient'
import { useEffect, useState } from 'react'

export const LEGACY_SKETCH_MODE_BANNER =
  'This older sketch opens in legacy mode. New projects use the redesigned sketch mode with a fully-integrated constraint solver.'

export function Announcements({ token }: { token?: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchAnnouncements() {
      try {
        const client = createKCClient(token)
        const result = await meta.get_announcements({ client })
        if (!controller.signal.aborted) {
          setAnnouncements(result.announcements)
        }
      } catch (e) {
        console.error('Error fetching announcements:', e)
      }
    }

    void fetchAnnouncements()

    return () => {
      controller.abort()
    }
  }, [token])

  if (announcements.length === 0) {
    return null
  }

  return (
    <>
      {announcements.map((announcement) => (
        <AnnouncementBanner key={announcement.id} announcement={announcement} />
      ))}
    </>
  )
}

function AnnouncementBanner({ announcement }: { announcement: Announcement }) {
  return (
    <section
      data-testid="announcement-banner"
      className="my-2 rounded-lg border border-primary/30 bg-chalkboard-10 px-4 py-3 text-xs dark:border-primary/40 dark:bg-chalkboard-90"
    >
      <p className="font-bold text-primary">{announcement.title}</p>
      {announcement.body && (
        <MarkdownText
          text={announcement.body}
          className="mt-1 leading-5 text-chalkboard-90 dark:text-chalkboard-20"
        />
      )}
    </section>
  )
}

export function LegacySketchModeBanner() {
  return (
    <div
      data-testid="legacy-sketch-mode-banner"
      className="mt-2 w-[min(34rem,calc(100vw-2rem))] py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg whitespace-normal"
    >
      <p className="text-xs text-center whitespace-normal break-words">
        {LEGACY_SKETCH_MODE_BANNER}
      </p>
    </div>
  )
}
