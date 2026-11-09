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

    fireEvent.click(screen.getByRole('button', { name: /See reasoning/ }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'generated.png: Load attachment',
      })
    )

    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
  })

  test('keeps the initial update and final answer outside completed activity', () => {
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
            reasoning: {
              type: 'markdown',
              content:
                ZOOKEEPER_ACTIVITY_PREFIX +
                JSON.stringify({
                  kind: 'tool',
                  call_id: 'call-1',
                  name: 'read_project_file',
                  status: 'completed',
                  label: 'Read main.kcl',
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

    const activityToggle = screen.getByRole('button', {
      name: /Reasoned for 1m 14s See reasoning/,
    })
    expect(activityToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveClass(
      'border-chalkboard-30'
    )
    expect(screen.getByText('The project is ready.')).toBeVisible()
    expect(
      screen.getByTestId('ml-response-commentary-chat-bubble')
    ).toHaveTextContent('Checking the project.')
    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()

    fireEvent.click(activityToggle)
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Hide reasoning/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByTestId('ml-response-thinking-view')
    ).not.toHaveTextContent('Checking the project.')
  })

  test('starts running activity collapsed below the first commentary bubble', () => {
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

    expect(
      screen.getByRole('button', { name: /See reasoning/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByTestId('ml-response-commentary-chat-bubble')
    ).toHaveTextContent('Checking the project.')
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveClass(
      'border-emerald-500/60'
    )
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(
      screen.queryByText('Read main.kcl · Running')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Reading main.kcl')).not.toBeInTheDocument()
    expect(
      screen.queryByText('The project contains one KCL file.')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /See reasoning/ }))
    expect(
      screen.getByRole('button', { name: /Hide reasoning/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Read main.kcl · Running')).toBeVisible()
    expect(
      screen.getByText('Read main.kcl · Running').closest('details')
    ).toBeNull()
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveClass(
      'overflow-auto'
    )
    expect(
      screen.getByTestId('ml-response-thinking-view')
    ).not.toHaveTextContent('Checking the project.')
  })

  test('shows the first commentary without a duplicate reasoning card before tools start', () => {
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
        ]}
      />
    )

    expect(
      screen.getByTestId('ml-response-commentary-chat-bubble')
    ).toHaveTextContent('Checking the project.')
    expect(screen.queryByTestId('zookeeper-activity-card')).toBeNull()
    expect(screen.queryByTestId('ml-response-chat-bubble-thinking')).toBeNull()
  })

  test('keeps legacy reasoning text out of the compact status', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        responses={[
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
          { reasoning: { type: 'text', content: 'Internal model text' } },
        ]}
      />
    )

    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(screen.queryByText('Internal model text')).not.toBeInTheDocument()
  })

  test('keeps the first commentary separate when a tool starts first', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        responses={[
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
        ]}
      />
    )

    expect(
      screen.getByTestId('ml-response-commentary-chat-bubble')
    ).toHaveTextContent('Checking the project.')
    fireEvent.click(screen.getByRole('button', { name: /See reasoning/ }))
    expect(
      screen.getByTestId('ml-response-thinking-view')
    ).not.toHaveTextContent('Checking the project.')
    expect(screen.getByText('Read main.kcl · Running')).toBeVisible()
  })
})
