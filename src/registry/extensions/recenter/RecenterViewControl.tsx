import { useSignals } from '@preact/signals-react/runtime'
import usePlatform from '@src/hooks/usePlatform'
import { keymapKeystrokesDisplay } from '@src/registry/contracts/keymap'
import { reportRejection } from '@src/lib/trap'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ViewControlMenuItemProps } from '@src/registry/contracts/viewControls'
import type { ViewportNavigationService } from '@src/registry/contracts/viewportNavigation'

export function RecenterViewControl({
  navigation: navigationSignal,
  disabled,
  highlighted,
  onRecenter,
  shortcut,
}: ViewControlMenuItemProps & {
  navigation: ReadonlySignal<ViewportNavigationService | undefined>
  onRecenter: () => Promise<boolean>
  shortcut: ReadonlySignal<readonly string[] | undefined>
}) {
  useSignals()
  const platform = usePlatform()
  const shortcutLabel = keymapKeystrokesDisplay(shortcut.value, platform)
  const navigation = navigationSignal.value
  if (!navigation) return null
  const hint = navigation.recoveryHint?.value ?? { kind: 'neutral' }
  const label =
    hint.kind === 'direction'
      ? 'Model is offscreen'
      : hint.kind === 'zoom-in'
        ? 'Model is too small'
        : hint.kind === 'zoom-out'
          ? 'Zoom out to find the model'
          : 'Fit the model in view'

  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex items-center gap-2 py-1 px-2 border-none text-left hover:bg-3 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary ${highlighted ? 'bg-primary/15 ring-2 ring-inset ring-primary' : ''}`}
      title={label}
      aria-label="Recenter"
      onClick={() => {
        onRecenter().catch(reportRejection)
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {hint.kind === 'direction' ? (
          <g transform={`rotate(${hint.angle} 12 12)`}>
            <path d="M4 12h16m-6-6 6 6-6 6" />
          </g>
        ) : hint.kind === 'zoom-out' ? (
          <path d="m9 9-6-6m0 6V3h6m6 12 6 6m-6 0h6v-6" />
        ) : hint.kind === 'zoom-in' ? (
          <path d="m3 3 6 6m-6 0h6V3m12 18-6-6m0 6v-6h6" />
        ) : (
          <>
            <circle cx="12" cy="12" r="5" />
            <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
          </>
        )}
      </svg>
      <span className="flex-1">Recenter</span>
      {shortcutLabel && <kbd className="hotkey">{shortcutLabel}</kbd>}
    </button>
  )
}
