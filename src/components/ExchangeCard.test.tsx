import { fireEvent, render, screen, within } from '@testing-library/react'
import { ExchangeCard } from '@src/components/ExchangeCard'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('ExchangeCard replay attachments', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

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

  test('opens a replay image immediately, retries loading, and shows the full image', () => {
    const onFetchAttachment = vi.fn()
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} onFetchAttachment={onFetchAttachment} />
    )

    fireEvent.click(screen.getByRole('button', { name: /Image/ }))
    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })

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
              data: [1, 2, 3],
            },
          },
        }}
      />
    )

    expect(
      within(dialog).getByRole('img', { name: 'Attachment preview' })
    ).toHaveAttribute('src', 'blob:image-preview')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close preview' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Attachment preview' })
    ).toBeEnabled()
    expect(screen.queryByText('Loaded')).not.toBeInTheDocument()
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

  test('loads a text attachment into the preview dialog', async () => {
    const file = {
      name: 'requirements.txt',
      mimetype: 'text/plain',
      data: [],
      attachment_ref: attachmentRef,
    }
    const props = {
      ...exchangeProps,
      request: { ...exchangeProps.request, additional_files: [file] },
      onFetchAttachment: vi.fn(),
    }
    const { rerender } = render(<ExchangeCard {...props} />)

    const trigger = screen.getByRole('button', { name: /requirements\.txt/ })
    fireEvent.click(trigger)
    expect(props.onFetchAttachment).toHaveBeenCalledWith(attachmentRef)

    const data = Array.from(
      new TextEncoder().encode('First few words\nfrom the reference')
    )
    rerender(
      <ExchangeCard
        {...props}
        attachmentFetches={{
          [attachmentKey]: { status: 'loaded', file: { ...file, data } },
        }}
      />
    )
    const dialog = screen.getByRole('dialog', { name: 'Text preview' })
    await within(dialog).findByText(/First few words/)
    expect(dialog.querySelector('pre')?.textContent).toBe(
      'First few words\nfrom the reference'
    )
  })
})
