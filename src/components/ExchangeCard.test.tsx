import { fireEvent, render, screen } from '@testing-library/react'
import { ExchangeCard } from '@src/components/ExchangeCard'
import { ZOOKEEPER_ACTIVITY_PREFIX } from '@src/lib/zookeeper/activityMessages'
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

  test('starts completed activity folded while keeping the final answer visible', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        request={{ type: 'user', content: 'Inspect the project' }}
        responses={[
          {
            reasoning: {
              type: 'markdown',
              content:
                ZOOKEEPER_ACTIVITY_PREFIX +
                JSON.stringify({
                  kind: 'commentary',
                  text: 'Checking the project.',
                }),
            },
          },
          {
            end_of_stream: {
              whole_response: 'The project is ready.',
              started_at: '2026-11-05T10:00:00Z',
              completed_at: '2026-11-05T10:01:14Z',
            },
          },
        ]}
        deltasAggregated="The project is ready."
      />
    )

    expect(
      screen.getByRole('button', { name: /Worked for 1m 14s/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('The project is ready.')).toBeVisible()
    expect(screen.queryByText('Checking the project.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Worked for 1m 14s/ }))
    expect(screen.getByText('Checking the project.')).toBeVisible()
  })

  test('shows one flat activity section while a turn is running', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        request={{ type: 'user', content: 'Inspect the project' }}
        responses={[
          { reasoning: { type: 'text', content: 'Reading main.kcl' } },
          {
            reasoning: {
              type: 'markdown',
              content: 'The project contains one KCL file.',
            },
          },
          {
            reasoning: {
              type: 'markdown',
              content:
                ZOOKEEPER_ACTIVITY_PREFIX +
                JSON.stringify({
                  kind: 'commentary',
                  text: 'Checking the project.',
                }),
            },
          },
          {
            reasoning: {
              type: 'markdown',
              content:
                ZOOKEEPER_ACTIVITY_PREFIX +
                JSON.stringify({
                  kind: 'tool',
                  call_id: 'call-1',
                  name: 'read_project_file',
                  status: 'started',
                  label: 'Read main.kcl',
                }),
            },
          },
        ]}
      />
    )

    expect(screen.getByRole('button', { name: /Working for/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByText('Checking the project.')).toBeVisible()
    const groupSummary = screen.getByText('Read files')
    expect(groupSummary).toBeVisible()
    expect(groupSummary.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Read main.kcl · Running')).not.toBeVisible()
    expect(screen.queryByText('Reading main.kcl')).not.toBeInTheDocument()
    expect(
      screen.queryByText('The project contains one KCL file.')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('ml-response-thinking-view')).not.toHaveClass(
      'overflow-auto',
      'border'
    )
  })
})
