import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { MlEphantManagerContext } from '@src/machines/mlEphantManagerMachine'
import type { ReactNode } from 'react'
import { useRef, useEffect, useState, Fragment } from 'react'
import type { Prompt } from '@src/lib/prompt'
import { PromptCard } from '@src/components/PromptCard'
import { CustomIcon } from '@src/components/CustomIcon'
import { Popover, Transition } from '@headlessui/react'
import Tooltip from '@src/components/Tooltip'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/react-shared'
import { type BillingContext } from '@src/machines/billingMachine'

export interface MlEphantConversationProps {
  isLoading: boolean
  prompts: Prompt[]
  promptsThoughts: MlEphantManagerContext['promptsThoughts']
  billingContext: BillingContext
  onProcess: (requestedPrompt: string) => void
  onFeedback: (id: Prompt['id'], feedback: Prompt['feedback']) => void
  onSeeReasoning: (id: Prompt['id']) => void
  onSeeMoreHistory: (nextPage?: string) => void
  disabled?: boolean
  nextPage?: string
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  defaultPrompt?: string
}

interface MlEphantConversationInputProps {
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
  const [value, setValue] = useState('')
  const refDiv = useRef<HTMLTextAreaElement>(null)
  const [heightConvo, setHeightConvo] = useState(0)
  const [lettersForAnimation, setLettersForAnimation] = useState<ReactNode[]>(
    []
  )
  const [isAnimating, setAnimating] = useState(false)

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  const onClick = () => {
    if (props.disabled) return

    const value = refDiv.current?.value
    if (!value) return
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
          className={`outline-none w-full overflow-auto ${isAnimating ? 'hidden' : ''}`}
          style={{ height: '2lh' }}
        />
        <div
          className={`${isAnimating ? '' : 'hidden'} overflow-hidden w-full p-2`}
          style={{ height: heightConvo }}
        >
          {lettersForAnimation}
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="flex justify-end"
          onClick={() => refDiv.current?.focus()}
        >
          <button
            data-testid="ml-ephant-conversation-input-button"
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 m-0 bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
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

export const MlEphantConversation = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onSeeMoreHistory = () => {
    setAutoScroll(false)
    props.onSeeMoreHistory(props.nextPage)
  }

  const onProcess = (requestedPrompt: string) => {
    setAutoScroll(true)
    props.onProcess(requestedPrompt)
  }

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current === null) {
      return
    }
    if (props.prompts.length === 0) {
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
    }, ANIMATION_TIME / 4) // This is a heuristic. I'm sorry. We'd need to
    // hook up "animation is done" otherwise to all children.
  }, [props.prompts.length, autoScroll])

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

  const promptCards = props.prompts.map((prompt) => (
    <PromptCard
      key={prompt.id}
      {...prompt}
      userAvatar={props.userAvatarSrc}
      thoughts={props.promptsThoughts.get(prompt.id)}
      disabled={prompt.status !== 'completed'}
      onSeeReasoning={props.onSeeReasoning}
      onFeedback={props.onFeedback}
    />
  ))
  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                props.nextPage ? (
                  /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
                  <div
                    onClick={() => onSeeMoreHistory()}
                    className="cursor-pointer underline text-center p-4 text-chalkboard-60 text-sm"
                  >
                    See more history
                  </div>
                ) : (
                  <MLEphantConversationStarter />
                )
              ) : (
                <div className="text-center p-4 text-chalkboard-60 text-md animate-pulse">
                  Loading history
                </div>
              )}
              {promptCards}
            </div>
          </div>
          <div className="border-t b-4">
            <MlEphantConversationInput
              billingContext={props.billingContext}
              disabled={props.disabled || props.isLoading}
              onProcess={onProcess}
              defaultPrompt={props.defaultPrompt}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const MLEphantConversationPaneMenu = () => (
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
