import type { MlCopilotServerMessage } from '@kittycad/lib'
import { fireEvent, render, screen } from '@testing-library/react'
import { ExchangeCard } from '@src/components/ExchangeCard'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe('ExchangeCard', () => {
  afterEach(() => vi.restoreAllMocks())

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
          name: 'reference.png',
          mimetype: 'image/png',
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

  test('defers completed reasoning layout until it is opened', () => {
    const measurements = vi.spyOn(
      HTMLElement.prototype,
      'getBoundingClientRect'
    )

    render(
      <ExchangeCard
        {...exchangeProps}
        responses={[
          { reasoning: { type: 'markdown', content: 'Historical reasoning' } },
          { end_of_stream: { whole_response: 'Done' } },
        ]}
      />
    )

    expect(
      measurements.mock.contexts.some(
        (element) =>
          element instanceof HTMLElement &&
          element.textContent?.includes('Historical reasoning')
      )
    ).toBe(false)

    fireEvent.click(screen.getByText('See reasoning'))
    expect(screen.getByText('Historical reasoning')).toBeVisible()
  })

  test('shows live reasoning and collapses it when the response completes', () => {
    const reasoning: MlCopilotServerMessage = {
      reasoning: { type: 'markdown', content: 'Live reasoning' },
    }
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} responses={[reasoning]} />
    )
    expect(screen.getByText('Live reasoning')).toBeVisible()

    rerender(
      <ExchangeCard
        {...exchangeProps}
        responses={[reasoning, { end_of_stream: { whole_response: 'Done' } }]}
      />
    )
    expect(screen.queryByText('Live reasoning')).not.toBeInTheDocument()
  })

  test('requests replay attachment bytes and shows its loading state', () => {
    const onFetchAttachment = vi.fn()
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} onFetchAttachment={onFetchAttachment} />
    )

    fireEvent.click(screen.getByRole('button', { name: /reference\.png/ }))
    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)

    rerender(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: { status: 'loading' },
        }}
      />
    )

    expect(
      screen.getByRole('button', { name: /reference\.png Loading…/ })
    ).toBeDisabled()

    rerender(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: {
            status: 'loaded',
            file: {
              ...exchangeProps.request.additional_files[0],
              data: [1, 2, 3],
            },
          },
        }}
      />
    )

    expect(screen.queryByRole('button', { name: /reference\.png/ })).toBeNull()
    expect(screen.getByText('Loaded')).toBeInTheDocument()
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
