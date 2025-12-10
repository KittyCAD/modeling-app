import { getSelectionTypeDisplayText } from '@src/lib/selections'
import Loading from '@src/components/Loading'
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
import type { MlCopilotMode } from '@kittycad/lib'
import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import type {
  Conversation,
  Exchange,
} from '@src/machines/mlEphantManagerMachine2'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ML_COPILOT_MODE } from '@src/lib/constants'
import { kclManager } from '@src/lib/singletons'

const noop = () => {}

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  contexts: MlEphantManagerPromptContext[]
  billingContext: BillingContext
  onProcess: (request: string, mode: MlCopilotMode) => void
  onInterrupt: () => void
  onClickClearChat: () => void
  onReconnect: () => void
  disabled?: boolean
  needsReconnect: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  defaultPrompt?: string
}

const ML_COPILOT_MODE_META = Object.freeze({
  fast: {
    pretty: 'Fast',
    icon: (props: { className: string }) => (
      <CustomIcon name="stopwatch" className={props.className} />
    ),
  },
  thoughtful: {
    pretty: 'Thoughtful',
    icon: (props: { className: string }) => (
      <CustomIcon name="brain" className={props.className} />
    ),
  },
} as const)

const ML_COPILOT_MODE: Readonly<MlCopilotMode[]> = Object.freeze([
  'fast',
  'thoughtful',
])

export interface MlCopilotModesProps {
  onClick: (mode: MlCopilotMode) => void
  children: ReactNode
  current: MlCopilotMode
}

const MlCopilotModes = (props: MlCopilotModesProps) => {
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
          {({ close }) => (
            <>
              {' '}
              {ML_COPILOT_MODE.map((mode) => (
                <div
                  tabIndex={0}
                  role="button"
                  key={mode}
                  onClick={() => {
                    close()
                    props.onClick(mode)
                  }}
                  className={`flex flex-row items-center text-nowrap gap-2 cursor-pointer hover:bg-3 p-2 pr-4 rounded-md border ${props.current === mode ? 'border-primary' : ''}`}
                  data-testid={`ml-copilot-effort-button-${mode}`}
                >
                  {ML_COPILOT_MODE_META[mode].icon({ className: 'w-5 h-5' })}
                  {ML_COPILOT_MODE_META[mode].pretty}
                </div>
              ))}
            </>
          )}
        </Popover.Panel>
      </Popover>
    </div>
  )
}

export interface MlEphantExtraInputsProps {
  // TODO: Expand to a list with no type restriction
  context?: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
  mode: MlCopilotMode
  onSetMode: (mode: MlCopilotMode) => void
}

export const MlEphantExtraInputs = (props: MlEphantExtraInputsProps) => {
  return (
    <div className="flex-1 flex min-w-0 items-end">
      <div className="flex flex-row w-fit-content items-end">
        {/* TODO: Generalize to a MlCopilotContexts component */}
        {props.context && (
          <MlCopilotSelectionsContext selections={props.context} />
        )}
        <MlCopilotModes onClick={props.onSetMode} current={props.mode}>
          {ML_COPILOT_MODE_META[props.mode].icon({
            className: 'w-5 h-5',
          })}
          {ML_COPILOT_MODE_META[props.mode].pretty}
        </MlCopilotModes>
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
  const selectionText = getSelectionTypeDisplayText(
    kclManager.astSignal.value,
    props.selections.data
  )
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
  onReconnect: MlEphantConversationProps['onReconnect']
  onInterrupt: MlEphantConversationProps['onInterrupt']
  hasPromptCompleted: MlEphantConversationProps['hasPromptCompleted']
  disabled?: boolean
  needsReconnect: boolean
  defaultPrompt?: string
  hasAlreadySentPrompts: boolean
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
            Zookeeper credits
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

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const refDiv = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState<string>('')
  const [mode, setMode] = useState<MlCopilotMode>(DEFAULT_ML_COPILOT_MODE)

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  const onClick = () => {
    if (props.disabled) return

    if (!value) return
    if (!refDiv.current) return

    props.onProcess(value, mode)
    setValue('')
  }

  const selectionsContext:
    | Extract<MlEphantManagerPromptContext, { type: 'selections' }>
    | undefined = props.contexts.filter((m) => m.type === 'selections')[0]

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="flex flex-row justify-between">
        <div>
          <div className="text-3 text-xs">
            Zookeeper can make mistakes. Always verify information.
          </div>
        </div>
        <BillingStatusBarItem billingContext={props.billingContext} />
      </div>
      <div className="p-2 border b-4 focus-within:b-default flex flex-col gap-2">
        <textarea
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          data-testid="ml-ephant-conversation-input"
          onChange={(e) => setValue(e.target.value)}
          value={value}
          ref={refDiv}
          placeholder={
            props.hasAlreadySentPrompts
              ? ''
              : 'Create a gear with 10 teeth and use sensible defaults for everything else...'
          }
          onKeyDown={(e) => {
            const isOnlyEnter =
              e.key === 'Enter' && !(e.shiftKey || e.metaKey || e.ctrlKey)
            if (isOnlyEnter) {
              e.preventDefault()
              onClick()
            }
          }}
          className="bg-transparent outline-none w-full text-sm overflow-auto"
          style={{ height: '3lh' }}
        ></textarea>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="flex items-end">
          <MlEphantExtraInputs
            context={selectionsContext}
            mode={mode}
            onSetMode={setMode}
          />
          <div className="flex flex-row gap-1">
            {props.needsReconnect && (
              <div className="flex flex-col w-fit items-end">
                <div className="pr-1 text-xs text-red-500 flex flex-row items-center h-5">
                  <CustomIcon name="close" className="w-7 h-7" />{' '}
                  <span>Disconnected</span>
                </div>
                <button onClick={props.onReconnect}>Reconnect</button>
              </div>
            )}
            {props.hasPromptCompleted ? (
              <button
                data-testid="ml-ephant-conversation-input-button"
                disabled={props.disabled}
                onClick={onClick}
                className="w-10 flex-none bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
              >
                <CustomIcon name="caretUp" className="w-5 h-5 animate-bounce" />
              </button>
            ) : (
              <button
                data-testid="ml-ephant-conversation-input-button"
                onClick={props.onInterrupt}
                className="w-10 flex-none bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
              >
                <CustomIcon name="close" className="w-5 h-5 animate-pulse" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const StarterCard = () => {
  const [, setTrigger] = useState<number>(0)

  useEffect(() => {
    const i = setInterval(() => {
      setTrigger((t) => t + 1)
    }, 500)
    return () => {
      clearInterval(i)
    }
  }, [])

  return (
    <ExchangeCard
      onClickClearChat={() => {}}
      isLastResponse={false}
      responses={[]}
      deltasAggregated="Try requesting a model, ask engineering questions, or let's explore ideas."
    />
  )
}

export const MlEphantConversation2 = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onProcess = (request: string, mode: MlCopilotMode) => {
    setAutoScroll(true)
    props.onProcess(request, mode)
  }

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
    (exchange: Exchange, exchangeIndex: number, list) => {
      const isLastResponse = exchangeIndex === list.length - 1
      return (
        <ExchangeCard
          key={`exchange-${exchangeIndex}`}
          {...exchange}
          userAvatar={props.userAvatarSrc}
          isLastResponse={isLastResponse}
          onClickClearChat={isLastResponse ? props.onClickClearChat : noop}
        />
      )
    }
  )

  const hasCards = exchangeCards !== undefined && exchangeCards.length > 0

  useEffect(() => {
    if (refScroll.current === null) return
    refScroll.current.scrollTo({
      top: refScroll.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [hasCards])

  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                exchangeCards !== undefined && exchangeCards.length > 0 ? (
                  exchangeCards
                ) : (
                  <StarterCard />
                )
              ) : (
                <div className="text-center p-4 text-3 text-md animate-pulse">
                  <Loading></Loading>
                </div>
              )}
            </div>
          </div>
          <div className="border-t b-4">
            <MlEphantConversationInput
              contexts={props.contexts}
              disabled={props.disabled || props.isLoading}
              hasPromptCompleted={props.hasPromptCompleted}
              needsReconnect={props.needsReconnect}
              onProcess={onProcess}
              onReconnect={props.onReconnect}
              onInterrupt={props.onInterrupt}
              billingContext={props.billingContext}
              defaultPrompt={props.defaultPrompt}
              hasAlreadySentPrompts={
                exchangeCards !== undefined && exchangeCards.length > 0
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
