import type { MlCopilotServerMessage } from '@kittycad/lib'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  ExchangeCard,
  type ExchangeCardProps,
} from '@src/components/ExchangeCard'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe('ExchangeCard replay attachments', () => {
  const attachmentRef = {
    prompt_id: '00000000-0000-4000-8000-000000000001',
    seq: 3,
    index: 1,
  }
  const attachmentKey = `${attachmentRef.prompt_id}:${attachmentRef.seq}:${attachmentRef.index}`

  const exchangeProps = {
    request: {
      type: 'user' as const,
      content: 'Use this reference',
      additional_files: [
        {
          name: 'reference.txt',
          mimetype: 'text/plain',
          data: [],
          attachment_ref: attachmentRef,
        },
      ],
    },
    responses: [],
    deltasAggregated: '',
    isLastResponse: true,
    onClickClearChat: vi.fn(),
  }

  test('loads attachments in the preview dialog and retries failures', async () => {
    const onFetchAttachment = vi.fn()
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} onFetchAttachment={onFetchAttachment} />
    )

    fireEvent.click(screen.getByRole('button', { name: /reference\.txt/ }))
    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
    const dialog = screen.getByRole('dialog', { name: 'Text preview' })

    rerender(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: {
            status: 'error',
            message: 'Attachment unavailable',
          },
        }}
      />
    )
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Attachment unavailable'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(onFetchAttachment).toHaveBeenCalledTimes(2)

    rerender(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: { status: 'loading' },
        }}
      />
    )

    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Loading attachment…'
    )
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull()

    rerender(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: {
            status: 'loaded',
            file: {
              ...exchangeProps.request.additional_files[0],
              data: Array.from(
                new TextEncoder().encode('First line\nSecond line')
              ),
            },
          },
        }}
      />
    )

    await within(dialog).findByText(/First line/)
    expect(dialog.querySelector('pre')?.textContent).toBe(
      'First line\nSecond line'
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close preview' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reference\.txt/ })).toBeEnabled()
  })

  test('renders a metadata-only server file without a reasoning message', () => {
    const onFetchAttachment = vi.fn()

    render(
      <ExchangeCard
        {...exchangeProps}
        request={{
          type: 'user',
          content: 'Create a reference image',
          additional_files: [],
        }}
        responses={[
          {
            files: {
              files: [
                {
                  name: 'generated.png',
                  mimetype: 'image/png',
                  data: [],
                  attachment_ref: attachmentRef,
                },
              ],
            },
          },
        ]}
        onFetchAttachment={onFetchAttachment}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'generated.png: Load attachment',
      })
    )

    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
  })
})

describe('ExchangeCard reasoning after replay', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  test.each([
    { info: { text: 'Message canceled by user.' } },
    { error: { detail: 'Request failed.' } },
  ])('stops reasoning for a terminal notice: %j', (notice) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:01:00.000Z'))
    render(
      <ExchangeCard
        request={{ type: 'user', content: 'Add a hole' }}
        responses={[
          { reasoning: { type: 'text', content: 'Checking constraints' } },
          notice,
        ]}
        deltasAggregated=""
        startedAt={new Date('2026-07-15T12:00:00.000Z')}
        isLastResponse={true}
        onClickClearChat={() => {}}
      />
    )

    expect(screen.getByText('See reasoning')).toBeInTheDocument()
    expect(screen.queryByTestId('thinking-immediate')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('See reasoning'))
    expect(screen.getByText('Checking constraints')).toBeInTheDocument()
    expect(screen.queryByText(/Reasoned for/)).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(120_000)
    })

    expect(screen.queryByText(/Reasoned for/)).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })
})

const manual = 'Manual edits detected since the last Zookeeper state.'
const retry = 'Temporary connection issue. Retrying automatically…'
function renderExchange(notice: MlCopilotServerMessage, answer = '') {
  render(
    <ExchangeCard
      request={{ type: 'user', content: 'Update the model' }}
      responses={[
        { reasoning: { type: 'text', content: 'Checking the current model' } },
        notice,
      ]}
      deltasAggregated={answer}
      startedAt={new Date()}
      isLastResponse={true}
      onClickClearChat={() => {}}
    />
  )
}

describe('ExchangeCard informational responses', () => {
  test.each([manual, `${manual} Rebuilding the model.`])(
    'shows the manual-edit notice without ending reasoning: %s',
    (text) => {
      renderExchange({ info: { text } })
      expect(
        screen.getByTestId('ml-response-info-chat-bubble')
      ).toHaveTextContent(text)
      expect(screen.getByText('Collapse')).toBeInTheDocument()
      expect(screen.queryByText('See reasoning')).not.toBeInTheDocument()
    }
  )
  test('shows retry information once as inline status and keeps reasoning active', () => {
    renderExchange({ info: { text: retry } })
    expect(screen.getByTestId('ml-response-retry-status')).toHaveTextContent(
      retry
    )
    expect(
      screen.queryByTestId('ml-response-info-chat-bubble')
    ).not.toBeInTheDocument()
    expect(screen.getAllByText(retry)).toHaveLength(1)
    expect(screen.getByText('Collapse')).toBeInTheDocument()
  })
  test('shows terminal informational text and collapses reasoning', () => {
    renderExchange({ info: { text: 'Message canceled by user.' } })
    expect(
      screen.getByTestId('ml-response-info-chat-bubble')
    ).toHaveTextContent('Message canceled by user.')
    expect(screen.getByText('See reasoning')).toBeInTheDocument()
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ml-response-chat-bubble-thinking')
    ).not.toBeInTheDocument()
  })
  test('shows terminal errors and collapses reasoning', () => {
    renderExchange({ error: { detail: 'Request failed.' } })
    expect(screen.getByText('Request failed.')).toBeInTheDocument()
    expect(screen.getByText('See reasoning')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ml-response-chat-bubble-thinking')
    ).not.toBeInTheDocument()
  })
  test('shows the completed answer and collapses reasoning', () => {
    renderExchange(
      {
        end_of_stream: {
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      },
      'Model updated.'
    )
    expect(
      within(screen.getByTestId('ml-response-chat-bubble')).getByText(
        'Model updated.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('See reasoning')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ml-response-chat-bubble-thinking')
    ).not.toBeInTheDocument()
  })
})

describe('ExchangeCard manual-edit notice lifetime', () => {
  const exchange: ExchangeCardProps = {
    request: { type: 'user', content: 'Update the model' },
    responses: [
      { reasoning: { type: 'text', content: 'Checking the current model' } },
      { info: { text: manual } },
    ],
    deltasAggregated: 'The model has been updated.',
    isLastResponse: true,
    onClickClearChat: () => {},
  }
  const endings: { name: string; response: MlCopilotServerMessage }[] = [
    {
      name: 'completion',
      response: {
        end_of_stream: {
          started_at: '2026-11-16T12:00:00Z',
          completed_at: '2026-11-16T12:00:01Z',
        },
      },
    },
    { name: 'an error', response: { error: { detail: 'Request failed.' } } },
    {
      name: 'cancellation',
      response: { info: { text: 'Message canceled by user.' } },
    },
  ]

  test.each(endings)(
    'removes the manual-edit notice after $name and preserves the answer and reasoning',
    ({ response }) => {
      const { rerender } = render(<ExchangeCard {...exchange} />)
      expect(screen.getByText(manual)).toBeInTheDocument()

      rerender(
        <ExchangeCard
          {...exchange}
          responses={[...exchange.responses, response]}
        />
      )

      expect(screen.queryByText(manual)).not.toBeInTheDocument()
      expect(
        screen.getByText('The model has been updated.')
      ).toBeInTheDocument()
      fireEvent.click(screen.getByText('See reasoning'))
      expect(screen.getByText('Checking the current model')).toBeInTheDocument()
    }
  )

  test('removes the manual-edit notice when a newer prompt starts and preserves the earlier answer', () => {
    const { rerender } = render(<ExchangeCard {...exchange} />)
    expect(screen.getByText(manual)).toBeInTheDocument()

    rerender(<ExchangeCard {...exchange} isLastResponse={false} />)

    expect(screen.queryByText(manual)).not.toBeInTheDocument()
    expect(screen.getByText('The model has been updated.')).toBeInTheDocument()
  })

  test('keeps terminal notices visible in older exchanges', () => {
    render(
      <ExchangeCard
        {...exchange}
        responses={[
          ...exchange.responses,
          { info: { text: 'Message canceled by user.' } },
        ]}
        isLastResponse={false}
      />
    )

    expect(screen.queryByText(manual)).not.toBeInTheDocument()
    expect(screen.getByText('Message canceled by user.')).toBeInTheDocument()
  })
})
