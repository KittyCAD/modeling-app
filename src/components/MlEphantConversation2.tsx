import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { type Selections } from '@src/machines/modelingSharedTypes'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import Tooltip from '@src/components/Tooltip'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/react-shared'
import { type BillingContext } from '@src/machines/billingMachine'
import type { MlReasoningEffort, MlCopilotTool } from '@kittycad/lib'
import { Popover, Transition } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import type {
  Conversation,
  Exchange,
} from '@src/machines/mlEphantManagerMachine2'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { DEFAULT_ML_COPILOT_REASONING_EFFORT } from '@src/lib/constants'

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  contexts: MlEphantManagerPromptContext[]
  billingContext: BillingContext
  onProcess: (
    request: string,
    reasoningEffort: MlReasoningEffort,
    forcedTools: Set<MlCopilotTool>
  ) => void
  disabled?: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  defaultPrompt?: string
}

const ML_REASONING_EFFORT: Readonly<MlReasoningEffort[]> = Object.freeze([
  'low',
  // Disabling medium for now, keeping only low and high
  // 'medium',
  'high',
])
const ML_COPILOT_TOOLS: Readonly<MlCopilotTool[]> = Object.freeze([
  'edit_kcl_code',
  'text_to_cad',
  'mechanical_knowledge_base',
  'web_search',
])
const ML_REASONING_EFFORT_META = Object.freeze({
  low: {
    pretty: 'Fast',
    icon: (props: { className: string }) => (
      <CustomIcon name="stopwatch" className={props.className} />
    ),
  },
  medium: {
    pretty: 'Thoughtful',
    icon: (props: { className: string }) => (
      <CustomIcon name="brain" className={props.className} />
    ),
  },
  high: {
    pretty: 'Thoughtful',
    icon: (props: { className: string }) => (
      <CustomIcon name="brain" className={props.className} />
    ),
  },
} as const)
const ML_COPILOT_TOOLS_META = Object.freeze({
  edit_kcl_code: {
    regexp: /edit|make|change/,
    pretty: 'Edit',
    icon: (props: { className: string }) => (
      <CustomIcon name="beaker" className={props.className} />
    ),
  },
  text_to_cad: {
    regexp: /create|construct|build|design|model/,
    pretty: 'Create',
    icon: (props: { className: string }) => (
      <CustomIcon name="model" className={props.className} />
    ),
  },
  mechanical_knowledge_base: {
    regexp: /what|how|where|why|when/,
    pretty: 'Question',
    icon: (props: { className: string }) => (
      <CustomIcon name="brain" className={props.className} />
    ),
  },
  web_search: {
    regexp: /search|google/,
    pretty: 'Web search',
    icon: (props: { className: string }) => (
      <CustomIcon name="search" className={props.className} />
    ),
  },
} as const)

export interface MlCopilotReasoningEffortsProps {
  onClick: (reasoningEffort: MlReasoningEffort) => void
  children: ReactNode
  current: MlReasoningEffort
}
const MlCopilotReasoningEfforts = (props: MlCopilotReasoningEffortsProps) => {
  const efforts = []
  for (const effort of ML_REASONING_EFFORT) {
    efforts.push(
      <div
        tabIndex={0}
        role="button"
        key={effort}
        onClick={() => props.onClick(effort)}
        className={`flex flex-row items-center text-nowrap gap-2 cursor-pointer hover:bg-3 p-2 pr-4 rounded-md border ${props.current === effort ? 'border-primary' : ''}`}
        data-testid={`ml-copilot-effort-button-${effort}`}
      >
        {ML_REASONING_EFFORT_META[effort].icon({ className: 'w-5 h-5' })}
        {ML_REASONING_EFFORT_META[effort].pretty}
      </div>
    )
  }

  return (
    <div className="flex-none">
      <Popover className="relative">
        <Popover.Button
          data-testid="ml-copilot-efforts-button"
          className="h-7 bg-default flex flex-row items-center gap-1 pl-1 pr-2"
        >
          {props.children}
          <CustomIcon name="caretUp" className="w-5 h-5 ui-open:rotate-180" />
        </Popover.Button>
        <Popover.Panel className="absolute bottom-full left-0 flex flex-col gap-2 bg-default mb-1 p-2 border border-chalkboard-70 text-xs rounded-md">
          {efforts}
        </Popover.Panel>
      </Popover>
    </div>
  )
}

const MlCopilotTool = <T extends MlCopilotTool>(props: {
  tool: T
  onRemove: (tool: T) => void
}) => {
  return (
    <button
      className="group/tool h-7 bg-default flex-none flex flex-row items-center gap-1 pl-1 pr-2"
      onClick={() => props.onRemove(props.tool)}
    >
      <CustomIcon
        name="close"
        className="w-6 h-6 hidden group-hover/tool:block"
      />
      {ML_COPILOT_TOOLS_META[props.tool].icon({
        className: 'w-6 h-6 block group-hover/tool:hidden',
      })}
      {ML_COPILOT_TOOLS_META[props.tool].pretty}
    </button>
  )
}

export interface MlCopilotToolsProps {
  onAdd: (tool: MlCopilotTool) => void
  children: ReactNode
}
const MlCopilotTools = (props: MlCopilotToolsProps) => {
  const tools = []

  const onClick = (tool: MlCopilotTool) => {
    props.onAdd(tool)
  }

  for (let tool of ML_COPILOT_TOOLS) {
    tools.push(
      <div
        tabIndex={0}
        role="button"
        key={tool}
        onClick={() => onClick(tool)}
        className="flex flex-row items-center text-nowrap gap-2 cursor-pointer hover:bg-3 p-2 pr-4 rounded-md"
      >
        {ML_COPILOT_TOOLS_META[tool].icon({ className: 'w-5 h-5' })}
        {ML_COPILOT_TOOLS_META[tool].pretty}
      </div>
    )
  }

  return (
    <div className="flex-none">
      <Popover className="relative">
        <Popover.Button className="h-7 bg-default flex flex-row items-center gap-1 p-0 pr-2">
          <CustomIcon name="settings" className="w-6 h-6" />
          {props.children}
          <CustomIcon name="plus" className="w-5 h-5" />
        </Popover.Button>
        <Popover.Panel className="absolute bottom-full left-0 flex flex-col gap-1 bg-default mb-1 p-2 border border-chalkboard-70 text-xs rounded-md">
          {tools}
        </Popover.Panel>
      </Popover>
    </div>
  )
}

export interface MlEphantExtraInputsProps {
  // TODO: Expand to a list with no type restriction
  context?: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
  inputToMatch: string
  reasoningEffort: MlReasoningEffort
  forcedTools: Set<MlCopilotTool>
  excludedTools: Set<MlCopilotTool>
  onSetReasoningEffort: (effort: MlReasoningEffort) => void
  onRemove: (tool: MlCopilotTool) => void
  onAdd: (tool: MlCopilotTool) => void
}
export const MlEphantExtraInputs = (props: MlEphantExtraInputsProps) => {
  const [overflow, setOverflow] = useState<boolean>(false)
  const widthFromBeforeCollapse = useRef<number>(0)
  const refWrap = useRef<HTMLDivElement>(null)
  const refTools = useRef<HTMLDivElement>(null)

  useEffect(() => {
    for (let tool of ML_COPILOT_TOOLS) {
      if (props.forcedTools.has(tool)) continue
      if (props.excludedTools.has(tool)) continue

      if (ML_COPILOT_TOOLS_META[tool].regexp.test(props.inputToMatch)) {
        props.onAdd(tool)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.forcedTools, props.excludedTools, props.inputToMatch])

  const tools = Array.from(
    Array.from(props.forcedTools).filter(
      (tool) => !props.excludedTools.has(tool)
    )
  ).map((tool) => (
    <MlCopilotTool key={tool} tool={tool} onRemove={props.onRemove} />
  ))

  useEffect(() => {
    if (!refWrap.current) return
    const observer = new ResizeObserver((entries) => {
      if (!refTools.current) return
      if (entries.length === 1) {
        const widthTools = refTools.current.getBoundingClientRect().width
        if (widthTools > entries[0].contentRect.width && overflow === false) {
          widthFromBeforeCollapse.current = widthTools
          setOverflow(true)
        } else if (
          (widthFromBeforeCollapse.current < entries[0].contentRect.width ||
            tools.length === 0) &&
          overflow === true
        ) {
          setOverflow(false)
        }
      }
    })
    observer.observe(refWrap.current)
    return () => {
      observer.disconnect()
    }
  }, [overflow, tools.length, props.context])

  const popover = (
    <Popover className="relative">
      <Popover.Button className="h-7 flex items-center justify-content">
        ...
      </Popover.Button>
      <Popover.Panel className="absolute bottom-full left-0 whitespace-nowrap flex flex-col gap-2 hover:bg-2 bg-default mb-1 p-2 border b-3 text-sm rounded-md">
        {tools}
      </Popover.Panel>
    </Popover>
  )

  return (
    <div ref={refWrap} className="flex-1 flex min-w-0 items-end">
      <div ref={refTools} className="flex flex-row flex-wrap items-end">
        {/* TODO: Generalize to a MlCopilotContexts component */}
        {props.context && (
          <MlCopilotSelectionsContext selections={props.context} />
        )}
        <MlCopilotReasoningEfforts
          onClick={props.onSetReasoningEffort}
          current={props.reasoningEffort}
        >
          {ML_REASONING_EFFORT_META[props.reasoningEffort].icon({
            className: 'w-5 h-5',
          })}
          {ML_REASONING_EFFORT_META[props.reasoningEffort].pretty}
        </MlCopilotReasoningEfforts>
        <MlCopilotTools onAdd={props.onAdd}>
          <div>
            {tools.length} Tool{tools.length !== 1 ? 's' : ''}
          </div>
        </MlCopilotTools>
        <div className="flex">{overflow ? popover : tools}</div>
      </div>
    </div>
  )
}

export const DummyContent = 'o|-<'

export type MlEphantManagerPromptContext =
  | {
      type: 'selections'
      data: Selections
    }
  | {
      type: 'dummy'
      data: typeof DummyContent
    }

export interface MlEphantContextsProps {
  contexts: MlEphantManagerPromptContext[]
}

const MlCopilotSelectionsContext = (props: {
  selections: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
}) => {
  const selectionText = getSelectionTypeDisplayText(props.selections.data)
  return selectionText ? (
    <button className="group/tool h-7 bg-default flex-none flex flex-row items-center gap-1 pl-1 pr-2">
      <CustomIcon name="clipboardCheckmark" className="w-6 h-6 block" />
      {selectionText}
    </button>
  ) : null
}

interface MlEphantConversationInputProps {
  contexts: MlEphantManagerPromptContext[]
  billingContext: BillingContext
  onProcess: MlEphantConversationProps['onProcess']
  disabled?: boolean
  defaultPrompt?: string
}

function BillingStatusBarItem(props: { billingContext: BillingContext }) {
  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className="m-0 p-0 border-0 flex items-stretch"
        data-testid="billing-remaining-bar"
      >
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarFixed}
          error={props.billingContext.error}
          credits={props.billingContext.credits}
          allowance={props.billingContext.allowance}
        />
        {!props.billingContext.error && (
          <Tooltip
            position="left"
            contentClassName="text-xs"
            hoverOnly
            wrapperClassName="ui-open:!hidden"
          >
            Text-to-CAD credits
          </Tooltip>
        )}
      </Popover.Button>
      <Popover.Panel className="absolute right-0 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
        <BillingDialog
          upgradeHref={withSiteBaseURL('/design-studio-pricing')}
          upgradeClick={openExternalBrowserIfDesktop()}
          error={props.billingContext.error}
          credits={props.billingContext.credits}
          allowance={props.billingContext.allowance}
        />
      </Popover.Panel>
    </Popover>
  )
}

const ANIMATION_TIME = 2000

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const refDiv = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState<string>('')
  const [heightConvo, setHeightConvo] = useState(0)
  const [reasoningEffort, setReasoningEffort] = useState<MlReasoningEffort>(
    DEFAULT_ML_COPILOT_REASONING_EFFORT
  )
  const [forcedTools, setForcedTools] = useState<Set<MlCopilotTool>>(new Set())
  const [excludedTools, setExcludedTools] = useState<Set<MlCopilotTool>>(
    new Set()
  )
  const [lettersForAnimation, setLettersForAnimation] = useState<ReactNode[]>(
    []
  )
  const [isAnimating, setAnimating] = useState(false)

  const onRemoveTool = (tool: MlCopilotTool) => {
    forcedTools.delete(tool)
    setForcedTools(new Set(forcedTools))

    if (value.length > 0) {
      excludedTools.add(tool)
      setExcludedTools(new Set(excludedTools))
    }
  }

  const onAddTool = (tool: MlCopilotTool) => {
    forcedTools.add(tool)
    excludedTools.delete(tool)

    setForcedTools(new Set(forcedTools))
    setExcludedTools(new Set(excludedTools))
  }

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  useEffect(() => {
    if (
      value.length === 0 &&
      (excludedTools.size > 0 || forcedTools.size > 0)
    ) {
      setForcedTools(new Set())
      setExcludedTools(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [value.length])

  const onClick = () => {
    if (props.disabled) return

    if (!value) return
    if (!refDiv.current) return

    setHeightConvo(refDiv.current.getBoundingClientRect().height)

    props.onProcess(value, reasoningEffort, forcedTools)

    setLettersForAnimation(
      value.split('').map((c, index) => (
        <span
          key={index}
          style={{
            display: 'inline-block',
            animation: `${Math.random() * 2}s linear 0s 1 normal forwards running send-up`,
          }}
        >
          {c}
        </span>
      ))
    )
    setAnimating(true)
    setValue('')

    setTimeout(() => {
      setAnimating(false)
    }, ANIMATION_TIME)
  }

  useEffect(() => {
    if (!isAnimating && refDiv.current !== null) {
      refDiv.current.focus()
    }
  }, [isAnimating])

  const selectionsContext:
    | Extract<MlEphantManagerPromptContext, { type: 'selections' }>
    | undefined = props.contexts.filter((m) => m.type === 'selections')[0]

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="flex flex-row justify-between">
        <div className="text-sm text-3">Enter a prompt</div>
        <BillingStatusBarItem billingContext={props.billingContext} />
      </div>
      <div className="p-2 border b-4 focus-within:b-default flex flex-col gap-2">
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <textarea
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          data-testid="ml-ephant-conversation-input"
          onChange={(e) => setValue(e.target.value)}
          value={value}
          ref={refDiv}
          onKeyDown={(e) => {
            const isOnlyEnter =
              e.key === 'Enter' && !(e.shiftKey || e.metaKey || e.ctrlKey)
            if (isOnlyEnter) {
              e.preventDefault()
              onClick()
            }
          }}
          className={`bg-transparent outline-none w-full text-sm overflow-auto ${isAnimating ? 'hidden' : ''}`}
          style={{ height: '3lh' }}
        ></textarea>
        <div
          className={`${isAnimating ? '' : 'hidden'} overflow-hidden w-full p-2`}
          style={{ height: heightConvo }}
        >
          {lettersForAnimation}
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="flex items-end">
          <MlEphantExtraInputs
            context={selectionsContext}
            inputToMatch={value}
            reasoningEffort={reasoningEffort}
            forcedTools={forcedTools}
            excludedTools={excludedTools}
            onSetReasoningEffort={setReasoningEffort}
            onRemove={onRemoveTool}
            onAdd={onAddTool}
          />
          <button
            data-testid="ml-ephant-conversation-input-button"
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 flex-none bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
          >
            <CustomIcon name="caretUp" className="w-5 h-5 animate-bounce" />
          </button>
        </div>
      </div>
    </div>
  )
}

export const MlEphantConversation2 = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onProcess = (
    request: string,
    reasoningEffort: MlReasoningEffort,
    forcedTools: Set<MlCopilotTool>
  ) => {
    setAutoScroll(true)
    props.onProcess(request, reasoningEffort, forcedTools)
  }

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current === null) {
      return
    }
    if (props.conversation?.exchanges.length === 0) {
      return
    }

    setTimeout(() => {
      if (refScroll.current == null) {
        return
      }
      refScroll.current.scrollTo({
        top: refScroll.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [props.conversation?.exchanges, autoScroll])

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current == null) {
      return
    }
    if (!props.hasPromptCompleted) {
      return
    }
    refScroll.current.scrollTo({
      top: refScroll.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [props.hasPromptCompleted, autoScroll])

  const exchangeCards = props.conversation?.exchanges.flatMap(
    (exchange: Exchange, exchangeIndex: number) => (
      <ExchangeCard
        key={`exchange-${exchangeIndex}`}
        {...exchange}
        userAvatar={props.userAvatarSrc}
      />
    )
  )

  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                <></>
              ) : (
                <div className="text-center p-4 text-3 text-md animate-pulse">
                  Loading history
                </div>
              )}
              {exchangeCards}
            </div>
          </div>
          <div className="border-t b-4">
            <MlEphantConversationInput
              contexts={props.contexts}
              disabled={props.disabled || props.isLoading}
              onProcess={onProcess}
              billingContext={props.billingContext}
              defaultPrompt={props.defaultPrompt}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const MLEphantConversationPaneMenu2 = () => (
  <Popover className="relative">
    <Popover.Button className="p-0 !bg-transparent border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none">
      <CustomIcon name="questionMark" className="w-5 h-5" />
    </Popover.Button>

    <Transition
      enter="duration-100 ease-out"
      enterFrom="opacity-0 -translate-y-2"
      enterTo="opacity-100 translate-y-0"
      as={Fragment}
    >
      <Popover.Panel className="w-max max-w-md z-10 bg-default flex flex-col gap-4 absolute top-full left-auto right-0 mt-1 p-4 border border-solid b-5 rounded shadow-lg">
        <div className="flex gap-2 items-center">
          <CustomIcon
            name="beaker"
            className="w-5 h-5 bg-ml-green dark:text-chalkboard-100 rounded-sm"
          />
          <p className="text-base font-bold">
            <span className="dark:text-ml-green light:underline decoration-ml-green underline-offset-4">
              Text-to-CAD
            </span>{' '}
            is experimental
          </p>
        </div>
        <p className="text-sm">
          Text-to-CAD is now conversational, so you can refer to previous
          prompts and iterate. Conversations are not currently shared between
          computers.
        </p>
      </Popover.Panel>
    </Transition>
  </Popover>
)
