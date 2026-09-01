import { Dialog, Menu } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { useApp } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import { kcCall } from '@src/lib/kcClient'
import { fetchWithSessionExpiration } from '@src/lib/sessionExpired'
import { isErr } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import {
  ZookeeperConversationToMarkdown,
  ZookeeperManagerReactContext,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { type FormEvent, useState } from 'react'
import toast from 'react-hot-toast'

async function sendZookeeperConversationFeedback(
  token: string | undefined,
  body: {
    conversation_id: string | undefined
    feedback: string
    conversation_trace: string
  }
): Promise<Error | undefined> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await kcCall(() =>
    fetchWithSessionExpiration(
      withAPIBaseURL('/org/zookeeper/conversation-feedback'),
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      }
    )
  )
  if (isErr(response)) {
    return response
  }
  if (response.ok) {
    return
  }

  const responseBody: unknown = await response.json().catch(() => undefined)
  const message =
    response.status === 429
      ? 'Too many recent feedback submissions. Please try again in a few minutes.'
      : typeof responseBody === 'object' &&
          responseBody !== null &&
          'message' in responseBody &&
          typeof responseBody.message === 'string'
        ? responseBody.message
        : 'Zoo support could not receive this feedback.'
  return new Error(message)
}

export function ZookeeperConversationFeedbackDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const { auth } = useApp()
  const token = auth.useToken()
  const zookeeperManagerActor = ZookeeperManagerReactContext.useActorRef()
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault()

    const trimmedFeedback = feedback.trim()
    if (!trimmedFeedback || isSubmitting) {
      return
    }
    setError(undefined)
    setIsSubmitting(true)

    const context = zookeeperManagerActor.getSnapshot().context
    const conversationTrace = ZookeeperConversationToMarkdown(
      context.conversation
    )
    const result = await sendZookeeperConversationFeedback(token, {
      conversation_id: context.conversationId,
      feedback: trimmedFeedback,
      conversation_trace: conversationTrace,
    })

    if (isErr(result)) {
      setError(result.message)
      setIsSubmitting(false)
      return
    }

    toast.success('Feedback sent to Zoo support.')
    onClose()
  }

  return (
    <Dialog
      open={true}
      onClose={isSubmitting ? () => {} : onClose}
      className="relative z-50"
    >
      <div className="fixed inset-0 grid place-content-center bg-chalkboard-110/80 p-4">
        <Dialog.Panel className="w-[min(92vw,32rem)] rounded border border-chalkboard-30 bg-chalkboard-10 p-4 dark:border-chalkboard-70 dark:bg-chalkboard-100">
          <Dialog.Title as="h2" className="text-xl font-bold">
            Give feedback on this conversation
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-chalkboard-70 dark:text-chalkboard-30">
            Your feedback and a text export of this conversation will be sent to
            Zoo support. The export can include your prompts, Zookeeper
            responses, errors, and file paths.
          </Dialog.Description>

          <form
            onSubmit={(event) => void submitFeedback(event)}
            className="mt-4 space-y-4"
          >
            <label
              className="block text-sm font-medium"
              htmlFor="zookeeper-feedback"
            >
              Feedback
            </label>
            <textarea
              id="zookeeper-feedback"
              data-testid="zookeeper-conversation-feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.currentTarget.value)}
              disabled={isSubmitting}
              maxLength={4000}
              rows={6}
              autoFocus
              className="w-full resize-y rounded-sm border border-chalkboard-30 bg-chalkboard-10 p-2 text-sm dark:border-chalkboard-70 dark:bg-chalkboard-90"
              placeholder="What worked, what did not, or what should Zookeeper do differently?"
            />

            {error ? (
              <p
                className="m-0 text-sm text-destroy-80 dark:text-destroy-20"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <ActionButton
                Element="button"
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </ActionButton>
              <ActionButton
                Element="button"
                type="submit"
                disabled={!feedback.trim() || isSubmitting}
                data-testid="zookeeper-conversation-feedback-submit"
              >
                {isSubmitting ? 'Sending...' : 'Send feedback'}
              </ActionButton>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export function ZookeeperConversationMenu() {
  const { billing } = useApp()
  const billingContext = billing.useContext()
  const zookeeperManagerActor = ZookeeperManagerReactContext.useActorRef()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <HeaderMenu>
        <Menu.Item>
          <button
            type="button"
            onClick={() => {
              const context = zookeeperManagerActor.getSnapshot().context
              const md = ZookeeperConversationToMarkdown(context.conversation)
              const blob = new Blob([new TextEncoder().encode(md)], {
                type: 'text/markdown',
              })
              void browserSaveFile(
                blob,
                `${context.conversationId ?? new Date().toISOString()}.md`,
                ''
              )
            }}
            className="menuButton"
          >
            <span>Export conversation</span>
          </button>
        </Menu.Item>
        {billingContext.isOrg === true ? (
          <Menu.Item>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="menuButton"
            >
              <span>Give feedback on conversation</span>
            </button>
          </Menu.Item>
        ) : null}
      </HeaderMenu>

      {feedbackOpen ? (
        <ZookeeperConversationFeedbackDialog
          onClose={() => setFeedbackOpen(false)}
        />
      ) : null}
    </>
  )
}
