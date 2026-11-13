import { expect, test as baseTest } from '@e2e/playwright/zoo-test'
import { encode } from '@msgpack/msgpack'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import {
  setProjectIdInProjectTomlContents,
  setZookeeperConversationInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isRecord } from '@src/lib/utils'
import { parse as uuidParse, v4 as uuidv4 } from 'uuid'

const conversationId = '00000000-0000-4000-8000-000000000001'
const projectId = '00000000-0000-4000-8000-000000000002'
const code = '@settings(kclVersion = 3.0)\nsize = 10\n'
const pageTargetBytes = 10 * 1024 * 1024
const slowSetupMs = 35_000

type ReplayScenario = 'small' | 'large' | 'slow' | 'oversized'
interface Transcript {
  count: number
  messageAt: (index: number) => unknown
}
interface PageSummary {
  start: number
  end: number
  bytes: number
}
interface ReplayHarness {
  transcript: Transcript
  initialPage: PageSummary
  pages: PageSummary[]
  connections: number
  pageRequests: number
  pings: number
  initialDelayMs: number
  mainFilePath: string
}

const user = (content: string) => ({ type: 'user', content })
const answer = (content: string) => ({
  end_of_stream: { whole_response: content },
})
const edit = (contents: string) => ({
  tool_output: {
    result: {
      type: 'edit_kcl_code',
      status_code: 200,
      outputs: { 'main.kcl': contents },
    },
  },
})
const bytes = (message: unknown) =>
  new TextEncoder().encode(JSON.stringify(message))

function transcriptFor(scenario: ReplayScenario): Transcript {
  if (scenario === 'large') {
    const contents = `size = 999\n${' '.repeat(52_500)}`
    return {
      count: 15_601,
      messageAt(index) {
        if (index === 0) return { info: { text: 'Conversation started' } }
        const turn = Math.floor((index - 1) / 4)
        switch ((index - 1) % 4) {
          case 0:
            return user(`Question ${turn}`)
          case 1:
            return edit(contents)
          case 2:
            return {
              reasoning: { type: 'text', content: `Checking turn ${turn}` },
            }
          default:
            return answer(`Answer ${turn}`)
        }
      },
    }
  }
  if (scenario === 'oversized') {
    return {
      count: 3,
      messageAt: (index) =>
        index === 0
          ? user('Oversized turn')
          : index === 1
            ? edit(`size = 999\n${' '.repeat(12 * 1024 * 1024)}`)
            : answer('Oversized turn answer'),
    }
  }
  return {
    count: 23,
    messageAt(index) {
      if (index === 0) return user('Older question')
      if (index === 1) return edit('size = 999')
      if (index === 2) return answer('Older answer')
      const turn = Math.floor((index - 3) / 2)
      return index % 2 === 1
        ? user(`Latest question ${turn}`)
        : answer(`Latest answer ${turn}`)
    },
  }
}

function preparePage(transcript: Transcript, end: number, target: number) {
  const messages: number[][] = []
  let start = end
  let size = 0
  while (start > 0) {
    const encoded = bytes(transcript.messageAt(start - 1))
    if (messages.length > 0 && size + encoded.byteLength > target) break
    messages.push(Array.from(encoded))
    size += encoded.byteLength
    start -= 1
  }
  return { messages: messages.reverse(), summary: { start, end, bytes: size } }
}

function firstUserLabel(transcript: Transcript, page: PageSummary) {
  for (let index = page.start; index < page.end; index++) {
    const message = transcript.messageAt(index)
    if (
      isRecord(message) &&
      message.type === 'user' &&
      typeof message.content === 'string'
    ) {
      return message.content
    }
  }
  return undefined
}

const test = baseTest.extend<{
  replayScenario: ReplayScenario
  replay: ReplayHarness
}>({
  replayScenario: ['small', { option: true }],
  replay: async (
    { page, fs, folderSetupFn, homePage, toolbar, scene, replayScenario },
    provide
  ) => {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    const transcript = transcriptFor(replayScenario)
    const target =
      replayScenario === 'small' || replayScenario === 'slow'
        ? Array.from(
            { length: 20 },
            (_, index) => bytes(transcript.messageAt(index + 3)).byteLength
          ).reduce((total, size) => total + size, 0)
        : pageTargetBytes
    const replay: ReplayHarness = {
      transcript,
      initialPage: { start: 0, end: 0, bytes: 0 },
      pages: [],
      connections: 0,
      pageRequests: 0,
      pings: 0,
      initialDelayMs: 0,
      mainFilePath: '',
    }
    const timers = new Set<ReturnType<typeof setTimeout>>()
    await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
      replay.connections += 1
      let nextCursor: string | undefined
      let before = transcript.count
      const params = new URL(client.url()).searchParams
      expect(params.get('conversation_id')).toBe(conversationId)
      expect(params.get('replay')).toBe('true')
      expect(params.get('replay_attachment_mode')).toBe('metadata_only')
      expect(params.get('replay_pagination')).toBe('true')
      const sendPage = (requestId?: string) => {
        const prepared = preparePage(transcript, before, target)
        before = prepared.summary.start
        nextCursor = before > 0 ? uuidv4() : undefined
        replay.pages.push(prepared.summary)
        if (requestId === undefined) replay.initialPage = prepared.summary
        client.send(
          Buffer.from(
            encode({
              replay_page: {
                ...(requestId === undefined ? {} : { request_id: requestId }),
                conversation_id: uuidParse(conversationId),
                messages: prepared.messages,
                ...(nextCursor ? { next_cursor: uuidParse(nextCursor) } : {}),
              },
            })
          )
        )
      }
      client.onMessage((message) => {
        if (typeof message !== 'string') return
        const request: unknown = JSON.parse(message)
        if (!isRecord(request)) return
        if (request.type === 'list_modes') {
          const started = Date.now()
          const finishSetup = () => {
            sendPage()
            replay.initialDelayMs = Date.now() - started
            client.send(
              JSON.stringify({
                conversation_id: { conversation_id: conversationId },
              })
            )
          }
          if (replayScenario === 'slow') {
            const timer = setTimeout(() => {
              timers.delete(timer)
              finishSetup()
            }, slowSetupMs)
            timers.add(timer)
            client.onClose(() => {
              clearTimeout(timer)
              timers.delete(timer)
            })
          } else finishSetup()
        } else if (request.type === 'fetch_replay_page') {
          expect(request.cursor).toBe(nextCursor)
          if (typeof request.request_id !== 'string')
            throw new Error('Missing replay request identifier')
          replay.pageRequests += 1
          sendPage(request.request_id)
        } else if (request.type === 'ping') {
          replay.pings += 1
          client.send(JSON.stringify({ pong: {} }))
        }
      })
    })
    try {
      await folderSetupFn(async (directory) => {
        const projectPath = await fs.join(directory, 'pagination-history')
        replay.mainFilePath = await fs.join(projectPath, 'main.kcl')
        await fs.mkdir(projectPath, { recursive: true })
        await fs.writeFile(replay.mainFilePath, new TextEncoder().encode(code))
        const identified = setProjectIdInProjectTomlContents('', projectId)
        if (identified instanceof Error) throw identified
        const settings = setZookeeperConversationInProjectTomlContents(
          identified,
          process.env.VITE_ZOO_BASE_DOMAIN ?? 'dev.zoo.dev',
          conversationId
        )
        if (settings instanceof Error) throw settings
        await fs.writeFile(
          await fs.join(projectPath, 'project.toml'),
          new TextEncoder().encode(settings)
        )
      })
      await homePage.openProject('pagination-history')
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await provide(replay)
    } finally {
      for (const timer of timers) clearTimeout(timer)
    }
  },
})

const tags = ['@web', '@zookeeper', '@localRenderer']

test(
  'loads older Zookeeper history and reconnects without changing project files',
  { tag: tags },
  async ({ page, replay, fs, toolbar, editor }) => {
    await expect(
      page.getByText('Latest question 9', { exact: true })
    ).toBeVisible()
    expect(replay.pageRequests).toBe(0)
    const loadOlder = page.getByRole('button', { name: 'Load older messages' })
    await loadOlder.scrollIntoViewIfNeeded()
    const anchor = page.getByText('Latest question 0', { exact: true })
    const beforeLoad = await anchor.boundingBox()
    if (!beforeLoad) throw new Error('Missing visible history anchor')
    await loadOlder.click()
    await expect(
      page.getByText('Older question', { exact: true })
    ).toBeVisible()
    await expect(loadOlder).not.toBeVisible()
    expect(replay.pageRequests).toBe(1)
    await expect
      .poll(async () => {
        const position = await anchor.boundingBox()
        return position ? Math.abs(position.y - beforeLoad.y) : Infinity
      })
      .toBeLessThan(2)
    await expect.poll(() => fs.readFile(replay.mainFilePath, 'utf8')).toBe(code)
    await page.reload()
    await expect(
      page.getByText('Latest question 9', { exact: true })
    ).toBeVisible()
    await expect(loadOlder).toBeAttached()
    await expect(
      page.getByText('Older question', { exact: true })
    ).not.toBeAttached()
    expect(replay.connections).toBe(2)
    expect(replay.pageRequests).toBe(1)
    await expect.poll(() => fs.readFile(replay.mainFilePath, 'utf8')).toBe(code)
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await expect(editor.codeContent).toContainText('size = 10')
  }
)

test.describe('opt-in replay acceptance', () => {
  test.skip(
    process.env.ZOOKEEPER_REPLAY_ACCEPTANCE !== '1',
    'Set ZOOKEEPER_REPLAY_ACCEPTANCE=1 to run expensive replay acceptance cases'
  )

  test.describe('customer-scale history', () => {
    test.use({ replayScenario: 'large' })
    test(
      'pages a synthetic 15,601-message, approximately 206 MB transcript',
      { tag: tags },
      async ({ page, replay, fs }) => {
        let sourceBytes = 0
        for (let index = 0; index < replay.transcript.count; index++)
          sourceBytes += bytes(replay.transcript.messageAt(index)).byteLength
        expect(sourceBytes).toBeGreaterThan(200_000_000)
        expect(sourceBytes).toBeLessThan(215_000_000)
        await expect(
          page.getByText('Question 3899', { exact: true })
        ).toBeVisible({ timeout: 30_000 })
        expect(replay.connections).toBe(1)
        expect(replay.pageRequests).toBe(0)
        expect(replay.initialPage.bytes).toBeLessThanOrEqual(pageTargetBytes)
        expect(replay.initialPage.end - replay.initialPage.start).toBeLessThan(
          replay.transcript.count
        )
        let end = replay.initialPage.start
        for (let index = 0; index < 2; index++) {
          const button = page.getByRole('button', {
            name: 'Load older messages',
          })
          await button.scrollIntoViewIfNeeded()
          await button.click()
          await expect.poll(() => replay.pageRequests).toBe(index + 1)
          await expect(
            page.getByRole('button', { name: 'Loading older messages...' })
          ).not.toBeVisible({ timeout: 30_000 })
          const older = replay.pages.at(-1)
          if (!older) throw new Error('Missing older page')
          expect(older.end).toBe(end)
          expect(older.start).toBeLessThan(end)
          expect(older.bytes).toBeLessThanOrEqual(pageTargetBytes)
          const label = firstUserLabel(replay.transcript, older)
          if (!label) throw new Error('Missing older user message')
          await expect(page.getByText(label, { exact: true })).toBeAttached()
          end = older.start
        }
        expect(end).toBeGreaterThan(0)
        await expect
          .poll(() => fs.readFile(replay.mainFilePath, 'utf8'))
          .toBe(code)
        console.log(
          JSON.stringify({
            sourceMessages: replay.transcript.count,
            sourceBytes,
            initialPageBytes: replay.initialPage.bytes,
            pagesRequested: replay.pageRequests,
          })
        )
      }
    )
  })

  test.describe('slow setup', () => {
    test.use({ replayScenario: 'slow' })
    test(
      'survives a 35-second initial-page delay while heartbeats are answered',
      { tag: tags },
      async ({ page, replay, fs }) => {
        await expect(
          page.getByText('Latest question 9', { exact: true })
        ).toBeVisible({ timeout: 60_000 })
        expect(replay.initialDelayMs).toBeGreaterThanOrEqual(slowSetupMs)
        expect(replay.connections).toBe(1)
        expect(replay.pings).toBeGreaterThanOrEqual(5)
        expect(replay.pageRequests).toBe(0)
        await page.getByRole('button', { name: 'Load older messages' }).click()
        await expect(
          page.getByText('Older question', { exact: true })
        ).toBeAttached()
        expect(replay.connections).toBe(1)
        await expect
          .poll(() => fs.readFile(replay.mainFilePath, 'utf8'))
          .toBe(code)
        console.log(
          JSON.stringify({
            setupDelayMs: replay.initialDelayMs,
            heartbeats: replay.pings,
            connections: replay.connections,
          })
        )
      }
    )
  })

  test.describe('oversized message', () => {
    test.use({ replayScenario: 'oversized' })
    test(
      'loads a whole message above the page target without applying its historical edit',
      { tag: tags },
      async ({ page, replay, fs }) => {
        await expect(
          page.getByText('Oversized turn answer', { exact: true })
        ).toBeVisible({ timeout: 30_000 })
        const loadOlder = page.getByRole('button', {
          name: 'Load older messages',
        })
        await loadOlder.click()
        await expect.poll(() => replay.pageRequests).toBe(1)
        await expect(
          page.getByRole('button', { name: 'Loading older messages...' })
        ).not.toBeVisible({ timeout: 30_000 })
        const oversized = replay.pages.at(-1)
        if (!oversized) throw new Error('Missing oversized page')
        expect(oversized.bytes).toBeGreaterThan(pageTargetBytes)
        expect(oversized.end - oversized.start).toBe(1)
        await expect
          .poll(() => fs.readFile(replay.mainFilePath, 'utf8'))
          .toBe(code)
        await loadOlder.click()
        await expect(
          page.getByText('Oversized turn', { exact: true })
        ).toBeAttached()
        await expect(loadOlder).not.toBeVisible()
        expect(replay.pageRequests).toBe(2)
        await expect
          .poll(() => fs.readFile(replay.mainFilePath, 'utf8'))
          .toBe(code)
        console.log(
          JSON.stringify({
            oversizedMessageBytes: oversized.bytes,
            pageTargetBytes,
          })
        )
      }
    )
  })
})
