interface CommandSource {
  activate: () => void
  deactivate: () => void
}

/** The focused viewport supplies commands; an open palette or dialog retains its invoking view. */
export function bindModelingCommandFocus(
  element: HTMLElement,
  source: CommandSource,
  preserveFocus: () => boolean
) {
  const activate = () => source.activate()
  const blur = (event: FocusEvent) => {
    if (
      (!(event.relatedTarget instanceof Node) ||
        !element.contains(event.relatedTarget)) &&
      !preserveFocus()
    )
      source.deactivate()
  }
  element.addEventListener('focusin', activate)
  element.addEventListener('focusout', blur)
  element.addEventListener('pointerdown', activate, { capture: true })
  if (element.contains(element.ownerDocument.activeElement)) activate()
  return () => {
    element.removeEventListener('focusin', activate)
    element.removeEventListener('focusout', blur)
    element.removeEventListener('pointerdown', activate, { capture: true })
    source.deactivate()
  }
}
