import { fireEvent, render, screen, within } from '@testing-library/react'
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

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'generated.png: Load attachment',
      })
    )

    expect(onFetchAttachment).toHaveBeenCalledOnce()
    expect(onFetchAttachment).toHaveBeenCalledWith(attachmentRef)
  })

  test('keeps the full activity inside a completed card above the final answer', () => {
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
      name: /Worked for 1m 14s View activity/,
    })
    expect(activityToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveClass(
      'border-chalkboard-30'
    )
    expect(screen.getByText('The project is ready.')).toBeVisible()
    expect(screen.queryByText('Checking the project.')).not.toBeInTheDocument()
    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()

    fireEvent.click(activityToggle)
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Hide activity/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveTextContent(
      'Checking the project.'
    )
  })

  test('starts running activity collapsed with commentary inside the card', () => {
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
      screen.getByRole('button', { name: /View activity/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Checking the project.')).toBeVisible()
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveClass(
      'zk-activity-card-running'
    )
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(
      screen.queryByText('Read main.kcl · Running')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Reading main.kcl')).not.toBeInTheDocument()
    expect(
      screen.queryByText('The project contains one KCL file.')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))
    expect(
      screen.getByRole('button', { name: /Hide activity/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Read main.kcl · Running')).toBeVisible()
    expect(
      screen.getByText('Read main.kcl · Running').closest('details')
    ).toBeNull()
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveClass(
      'overflow-visible'
    )
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveTextContent(
      'Checking the project.'
    )
  })

  test('opens grouped tool rows with one click on View activity', () => {
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
            reasoning: {
              type: 'markdown',
              content:
                ZOOKEEPER_ACTIVITY_PREFIX +
                JSON.stringify({
                  kind: 'tool',
                  call_id: 'call-2',
                  name: 'write_project_file',
                  status: 'completed',
                  label: 'Edited main.kcl',
                }),
            },
          },
        ]}
      />
    )

    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))

    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(screen.getByText('Edited main.kcl')).toBeVisible()
    expect(
      screen.getByText('Read files, edited files').closest('details')
    ).toHaveAttribute('open')
  })

  test('keeps the manual edit notice inside expanded activity', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        request={{ type: 'user', content: 'Inspect the project' }}
        responses={[
          {
            info: {
              text: 'Manual edits detected since the last Zookeeper state.',
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
                  status: 'completed',
                  label: 'Read main.kcl',
                }),
            },
          },
        ]}
      />
    )

    expect(screen.getByText('Checking the project.')).toBeVisible()
    expect(
      screen.queryByTestId('ml-response-info-chat-bubble')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Project files changed since Zookeeper last ran. Using the current files.'
      )
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))

    const activityCard = screen.getByTestId('zookeeper-activity-card')
    const notice = screen.getByTestId('zookeeper-manual-edit-notice')
    expect(activityCard).toContainElement(notice)
    expect(notice).toHaveTextContent(
      'Project files changed since Zookeeper last ran. Using the current files.'
    )
    const activityText = activityCard.textContent ?? ''
    expect(activityText.indexOf('Checking the project.')).toBeLessThan(
      activityText.indexOf('Project files changed')
    )
    expect(activityText.indexOf('Project files changed')).toBeLessThan(
      activityText.indexOf('Read main.kcl')
    )
  })

  test('shows an activity card immediately, before any response arrives', () => {
    render(
      <ExchangeCard
        {...exchangeProps}
        request={{ type: 'user', content: 'Inspect the project' }}
      />
    )

    expect(screen.getByText('Working…')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /View activity/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('ml-response-chat-bubble')).toBeNull()
  })

  test('updates the same collapsed card when the first commentary arrives', () => {
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

    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Checking the project.'
    )
    expect(screen.queryByTestId('ml-response-chat-bubble-thinking')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveTextContent(
      'Checking the project.'
    )
  })

  test('shows a tool label beneath the placeholder without exposing legacy reasoning', () => {
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

    expect(screen.getByText('Working…')).toBeVisible()
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    expect(screen.queryByText('Internal model text')).not.toBeInTheDocument()
  })

  test('shows commentary after a tool starts in the same card', () => {
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

    expect(screen.getAllByTestId('zookeeper-activity-card')).toHaveLength(1)
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Checking the project.'
    )
    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))
    expect(screen.getByTestId('ml-response-thinking-view')).toHaveTextContent(
      'Checking the project.'
    )
    expect(screen.getByText('Read main.kcl · Running')).toBeVisible()
  })

  test('updates one card through multiple statuses and collapses it on completion', () => {
    const activity = (payload: object) => ({
      reasoning: {
        type: 'markdown' as const,
        content: ZOOKEEPER_ACTIVITY_PREFIX + JSON.stringify(payload),
      },
    })
    const first = activity({
      kind: 'commentary',
      text: 'Inspecting the project.',
    })
    const tool = activity({
      kind: 'tool',
      call_id: 'call-1',
      name: 'read_project_file',
      status: 'completed',
      label: 'Read main.kcl',
    })
    const second = activity({
      kind: 'commentary',
      text: 'Building the bracket.',
    })
    const validation = activity({
      kind: 'tool',
      call_id: 'call-2',
      name: 'validate_project_file',
      status: 'completed',
      label: 'Validated main.kcl',
    })
    const request = { type: 'user' as const, content: 'Build a bracket' }
    const { rerender } = render(
      <ExchangeCard {...exchangeProps} request={request} responses={[]} />
    )

    expect(screen.getByText('Working…')).toBeVisible()
    rerender(
      <ExchangeCard {...exchangeProps} request={request} responses={[first]} />
    )
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Inspecting the project.'
    )
    rerender(
      <ExchangeCard
        {...exchangeProps}
        request={request}
        responses={[first, tool]}
      />
    )
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Inspecting the project.'
    )
    expect(screen.getByText('Read main.kcl')).toBeVisible()
    rerender(
      <ExchangeCard
        {...exchangeProps}
        request={request}
        responses={[first, tool, second]}
      />
    )
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Building the bracket.'
    )
    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()
    rerender(
      <ExchangeCard
        {...exchangeProps}
        request={request}
        responses={[first, tool, second, validation]}
      />
    )

    expect(screen.getAllByTestId('zookeeper-activity-card')).toHaveLength(1)
    expect(screen.getByTestId('zookeeper-activity-card')).toHaveTextContent(
      'Building the bracket.'
    )
    expect(
      screen.queryByText('Inspecting the project.')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Read main.kcl')).not.toBeInTheDocument()
    expect(screen.getByText('Validated main.kcl')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /View activity/ }))
    const history =
      screen.getByTestId('ml-response-thinking-view').textContent ?? ''
    expect(history.indexOf('Inspecting the project.')).toBeLessThan(
      history.indexOf('Read main.kcl')
    )
    expect(history.indexOf('Read main.kcl')).toBeLessThan(
      history.indexOf('Building the bracket.')
    )
    expect(history.indexOf('Building the bracket.')).toBeLessThan(
      history.indexOf('Validated main.kcl')
    )

    rerender(
      <ExchangeCard
        {...exchangeProps}
        request={request}
        responses={[
          first,
          tool,
          second,
          validation,
          {
            end_of_stream: {
              whole_response: 'The bracket is ready.',
              started_at: '2026-11-05T10:00:00Z',
              completed_at: '2026-11-05T10:01:14Z',
            },
          },
        ]}
        deltasAggregated="The bracket is ready."
      />
    )

    expect(
      screen.getByRole('button', {
        name: /Worked for 1m 14s View activity/,
      })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('The bracket is ready.')).toBeVisible()
  })
})
