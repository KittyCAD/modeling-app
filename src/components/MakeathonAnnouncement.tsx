import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

export const HOME_MAKEATHON_TITLE = 'Zoo Makeathon is open for registration'

export const HOME_MAKEATHON_ANNOUNCEMENT =
  'The virtual Zoo Design Studio Makeathon runs April 28-May 5, 2026, with registration open now. Build a fresh project in Zoo Design Studio using Sketch Mode, KCL, or Zookeeper, then publish it to the Aquarium as a Makeathon submission by May 5 at 11:59 PM PST. Eligible registrants receive 10,000 minutes of Zookeeper reasoning time for the event.'

export function MakeathonAnnouncement() {
  const makeathonHref = withSiteBaseURL('/makeathon')

  return (
    <section
      data-testid="home-makeathon-banner"
      className="my-2 rounded-lg border border-primary/30 bg-chalkboard-10 px-4 py-3 text-xs dark:border-primary/40 dark:bg-chalkboard-90"
    >
      <p className="font-bold text-primary">{HOME_MAKEATHON_TITLE}</p>
      <p className="mt-1 leading-5 text-chalkboard-90 dark:text-chalkboard-20">
        {HOME_MAKEATHON_ANNOUNCEMENT}
      </p>
      <a
        href={makeathonHref}
        onClick={openExternalBrowserIfDesktop(makeathonHref)}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex font-bold text-primary underline-offset-2 hover:underline focus-visible:outline-appForeground"
      >
        Register now
      </a>
    </section>
  )
}
