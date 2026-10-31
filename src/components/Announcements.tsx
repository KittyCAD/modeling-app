import type { Announcement } from '@kittycad/lib'
import { MarkdownText } from '@src/components/MarkdownText'
import { listClientItems } from '@src/lib/apiPagination'
import { createKCClient } from '@src/lib/kcClient'
import { useEffect, useState } from 'react'

export function Announcements({ token }: { token?: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchAnnouncements() {
      try {
        const client = createKCClient(token)
        const result = await listClientItems<Announcement>(
          client,
          '/announcements',
          controller.signal
        )
        if (!controller.signal.aborted) {
          setAnnouncements(result)
        }
      } catch (e) {
        if (controller.signal.aborted) return
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
