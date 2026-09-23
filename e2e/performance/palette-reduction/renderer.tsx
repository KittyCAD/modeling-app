import { Combobox, Popover, Transition } from '@headlessui/react'
import type {
  PalettePresentation,
  PresentationNode,
} from '@e2e/performance/palette-reduction/presentation'
import { noAutofillInputProps } from '@src/lib/autofill'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { interactionOutcomes } from '@src/lib/interactionPerformance/outcomes'
import { InteractionRecorder } from '@src/lib/interactionPerformance/recorder'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { Fragment, createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

declare const PALETTE_PRESENTATION: PalettePresentation

const presentation = PALETTE_PRESENTATION
const attributeNames: Record<string, string> = {
  class: 'className',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
}

function CapturedTooltip({
  attributes,
  children,
}: {
  attributes: Record<string, unknown>
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tooltip = ref.current
    const parent = tooltip?.parentElement
    if (!tooltip || !parent) return
    const show = () => tooltip.showPopover({ source: parent })
    const hide = () => tooltip.hidePopover()
    parent.addEventListener('mouseenter', show)
    parent.addEventListener('focus', show)
    parent.addEventListener('mouseleave', hide)
    parent.addEventListener('blur', hide)
    return () => {
      parent.removeEventListener('mouseenter', show)
      parent.removeEventListener('focus', show)
      parent.removeEventListener('mouseleave', hide)
      parent.removeEventListener('blur', hide)
    }
  }, [])
  return (
    <div {...attributes} ref={ref}>
      {children}
    </div>
  )
}

function renderNode(
  node: PresentationNode | string,
  close: () => void,
  key: string
): ReactNode {
  if (typeof node === 'string') return node
  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'style') {
      props.style = { '--_delay': value.replace('--_delay:', '') }
      continue
    }
    props[attributeNames[name] ?? name] =
      name === 'disabled' || name === 'inert' ? true : value
  }
  const children = node.children.map((child, index) =>
    renderNode(child, close, `${key}.${index}`)
  )
  if (node.attributes.role === 'tooltip') {
    return <CapturedTooltip key={key} attributes={props} children={children} />
  }
  if (node.attributes.role === 'combobox') {
    return <Combobox.Input {...props} {...noAutofillInputProps} autoFocus />
  }
  if (node.attributes.role === 'listbox') {
    return createElement(Combobox.Options, { ...props, static: true }, children)
  }
  if (node.attributes.role === 'option') {
    return createElement(
      Combobox.Option,
      {
        ...props,
        value: key,
        disabled: node.attributes['aria-disabled'] === 'true',
      },
      children
    )
  }
  if (
    node.attributes['data-testid'] === interactions.commandPaletteClose.testId
  ) {
    props.onClick = close
  }
  return createElement(node.tag, props, children.length ? children : undefined)
}

function PaletteReduction() {
  const [open, setOpen] = useState(false)
  const launcher = presentation.geometry.launcher
  return (
    <>
      <div style={{ position: 'absolute', left: launcher.x, top: launcher.y }}>
        <button
          type="button"
          className={presentation.launcher.attributes.class}
          data-testid={interactions.commandPaletteOpen.testId}
          data-interaction-id={interactions.commandPaletteOpen.id}
          data-expect-interaction-ms={interactions.commandPaletteOpen.budgetMs}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setOpen(true)}
        >
          {presentation.launcher.children.map((node, index) =>
            renderNode(node, () => setOpen(false), `launcher.${index}`)
          )}
        </button>
      </div>
      <Transition.Root show={open} as={Fragment}>
        <Popover
          className={presentation.wrapper.attributes.class}
          data-testid="command-bar-wrapper"
        >
          <Transition.Child
            enter="duration-100 ease-out"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="duration-75 ease-in"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Popover.Panel
              as="div"
              className={presentation.panel.attributes.class}
              data-testid="command-bar"
            >
              <Combobox defaultValue={null} onChange={() => undefined}>
                {presentation.panel.children
                  .slice(0, 2)
                  .map((node, index) =>
                    renderNode(node, () => setOpen(false), `search.${index}`)
                  )}
              </Combobox>
              {presentation.panel.children
                .slice(2)
                .map((node, index) =>
                  renderNode(node, () => setOpen(false), `close.${index}`)
                )}
            </Popover.Panel>
          </Transition.Child>
        </Popover>
      </Transition.Root>
    </>
  )
}

interface FrameEvidence {
  at: number
  animations: {
    property: string | null
    currentTime: number | string | null
    startTime: number | string | null
    pending: boolean
    playState: AnimationPlayState
  }[]
}

export interface ReductionCapture {
  snapshot(): InteractionSnapshot
  stop(): { snapshot: InteractionSnapshot; frames: FrameEvidence[] }
}

export function createCapture({
  extraFrameObserverEnabled = true,
}: {
  extraFrameObserverEnabled?: boolean
} = {}): ReductionCapture {
  const recorder = new InteractionRecorder(document, [
    interactionOutcomes.commandPaletteOpen,
    interactionOutcomes.commandPaletteClose,
  ])
  const frames: FrameEvidence[] = []
  let frame: number | undefined
  const time = (value: CSSNumberish | null) =>
    typeof value === 'number' ? value : (value?.toString() ?? null)
  function observeFrame() {
    const wrapper = document.querySelector(
      '[data-testid="command-bar-wrapper"]'
    )
    frames.push({
      at: performance.now(),
      animations: (wrapper?.getAnimations({ subtree: true }) ?? []).map(
        (animation) => ({
          property:
            animation instanceof CSSTransition
              ? animation.transitionProperty
              : null,
          currentTime: time(animation.currentTime),
          startTime: time(animation.startTime),
          pending: animation.pending,
          playState: animation.playState,
        })
      ),
    })
    frame = requestAnimationFrame(observeFrame)
  }
  recorder.start()
  if (extraFrameObserverEnabled) frame = requestAnimationFrame(observeFrame)
  return {
    snapshot: () => recorder.snapshot(),
    stop: () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      return { snapshot: recorder.stop(), frames }
    },
  }
}

document.body.className = presentation.bodyClass
document.documentElement.style.colorScheme = presentation.colorScheme
document.body.style.width = '1200px'
document.body.style.height = '800px'
document.documentElement.style.width = '1200px'
document.documentElement.style.height = '800px'
const root = document.getElementById('root')
if (root) createRoot(root).render(<PaletteReduction />)
