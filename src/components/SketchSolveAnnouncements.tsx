import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export const HOME_SKETCH_SOLVE_ANNOUNCEMENT =
  'Create a project to experience our new, fully-integrated constraint solver. Existing sketches may still open in legacy mode.'

export const HOME_SKETCH_SOLVE_ANNOUNCEMENT_URL =
  'https://zoo.dev/blog/announcing-solver'

export const LEGACY_SKETCH_MODE_BANNER =
  'This older sketch opens in legacy mode. New projects use the redesigned sketch mode with a fully-integrated constraint solver.'

export function SketchSolveAnnouncement() {
  return (
    <section
      data-testid="home-sketch-solve-banner"
      className="my-2 rounded-lg border border-primary/30 bg-chalkboard-10 px-4 py-3 text-xs dark:border-primary/40 dark:bg-chalkboard-90"
    >
      <p className="font-bold text-primary">Redesigned sketch mode is here!</p>
      <p className="mt-1 leading-5 text-chalkboard-90 dark:text-chalkboard-20">
        {HOME_SKETCH_SOLVE_ANNOUNCEMENT}
        <span className="mt-1 block">
          See{' '}
          <a
            href={HOME_SKETCH_SOLVE_ANNOUNCEMENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openExternalBrowserIfDesktop(
              HOME_SKETCH_SOLVE_ANNOUNCEMENT_URL
            )}
            className="text-primary underline decoration-primary/50 hover:decoration-primary"
          >
            this announcement
          </a>{' '}
          for more details.
        </span>
      </p>
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
