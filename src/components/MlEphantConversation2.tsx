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
  contexts: MlEphantManagerPromptContext[]
  billingContext: BillingContext
  onProcess: (request: string) => void
  disabled?: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  defaultPrompt?: string
}

export interface MlEphantExtraInputsProps {
  // TODO: Expand to a list with no type restriction
  context?: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
}
export const MlEphantExtraInputs = (props: MlEphantExtraInputsProps) => {
  return (
    <div className="flex-1 flex min-w-0 items-end">
      <div className="flex flex-row w-fit-content items-end">
        {/* TODO: Generalize to a MlCopilotContexts component */}
        {props.context && (
          <MlCopilotSelectionsContext selections={props.context} />
        )}
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
    <button className="group/tool flex-none flex flex-row gap-1 items-center p-0 pr-2">
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
  const [lettersForAnimation, setLettersForAnimation] = useState<ReactNode[]>(
    []
  )
  const [isAnimating, setAnimating] = useState(false)

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  const onClick = () => {
    if (props.disabled) return

    if (!value) return
    if (!refDiv.current) return

    setHeightConvo(refDiv.current.getBoundingClientRect().height)

    props.onProcess(value)

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
          <MlEphantExtraInputs context={selectionsContext} />
          <button
            data-testid="ml-ephant-conversation-input-button"
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 flex-none bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
          >
            <CustomIcon name="arrowUp" className="w-5 h-5 animate-bounce" />
          </button>
        </div>
      </div>
    </div>
  )
}

export const MlEphantConversation2 = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onProcess = (request: string) => {
    setAutoScroll(true)
    props.onProcess(request)
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
