import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useValueSpec } from '@src/app/context'
import type { HomeSidebarItem } from '@src/contracts/home'
import { homeSidebarItemsValueSpec } from '@src/contracts/home'
import {
  type Announcement,
  createAnnouncementsApi,
} from '@src/features/home/announcementsApi'

/**
 * Zoo's news, if there is any.
 *
 * Renders nothing at all when there is nothing to say — no empty card, no
 * "no announcements" — because a column that reserves space for news it does
 * not have makes the page look broken on the ordinary day.
 */
function Announcements() {
  const items = useSignal<readonly Announcement[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const api = createAnnouncementsApi({})

    void api
      .list(controller.signal)
      .then((next) => {
        items.value = next
      })
      .catch(() => {
        // Deliberate: see `announcementsApi`. Failure is silence.
      })

    return () => controller.abort()
  }, [items])

  if (items.value.length === 0) return null

  return (
    <section class="zds-home__news" aria-label="Announcements">
      {items.value.map((announcement) => (
        <article class="zds-home__announcement" key={announcement.id}>
          <p class="zds-home__announcement-title">{announcement.title}</p>
          {announcement.body ? (
            <p class="zds-home__announcement-body">{announcement.body}</p>
          ) : null}
        </article>
      ))}
    </section>
  )
}

function Group({
  items,
  group,
}: {
  items: HomeSidebarItem[]
  group: 'start' | 'end'
}) {
  const visible = items.filter(
    (item) => (item.group ?? 'start') === group && (item.visible?.value ?? true)
  )
  if (visible.length === 0) return null

  return (
    <ul class="zds-home__sidebar-group" data-group={group}>
      {visible.map((item) => (
        <li class="zds-home__sidebar-item" data-item-id={item.id} key={item.id}>
          {item.render()}
        </li>
      ))}
    </ul>
  )
}

/**
 * Home's left column.
 *
 * Contributed items at both ends and the news between them, so a feature can
 * put something on Home without Home importing it. Announcements are rendered
 * here rather than contributed because they are Home's own content rather than
 * any feature's — there is nowhere else in the app they would belong.
 */
export function HomeSidebar() {
  const items = useValueSpec(homeSidebarItemsValueSpec)

  return (
    <aside class="zds-home__sidebar" aria-label="Home">
      <Group items={items.value} group="start" />
      <div class="zds-home__sidebar-rest">
        <Announcements />
        <Group items={items.value} group="end" />
      </div>
    </aside>
  )
}
