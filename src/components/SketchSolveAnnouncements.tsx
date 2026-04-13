export const HOME_SKETCH_SOLVE_ANNOUNCEMENT =
  'Meet Sketch Solve, Create a new sketch to experience our new UI. Older sketches may still open in legacy sketch mode. Automatic conversion is on the way.'

export const LEGACY_SKETCH_MODE_BANNER =
  "This sketch opens in legacy sketch mode because it's existing. To use Sketch Solve, create a new sketch. Automatic conversion is on the way."

export function SketchSolveAnnouncement() {
  return (
    <section
      data-testid="home-sketch-solve-banner"
      className="my-2 rounded-lg border border-primary/30 bg-chalkboard-10 px-4 py-3 text-sm shadow-lg dark:border-primary/40 dark:bg-chalkboard-90"
    >
      <p className="font-medium text-primary">Sketch Solve</p>
      <p className="mt-1 leading-5 text-chalkboard-90 dark:text-chalkboard-20">
        {HOME_SKETCH_SOLVE_ANNOUNCEMENT}
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
