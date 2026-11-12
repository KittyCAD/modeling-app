import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ExchangeCard } from '@src/components/ExchangeCard'
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
