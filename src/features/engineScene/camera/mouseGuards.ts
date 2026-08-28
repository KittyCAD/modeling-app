/**
 * Which gesture means pan, rotate, or zoom.
 *
 * Ported from the existing app, near enough verbatim: these are seven other
 * CAD packages' conventions, and someone switching to this one wants the
 * muscle memory they already have, not our idea of a better default. The table
 * is the entire content of the "camera controls" preference.
 *
 * Kept as predicates over the event rather than as a description of buttons and
 * modifiers, because several of them are not expressible that way — Creo's
 * rotate is middle *or* left-and-right together, and a chorded check has to see
 * the whole event.
 */

/**
 * A system, named as it is stored.
 *
 * The identifier is the serialized form, and the display name comes from the
 * table below. The existing app keeps the display name as the value and converts
 * in both directions at the file boundary, which needs two mapping functions and
 * a comment about why the underscores go missing; naming the system by its id
 * once removes all of it.
 */
export type CameraSystem =
  | 'zoo'
  | 'onshape'
  | 'trackpad_friendly'
  | 'solidworks'
  | 'nx'
  | 'creo'
  | 'autocad'

export const cameraSystems: readonly CameraSystem[] = [
  'zoo',
  'onshape',
  'trackpad_friendly',
  'solidworks',
  'nx',
  'creo',
  'autocad',
]

/** What the engine understands. `rotatetrackball` is the trackball orbit. */
export type CameraInteraction = 'pan' | 'rotate' | 'rotatetrackball' | 'zoom'

interface DragGuard {
  description: string
  matches: (event: MouseEvent) => boolean
}

interface ZoomGuard {
  description: string
  matchesDrag: (event: MouseEvent) => boolean
  /**
   * A scroll with no button held.
   *
   * Falsy rather than `=== 0`: what matters is that nothing is being dragged,
   * and not every source of a wheel event fills in the button state.
   */
  matchesScroll: (event: WheelEvent) => boolean
}

export interface MouseGuard {
  /** How the package is known, for the settings dialog. */
  label: string
  pan: DragGuard
  rotate: DragGuard
  zoom: ZoomGuard
}

/**
 * Modifier names as the platform writes them.
 *
 * A macOS user told to press Alt looks for a key that is labelled Option.
 */
function modifierNames(platform: string) {
  const isMac = platform.toLowerCase().includes('mac')
  return {
    meta: isMac
      ? 'Cmd'
      : platform.toLowerCase().includes('win')
        ? 'Win'
        : 'Super',
    alt: isMac ? 'Option' : 'Alt',
  }
}

const noModifiers = (event: MouseEvent) =>
  !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey

/**
 * Which buttons are down.
 *
 * Reads both `buttons` and `button` because they answer different questions:
 * `buttons` is the current state, which is what a move event has, and `button`
 * is what changed, which is what a down event has.
 */
export const buttonsDown = (event: MouseEvent) => ({
  left: Boolean(event.buttons & 1) || event.button === 0,
  middle: Boolean(event.buttons & 4) || event.button === 1,
  right: Boolean(event.buttons & 2) || event.button === 2,
})

export function cameraMouseGuards(
  platform: string
): Record<CameraSystem, MouseGuard> {
  const { meta, alt } = modifierNames(platform)

  return {
    zoo: {
      label: 'Zoo',
      pan: {
        description: 'Shift + right click drag, or middle click drag',
        matches: (event) =>
          (buttonsDown(event).middle && noModifiers(event)) ||
          (buttonsDown(event).right && event.shiftKey),
      },
      zoom: {
        description: 'Scroll, or Ctrl + right click drag',
        matchesDrag: (event) => Boolean(event.buttons & 2) && event.ctrlKey,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Right click drag',
        matches: (event) => buttonsDown(event).right && noModifiers(event),
      },
    },
    onshape: {
      label: 'OnShape',
      pan: {
        description: 'Ctrl + right click drag, or middle click drag',
        matches: (event) =>
          (buttonsDown(event).right && event.ctrlKey) ||
          (buttonsDown(event).middle && noModifiers(event)),
      },
      zoom: {
        description: 'Scroll',
        matchesDrag: () => false,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Right click drag',
        matches: (event) => buttonsDown(event).right && noModifiers(event),
      },
    },
    trackpad_friendly: {
      label: 'Trackpad Friendly',
      pan: {
        description: `${alt} + Shift + left click drag, or middle click drag`,
        matches: (event) =>
          (buttonsDown(event).left &&
            event.altKey &&
            event.shiftKey &&
            !event.metaKey) ||
          (buttonsDown(event).middle && noModifiers(event)),
      },
      zoom: {
        description: `Scroll, or ${alt} + ${meta} + left click drag`,
        matchesDrag: (event) =>
          buttonsDown(event).left && event.altKey && event.metaKey,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: `${alt} + left click drag`,
        matches: (event) =>
          buttonsDown(event).left &&
          event.altKey &&
          !event.shiftKey &&
          !event.metaKey,
      },
    },
    solidworks: {
      label: 'Solidworks',
      pan: {
        description: 'Ctrl + right click drag',
        matches: (event) => buttonsDown(event).right && event.ctrlKey,
      },
      zoom: {
        description: 'Scroll, or Shift + middle click drag',
        matchesDrag: (event) => buttonsDown(event).middle && event.shiftKey,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Middle click drag',
        matches: (event) => buttonsDown(event).middle && noModifiers(event),
      },
    },
    nx: {
      label: 'NX',
      pan: {
        description: 'Shift + middle click drag',
        matches: (event) => buttonsDown(event).middle && event.shiftKey,
      },
      zoom: {
        description: 'Scroll, or Ctrl + middle click drag',
        matchesDrag: (event) => buttonsDown(event).middle && event.ctrlKey,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Middle click drag',
        matches: (event) => buttonsDown(event).middle && noModifiers(event),
      },
    },
    creo: {
      label: 'Creo',
      pan: {
        description: 'Ctrl + left click drag',
        matches: (event) => {
          const buttons = buttonsDown(event)
          return buttons.left && !buttons.right && event.ctrlKey
        },
      },
      zoom: {
        description: 'Scroll, or Ctrl + right click drag',
        matchesDrag: (event) => {
          const buttons = buttonsDown(event)
          return buttons.right && !buttons.left && event.ctrlKey
        },
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Ctrl + middle click drag, or Ctrl + left and right',
        matches: (event) => {
          const buttons = buttonsDown(event)
          return (
            (buttons.middle || (buttons.left && buttons.right)) && event.ctrlKey
          )
        },
      },
    },
    autocad: {
      label: 'AutoCAD',
      pan: {
        description: 'Middle click drag',
        matches: (event) => buttonsDown(event).middle && noModifiers(event),
      },
      zoom: {
        description: 'Scroll',
        matchesDrag: () => false,
        matchesScroll: (event) => !event.buttons,
      },
      rotate: {
        description: 'Shift + middle click drag',
        matches: (event) => buttonsDown(event).middle && event.shiftKey,
      },
    },
  }
}

/**
 * What a given event means under a given system.
 *
 * Order matters and is inherited from the existing app: pan, then rotate, then
 * zoom. Several systems have overlapping guards — Zoo's rotate is a plain right
 * drag and its pan is Shift plus a right drag — and pan going first is what makes
 * the modified gesture win over the bare one.
 */
export function interactionFor(
  guard: MouseGuard,
  event: MouseEvent | WheelEvent,
  orbit: 'spherical' | 'trackball'
): CameraInteraction | null {
  // Recognised by shape rather than by `instanceof`. A wheel event is the one
  // that carries a delta, and asking that directly avoids depending on which
  // realm the constructor came from.
  if ('deltaY' in event) {
    return guard.zoom.matchesScroll(event) ? 'zoom' : null
  }

  if (guard.pan.matches(event)) return 'pan'
  if (guard.rotate.matches(event)) {
    return orbit === 'trackball' ? 'rotatetrackball' : 'rotate'
  }
  if (guard.zoom.matchesDrag(event)) return 'zoom'
  return null
}
