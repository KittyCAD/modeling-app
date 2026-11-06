import { fireEvent, render, screen } from '@testing-library/react'
import { ExchangeCard } from '@src/components/ExchangeCard'
import { describe, expect, test, vi } from 'vitest'

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

  test('requests replay attachment bytes and shows its loading state', () => {
    const onFetchAttachment = vi.fn()
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} onFetchAttachment={onFetchAttachment} />
    )

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
              name: 'opaque-blob-name.png',
            },
          },
        }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'View reference.png' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Download reference.png' })
    ).toHaveAttribute('download', 'reference.png')
    expect(screen.getByText('Loaded')).toBeInTheDocument()
  })

  test('shows every image without expanding the other attachments', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        request={{
          ...exchangeProps.request,
          additional_files: [
            { name: 'notes.txt', mimetype: 'text/plain', data: [1] },
            ...['front.png', 'side.png', 'top.png'].map((name) => ({
              name,
              mimetype: 'image/png',
              data: [1],
            })),
          ],
        }}
      />
    )
    for (const name of ['front.png', 'side.png', 'top.png']) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument()
    }
  })

  test('retries failed replay images only when requested', () => {
    const onFetchAttachment = vi.fn()
    render(
      <ExchangeCard
        {...exchangeProps}
        onFetchAttachment={onFetchAttachment}
        attachmentFetches={{
          [attachmentKey]: { status: 'error', message: 'Temporary failure' },
        }}
      />
    )
    expect(onFetchAttachment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /reference\.png/ }))
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
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
