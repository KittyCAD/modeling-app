import { useComputed } from '@preact/signals'
import { EmptyState } from '@kittycad/ui-kit'
import { useValueSpec } from '@src/app/context'
import { overlaysValueSpec, screensValueSpec } from '@src/contracts/shell'
import { StatusBar } from '@src/features/shell/StatusBar'
import { TopBar } from '@src/features/shell/TopBar'
import './shell.css'

/**
 * The app frame: a top bar, the main area, a status bar.
 *
 * The main area shows the first screen that reports itself active. Screens
 * decide that from application state, never from a URL, which is what makes the
 * router downstream of the app rather than the other way round.
 *
 * If no screen claims the state, that is a real condition with a real
 * treatment, not a blank page — it means a feature contributed a state nothing
 * knows how to draw.
 */
export function AppShell() {
  const screens = useValueSpec(screensValueSpec)
  const overlays = useValueSpec(overlaysValueSpec)

  const active = useComputed(
    () => screens.value.find((screen) => screen.active.value) ?? null
  )

  return (
    <div class="zds-shell">
      <TopBar />
      <main class="zds-shell__main">
        {active.value ? (
          active.value.render()
        ) : (
          <EmptyState
            scale="page"
            icon="grid"
            eyebrow="No screen"
            title="Nothing is claiming this state"
            description="The app is in a state no screen recognises. This is a wiring problem, not something you did."
          />
        )}
      </main>
      <StatusBar />
      {overlays.value.map((overlay) => (
        <div class="zds-shell__overlay" key={overlay.id}>
          {overlay.render()}
        </div>
      ))}
    </div>
  )
}
