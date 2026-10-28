import { fireEvent, render, screen } from '@testing-library/react'
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

  test('requests replay attachment bytes and shows its loading state', () => {
    const onFetchAttachment = vi.fn()
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} onFetchAttachment={onFetchAttachment} />
    )

    fireEvent.click(screen.getByRole('button', { name: /Image/ }))
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
      screen.getByRole('button', { name: /Image Loading…/ })
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

    expect(screen.queryByRole('button', { name: /Image/ })).toBeNull()
    expect(
      screen.getByRole('img', { name: 'Attachment preview' })
    ).toHaveAttribute('src', 'blob:image-preview')
    expect(screen.queryByText('Loaded')).not.toBeInTheDocument()
    expect(screen.queryByText('Image')).not.toBeInTheDocument()
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

  test('previews pasted text after loading replay attachment bytes', () => {
    const file = {
      name: 'pasted-text-a2f180bb-d734-46f2-974e-71f804b1f1a1.txt',
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

    fireEvent.click(screen.getByRole('button', { name: /Pasted text/ }))
    expect(props.onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
    expect(screen.queryByText(file.name)).not.toBeInTheDocument()

    const data = Array.from(
      new TextEncoder().encode('First few words\nfrom the pasted reference')
    )
    rerender(
      <ExchangeCard
        {...props}
        attachmentFetches={{
          [attachmentKey]: { status: 'loaded', file: { ...file, data } },
        }}
      />
    )
    const preview = screen.getByText(
      'First few words from the pasted reference'
    )
    expect(preview).toHaveAttribute('title', file.name)
    expect(preview).toHaveClass('line-clamp-2')
  })
})
