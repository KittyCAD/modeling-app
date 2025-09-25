import { withSiteBaseURL } from '@src/lib/withBaseURL'
import Tooltip from '@src/components/Tooltip'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/react-shared'
import { type BillingContext } from '@src/machines/billingMachine'
import { type MlCopilotTool } from '@kittycad/lib'
import { Popover, Transition } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import type {
  Conversation,
  Exchange,
} from '@src/machines/mlEphantManagerMachine2'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  billingContext: BillingContext
  onProcess: (request: string, forcedTools: Set<MlCopilotTool>) => void
  disabled?: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
}

const ML_COPILOT_TOOLS: Readonly<MlCopilotTool[]> = Object.freeze([
  'edit_kcl_code',
  'text_to_cad',
  'mechanical_knowledge_base',
  'web_search',
])
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

const MlCopilotTool = <T extends MlCopilotTool>(props: {
  tool: T
  onRemove: (tool: T) => void
}) => {
  return (
    <button className="flex-none flex flex-row items-center p-0 pr-2">
      <div
        tabIndex={0}
        role="button"
        onClick={() => props.onRemove(props.tool)}
      >
        <CustomIcon name="close" className="w-7 h-7" />
      </div>
      <div className="flex flex-row gap-1 items-center">
        {ML_COPILOT_TOOLS_META[props.tool].icon({ className: 'w-5 h-5' })}
        {ML_COPILOT_TOOLS_META[props.tool].pretty}
      </div>
    </button>
  )
}

export enum ComponentSize {
  Compact = 'compact',
}

export interface MlCopilotToolsProps {
  size?: ComponentSize.Compact
  onAdd: (tool: MlCopilotTool) => void
  children: ReactNode
}
const MlCopilotTools = (props: MlCopilotToolsProps) => {
  const [show, setShow] = useState<boolean>(false)

  const tools = []

  const onClick = (tool: MlCopilotTool) => {
    setShow(false)
    props.onAdd(tool)
  }

  for (let tool of ML_COPILOT_TOOLS) {
    tools.push(
      <div
        tabIndex={0}
        role="button"
        onClick={() => onClick(tool)}
        className="flex flex-row items-center text-nowrap gap-2 cursor-pointer hover:bg-3 p-2 pr-4 rounded-md"
      >
        {ML_COPILOT_TOOLS_META[tool].icon({ className: 'w-7 h-7' })}
        {ML_COPILOT_TOOLS_META[tool].pretty}
      </div>
    )
  }

  return (
    <div className="flex-none">
      <div className={`relative ${show ? '' : 'hidden'}`}>
        <div
          className="flex flex-col gap-2 absolute bg-default mb-1 p-2 border border-chalkboard-70 text-sm rounded-md"
          style={{ left: 1, bottom: 0 }}
        >
          {tools}
        </div>
      </div>
      <button
        onClick={() => setShow(!show)}
        className="bg-default flex flex-row items-center p-0 pr-2"
      >
        <CustomIcon name="settings" className="w-7 h-7" />
        <div className="flex flex-row items-center gap-2">
          {props.children}
          <div className="border-r h-4 b-3"></div>
          <CustomIcon
            onClick={() => setShow(!show)}
            name="plus"
            className="w-5 h-5"
          />
        </div>
      </button>
    </div>
  )
}

const Dots = (props: { onClick: () => void }) => {
  return <button onClick={props.onClick}>...</button>
}

export interface MlEphantForcedToolsProps {
  inputToMatch: string
  forcedTools: Set<MlCopilotTool>
  excludedTools: Set<MlCopilotTool>
  onRemove: (tool: MlCopilotTool) => void
  onAdd: (tool: MlCopilotTool) => void
}
export const MlEphantForcedTools = (props: MlEphantForcedToolsProps) => {
  const [show, setShow] = useState<boolean>(false)

  for (let tool of ML_COPILOT_TOOLS) {
    if (props.forcedTools.has(tool)) continue
    if (props.excludedTools.has(tool)) continue

    if (ML_COPILOT_TOOLS_META[tool].regexp.test(props.inputToMatch)) {
      props.onAdd(tool)
    }
  }

  const tools = Array.from(
    Array.from(props.forcedTools).filter(
      (tool) => !props.excludedTools.has(tool)
    )
  ).map((tool) => <MlCopilotTool tool={tool} onRemove={props.onRemove} />)

  if (show === true && tools.length === 0) {
    setShow(false)
  }

  const overflow = false

  return (
    <div className="flex-1 flex min-w-0 items-end">
      <div className={`relative ${show ? '' : 'hidden'}`}>
        <div
          className="flex flex-col gap-2 absolute hover:bg-2 bg-default mb-1 p-2 border b-3 text-sm rounded-md"
          style={{ left: 1, bottom: 0 }}
        >
          {tools}
        </div>
      </div>
      <div className="contents">
        <MlCopilotTools onAdd={props.onAdd}>
          <div>{tools.length} Tools</div>
        </MlCopilotTools>
        <div className="overflow-hidden flex gap-1">
          {overflow ? <Dots onClick={() => setShow(!show)} /> : tools}
        </div>
      </div>
    </div>
  )
}

// For now there's only one but in the future there'll be more
// We'll have a Dummy as a test item
enum MlEphantPromptContext {
  Dummy = 'o>-<',
}

export interface MlEphantContextsProps {
  contexts: MlEphantPromptContext[]
}
export const MlEphantContexts = (props: MlEphantContextsProps) => { }

interface MlEphantConversationInputProps {
  billingContext: BillingContext
  onProcess: MlEphantConversationProps['onProcess']
  disabled?: boolean
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

  useEffect(() => {
    if (
      value.length === 0 &&
      (excludedTools.size > 0 || forcedTools.size > 0)
    ) {
      setForcedTools(new Set())
      setExcludedTools(new Set())
    }
  }, [value.length])

  const onClick = () => {
    if (props.disabled) return

    if (!value) return
    if (!refDiv.current) return

    setHeightConvo(refDiv.current.getBoundingClientRect().height)

    props.onProcess(value, forcedTools)

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
          className={`bg-transparent outline-none w-full overflow-auto ${isAnimating ? 'hidden' : ''}`}
          style={{ height: '2lh' }}
        ></textarea>
        <div
          className={`${isAnimating ? '' : 'hidden'} overflow-hidden w-full p-2`}
          style={{ height: heightConvo }}
        >
          {lettersForAnimation}
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="flex items-end">
          <MlEphantForcedTools
            inputToMatch={value}
            forcedTools={forcedTools}
            excludedTools={excludedTools}
            onRemove={onRemoveTool}
            onAdd={onAddTool}
          />
          <button
            data-testid="ml-ephant-conversation-input-button"
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 m-0 flex-none bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
          >
            <CustomIcon name="arrowUp" className="w-5 h-5 animate-bounce" />
          </button>
        </div>
      </div>
    </div>
  )
}

const MLEphantConversationStarter = () => {
  return (
    <div className="p-8 text-sm">
      <h2 className="text-lg font-bold">
        Welcome to{' '}
        <span className="dark:text-ml-green light:underline decoration-ml-green underline-offset-4">
          Text-to-CAD
        </span>
      </h2>
      <p className="my-4">Here are some tips for effective prompts:</p>
      <ul className="list-disc pl-4">
        <li className="my-4">
          Be as explicit as possible when describing geometry. Use dimensions,
          use spatial relationships.
        </li>
        <li className="my-4">
          Try using Text-to-CAD to make a model parametric, it's cool.
        </li>
        <li className="my-4">
          Text-to-CAD treats every prompt as a separate instruction.
        </li>
      </ul>
    </div>
  )
}

export const MlEphantConversation2 = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onProcess = (request: string, forcedTools: Set<MlCopilotTool>) => {
    setAutoScroll(true)
    props.onProcess(request, forcedTools)
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
      <ExchangeCard {...exchange} userAvatar={props.userAvatarSrc} />
    )
  )

  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                <MLEphantConversationStarter />
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
              disabled={props.disabled || props.isLoading}
              onProcess={onProcess}
              billingContext={props.billingContext}
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
          Text-to-CAD treats every prompt as separate. Full copilot mode with
          conversational memory is coming soon. Conversations are not currently
          shared between computers.
        </p>
      </Popover.Panel>
    </Transition>
  </Popover>
)
