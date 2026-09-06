// Local, unauthenticated browser reproduction. Run from a checkout of this PR:
//   node scripts/repro-webrtc-disconnect.mjs all
//   node scripts/repro-webrtc-disconnect.mjs repeat
// Requires npm-installed repo dependencies, Google Chrome, and the baseline Git
// object below (fetch it if using a shallow clone). Evidence goes to a fresh OS
// temporary directory, never into the repository. Only the fresh test browser's
// WebRTC packets are interrupted; no host network settings or API are used.
// This runs extracted app handlers, not the full app, Engine, or retry UI.
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'zoo-webrtc-repro-'))
console.error('Writing local evidence to', root)
const require = createRequire(join(repo, 'package.json'))
const { chromium } = require('playwright')
const ts = require('typescript-eslint-typescript')
const { WebSocketServer } = require('ws')
const baseline = 'aafd222600f0fb14f7fed1586de1f9bd495c5ae9'
const scenario = process.argv[2] || 'all'
if (
  ![
    'all',
    'baseline',
    'fixed',
    'cleanup-only',
    'persistent',
    'idle',
    'repeat',
    'probe',
  ].includes(scenario)
)
  throw new Error(`Unknown scenario: ${scenario}`)
const records = []
const emit = (value) => {
  records.push(value)
  console.log(JSON.stringify(value))
}
const read = (file, fixed) =>
  fixed
    ? readFileSync(join(repo, file), 'utf8')
    : execFileSync('git', ['show', `${baseline}:${file}`], {
        cwd: repo,
        encoding: 'utf8',
      })
const parse = (text) =>
  ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true)

// Run the exact application handler and teardown method bodies against real
// browser transports. Avoid importing the authenticated app/Wasm singleton graph.
function implementation(fixed, cleanupOnly = false) {
  const peerText = read(
    'src/lib/engineConnection/peerConnection.ts',
    fixed && !cleanupOnly
  )
  const peerAst = parse(peerText)
  const graceConstant =
    peerAst.statements
      .find(
        (n) =>
          ts.isVariableStatement(n) &&
          n.declarationList.declarations.some(
            (d) =>
              d.name.getText() ===
              'PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS'
          )
      )
      ?.getText() || ''
  const handler = peerAst.statements.find(
    (n) =>
      ts.isFunctionDeclaration(n) &&
      n.name.text === 'createOnConnectionStateChange'
  )
  const connText = read('src/lib/engineConnection/connection.ts', fixed)
  const connClass = parse(connText).statements.find(
    (n) => ts.isClassDeclaration(n) && n.name.text === 'Connection'
  )
  const methods = [
    'disconnectAll',
    'disconnectWebsocket',
    'disconnectUnreliableDataChannel',
    'disconnectPeerConnection',
    'removeAllEventListeners',
    'cleanUpTimeouts',
    'stopPingPong',
  ]
  const bodies = methods
    .map((name) => {
      const member = connClass.members.find((n) => n.name?.getText() === name)
      assert(member, `Missing application method ${name}`)
      return member.getText()
    })
    .join('\n')
  const utils = parse(read('src/lib/engineConnection/utils.ts', false))
  const events = utils.statements
    .find(
      (n) => ts.isEnumDeclaration(n) && n.name.text === 'EngineConnectionEvents'
    )
    .getText()
  const video = fixed ? read('src/lib/videoStream.ts', true) : ''
  const source = `
    const EngineDebugger = { addLog: (entry) => window.appLogs.push({ t: performance.now(), label: entry.label, message: entry.message, state: entry.metadata?.connectionState }) };
    ${events}
    ${graceConstant}
    ${handler.getText()}
    class ExtractedConnection { ${bodies} }
    ${video}
    window.implementation = { createOnConnectionStateChange, ExtractedConnection ${fixed ? ', showFreezeFrame, showLiveVideoOnNextFrame' : ''} };
  `.replace(/\bexport (?=(?:const|function|class|enum)\b)/g, '')
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(
    '<!doctype html><title>Isolated Zoo WebRTC reproduction</title><body style="margin:0;background:#eee"><canvas id="source" width="320" height="180" style="display:none"></canvas><video id="video" muted autoplay playsinline style="display:block;width:320px;height:180px"></video><canvas id="freeze" style="display:none;width:320px;height:180px"></canvas></body>'
  )
})
const wss = new WebSocketServer({ server })
wss.on('connection', (ws) => ws.on('message', (data) => ws.send(data)))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
emit({
  kind: 'environment',
  browser: browser.version(),
  baseline,
  url,
  scope:
    'Local browser RTC pair and echo WebSocket; extracted app functions; no production Engine/API',
})

async function setup({ fixed, cleanupOnly = false }) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 180 },
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await packetLoss(cdp, 0)
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('BROWSER', msg.text())
  })
  page.on('pageerror', (error) => console.error('PAGE ERROR', error.message))
  await page.goto(url)
  await page.evaluate(() => {
    window.appLogs = []
  })
  await page.addScriptTag({ content: implementation(fixed, cleanupOnly) })
  console.error('Source loaded', { fixed, cleanupOnly })
  await page.evaluate(
    async ({ wsUrl, fixed }) => {
      const video = document.querySelector('#video')
      const freeze = document.querySelector('#freeze')
      const source = document.querySelector('#source')
      const brush = source.getContext('2d')
      window.timeline = []
      window.teardowns = []
      window.appEvents = []
      window.closeCalls = 0
      window.framesPresented = 0
      window.echoes = 0
      window.dataEchoes = 0
      window.started = performance.now()
      window.record = (kind, extra = {}) =>
        window.timeline.push({
          ms: Math.round(performance.now() - window.started),
          kind,
          ...extra,
        })
      let drawCount = 0
      window.drawTimer = setInterval(() => {
        brush.fillStyle = '#12bf57'
        brush.fillRect(0, 0, 320, 180)
        brush.fillStyle = '#fafafa'
        brush.fillRect((drawCount++ * 5) % 280, 60, 30, 50)
      }, 50)
      const stream = source.captureStream(20)
      const client = (window.client = new RTCPeerConnection({ iceServers: [] }))
      const remote = (window.remote = new RTCPeerConnection({ iceServers: [] }))
      const nativeClose = client.close.bind(client)
      client.close = () => {
        window.closeCalls++
        window.record('client.close')
        nativeClose()
      }
      for (const [name, pc] of [
        ['client', client],
        ['remote', remote],
      ]) {
        pc.addEventListener('connectionstatechange', () =>
          window.record(`${name}.connection`, { state: pc.connectionState })
        )
        pc.addEventListener('iceconnectionstatechange', () =>
          window.record(`${name}.ice`, { state: pc.iceConnectionState })
        )
      }
      // These are real browser ICE candidates, not synthetic state-change events.
      client.onicecandidate = (event) =>
        event.candidate && remote.addIceCandidate(event.candidate)
      remote.onicecandidate = (event) =>
        event.candidate && client.addIceCandidate(event.candidate)
      const ws = (window.ws = new WebSocket(wsUrl))
      await new Promise((resolve) =>
        ws.addEventListener('open', resolve, { once: true })
      )
      ws.addEventListener('message', () => {
        window.echoes++
      })
      ws.addEventListener('close', () => window.record('websocket.closed'))
      window.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        if (window.dc?.readyState === 'open') window.dc.send('ping')
      }, 200)
      const dc = (window.dc = client.createDataChannel('unreliable', {
        ordered: false,
        maxRetransmits: 0,
      }))
      dc.addEventListener('message', () => {
        window.dataEchoes++
      })
      dc.addEventListener('close', () => window.record('datachannel.closed'))
      remote.ondatachannel = (event) => {
        window.remoteDc = event.channel
        event.channel.onmessage = (message) => event.channel.send(message.data)
      }
      for (const track of stream.getTracks()) remote.addTrack(track, stream)
      client.ontrack = (event) => {
        video.srcObject = event.streams[0]
        conn.mediaStream = event.streams[0]
        window.track = event.track
        event.track.addEventListener('ended', () =>
          window.record('video.track.ended')
        )
        video.play()
      }
      const frame = () => {
        window.framesPresented++
        video.requestVideoFrameCallback(frame)
      }
      video.requestVideoFrameCallback(frame)
      if (fixed)
        video.addEventListener('playing', () =>
          window.implementation.showLiveVideoOnNextFrame(video, freeze)
        )
      const conn = (window.conn =
        new window.implementation.ExtractedConnection())
      Object.assign(conn, {
        id: 'local-test-attempt',
        peerConnection: client,
        websocket: ws,
        unreliableDataChannel: dc,
        allEventListeners: new Map(),
      })
      const tearDownManager = (options) => {
        window.teardowns.push({
          ms: Math.round(performance.now() - window.started),
          options,
        })
        window.record('manager.teardown', options)
        conn.disconnectAll()
      }
      window.intentionalTeardown = () =>
        tearDownManager({ intentionalTestIdle: true })
      const callbacks = window.implementation.createOnConnectionStateChange({
        connection: conn,
        dispatchEvent: (event) => {
          window.appEvents.push({
            ms: Math.round(performance.now() - window.started),
            type: event.type,
          })
          return true
        },
        tearDownManager,
      })
      const handler =
        typeof callbacks === 'function'
          ? callbacks
          : callbacks.onConnectionStateChange
      conn.clearDisconnectedTimeout = callbacks.clearDisconnectedTimeout
      conn.allEventListeners.set('connectionstatechange', {
        type: 'peerConnection',
        event: 'connectionstatechange',
        callback: handler,
      })
      client.addEventListener('connectionstatechange', handler)
      const offer = await client.createOffer({ offerToReceiveVideo: true })
      await client.setLocalDescription(offer)
      await remote.setRemoteDescription(offer)
      const answer = await remote.createAnswer()
      await remote.setLocalDescription(answer)
      await client.setRemoteDescription(answer)
      window.snapshot = async () => {
        const stats = await client.getStats()
        const inbound = [...stats.values()].find(
          (item) => item.type === 'inbound-rtp' && item.kind === 'video'
        )
        const pair = [...stats.values()].find(
          (item) => item.type === 'candidate-pair' && item.nominated
        )
        return {
          ms: Math.round(performance.now() - window.started),
          state: client.connectionState,
          ice: client.iceConnectionState,
          wsState: ws.readyState,
          dcState: dc.readyState,
          trackState: window.track?.readyState,
          framesDecoded: inbound?.framesDecoded,
          framesPresented: window.framesPresented,
          bytesReceived: inbound?.bytesReceived,
          selectedPair: pair
            ? {
                state: pair.state,
                bytesReceived: pair.bytesReceived,
                responsesReceived: pair.responsesReceived,
                requestsReceived: pair.requestsReceived,
              }
            : null,
          echoes: window.echoes,
          dataEchoes: window.dataEchoes,
          closeCalls: window.closeCalls,
          teardowns: window.teardowns,
          trackedListeners: conn.allEventListeners.size,
          timeline: window.timeline,
          appEvents: window.appEvents,
        }
      }
    },
    { wsUrl: url.replace('http:', 'ws:'), fixed }
  )
  console.error(
    'SDP exchanged',
    await page.evaluate(() => ({
      frames: window.framesPresented,
      state: window.client.connectionState,
      dc: window.dc.readyState,
    }))
  )
  await page.waitForFunction(
    () => window.framesPresented > 10 && window.dc.readyState === 'open',
    undefined,
    { timeout: 15000 }
  )
  console.error('Live video confirmed')
  return { context, page, cdp }
}

async function packetLoss(cdp, percent) {
  // This experimental CDP field targets WebRTC packets; HTTP/TCP stays online.
  // No OS firewall, Wi-Fi, or other browser session is modified.
  await cdp.send('Network.emulateNetworkConditionsByRule', {
    offline: false,
    matchedNetworkConditions: [
      {
        urlPattern: '',
        latency: 1,
        downloadThroughput: -1,
        uploadThroughput: -1,
        packetLoss: percent,
      },
    ],
  })
}

async function transient(fixed, extra = {}) {
  const { context, page, cdp } = await setup({ fixed, ...extra })
  try {
    const before = await page.evaluate(() => window.snapshot())
    await packetLoss(cdp, 100)
    await page.evaluate(() => window.record('packetLoss.100percent'))
    console.error('Packet loss enabled')
    await page.waitForFunction(
      () =>
        window.timeline.some(
          (e) => e.kind === 'client.connection' && e.state === 'disconnected'
        ),
      undefined,
      { timeout: 40000 }
    )
    const atDisconnect = await page.evaluate(() => window.snapshot())
    await page.waitForTimeout(2000)
    await packetLoss(cdp, 0)
    await page.evaluate(() => window.record('packetLoss.restored'))
    await page.waitForFunction(
      () =>
        window.client.connectionState === 'connected' ||
        window.client.connectionState === 'closed',
      undefined,
      { timeout: 15000 }
    )
    // Wait past the original grace deadline to catch an uncancelled late teardown.
    await page.waitForTimeout(fixed && !extra.cleanupOnly ? 10500 : 2500)
    const after = await page.evaluate(() => window.snapshot())
    const result = {
      kind: 'transient',
      fixed,
      ...extra,
      before,
      atDisconnect,
      after,
    }
    emit(result)
    if (fixed && !extra.cleanupOnly) {
      assert.equal(after.teardowns.length, 0)
      assert.equal(after.closeCalls, 0)
      assert.equal(after.wsState, 1)
      assert.equal(after.dcState, 'open')
      assert(after.framesDecoded > atDisconnect.framesDecoded + 5)
      assert(after.dataEchoes > atDisconnect.dataEchoes + 5)
    } else {
      assert.equal(after.teardowns.length, 1)
      assert.equal(after.wsState, 3)
      assert.equal(after.closeCalls, extra.cleanupOnly ? 1 : 0)
      assert.equal(after.state, extra.cleanupOnly ? 'closed' : 'connected')
      assert.equal(after.dcState, 'closed')
    }
  } finally {
    await context.close()
  }
}

async function persistent() {
  const { context, page, cdp } = await setup({ fixed: true })
  try {
    await packetLoss(cdp, 100)
    await page.evaluate(() => window.record('packetLoss.100percent'))
    await page.waitForFunction(() => window.teardowns.length > 0, undefined, {
      timeout: 55000,
    })
    await page.waitForTimeout(1200)
    const after = await page.evaluate(() => window.snapshot())
    const disconnected = after.timeline.find(
      (e) => e.kind === 'client.connection' && e.state === 'disconnected'
    )
    const elapsed = after.teardowns[0].ms - disconnected.ms
    emit({ kind: 'persistent', graceElapsedMs: elapsed, after })
    assert.equal(after.teardowns.length, 1)
    assert.equal(after.state, 'closed')
    assert.equal(after.closeCalls, 1)
    assert(elapsed >= 9900 && elapsed < 11000)
  } finally {
    await context.close()
  }
}

async function idle(fixed, freezeBeforeClose) {
  const { context, page } = await setup({ fixed })
  try {
    const before = await page.evaluate(() => window.snapshot())
    await page.evaluate(
      ({ freezeBeforeClose }) => {
        if (freezeBeforeClose)
          window.implementation.showFreezeFrame(
            document.querySelector('#video'),
            document.querySelector('#freeze')
          )
        window.intentionalTeardown()
      },
      { freezeBeforeClose }
    )
    await page.waitForTimeout(1500)
    const after = await page.evaluate(() => window.snapshot())
    const pixel = await page.evaluate(() => {
      const video = document.querySelector('#video')
      const freeze = document.querySelector('#freeze')
      const probe = document.createElement('canvas')
      probe.width = probe.height = 1
      const brush = probe.getContext('2d')
      const visible = freeze.style.display === 'block' ? freeze : video
      brush.drawImage(visible, 0, 0, 1, 1)
      return {
        rgba: [...brush.getImageData(0, 0, 1, 1).data],
        visible: visible.id,
        videoReadyState: video.readyState,
      }
    })
    await page.screenshot({
      path: join(
        root,
        `idle-${fixed ? 'fixed' : 'baseline'}-${freezeBeforeClose ? 'freeze' : 'no-freeze'}.png`
      ),
    })
    emit({ kind: 'idle', fixed, freezeBeforeClose, before, after, pixel })
    assert.equal(after.closeCalls, fixed ? 1 : 0)
    if (fixed && !freezeBeforeClose)
      assert.deepEqual(pixel.rgba, [0, 0, 0, 255])
    if (freezeBeforeClose) {
      assert.equal(pixel.visible, 'freeze')
      assert(pixel.rgba[1] > 100, 'Frozen scene remains green, not black')
      // Exercise the PR's actual onPlaying/next-frame handoff with a new real
      // WebRTC stream. Keep the preserved canvas mounted throughout negotiation.
      await page.evaluate(async () => {
        const source = document.createElement('canvas')
        source.width = 320
        source.height = 180
        const brush = source.getContext('2d')
        window.wakeTimer = setInterval(() => {
          brush.fillStyle = '#235fdd'
          brush.fillRect(0, 0, 320, 180)
          brush.fillStyle = '#fff'
          brush.fillRect(Math.floor(performance.now() / 10) % 280, 60, 30, 50)
        }, 50)
        const stream = source.captureStream(20)
        const receiver = (window.wakeReceiver = new RTCPeerConnection({
          iceServers: [],
        }))
        const sender = (window.wakeSender = new RTCPeerConnection({
          iceServers: [],
        }))
        receiver.onicecandidate = (e) =>
          e.candidate && sender.addIceCandidate(e.candidate)
        sender.onicecandidate = (e) =>
          e.candidate && receiver.addIceCandidate(e.candidate)
        receiver.ontrack = (e) => {
          window.wakeStream = e.streams[0]
        }
        for (const track of stream.getTracks()) sender.addTrack(track, stream)
        const offer = await receiver.createOffer({ offerToReceiveVideo: true })
        await receiver.setLocalDescription(offer)
        await sender.setRemoteDescription(offer)
        const answer = await sender.createAnswer()
        await sender.setLocalDescription(answer)
        await receiver.setRemoteDescription(answer)
      })
      await page.waitForFunction(
        () => window.wakeReceiver.connectionState === 'connected',
        undefined,
        { timeout: 10000 }
      )
      await page.waitForTimeout(700)
      const whileNegotiated = await page.evaluate(() => ({
        freezeDisplay: document.querySelector('#freeze').style.display,
        videoDisplay: document.querySelector('#video').style.display,
      }))
      assert.equal(whileNegotiated.freezeDisplay, 'block')
      await page.evaluate(() => {
        const video = document.querySelector('#video')
        video.srcObject = window.wakeStream
        video.play()
      })
      await page.waitForFunction(
        () =>
          document.querySelector('#freeze').style.display === 'none' &&
          document.querySelector('#video').style.display === 'block',
        undefined,
        { timeout: 10000 }
      )
      const wakePixel = await page.evaluate(() => {
        const probe = document.createElement('canvas')
        probe.width = probe.height = 1
        const brush = probe.getContext('2d')
        brush.drawImage(document.querySelector('#video'), 0, 0, 1, 1)
        return [...brush.getImageData(0, 0, 1, 1).data]
      })
      await page.screenshot({ path: join(root, 'idle-fixed-wake.png') })
      emit({ kind: 'idle-wake', whileNegotiated, wakePixel })
      assert(
        wakePixel[2] > 140 && wakePixel[2] > wakePixel[1],
        'New blue scene replaces frozen green scene'
      )
    }
  } finally {
    await context.close()
  }
}

try {
  if (scenario === 'probe') {
    const { context, page, cdp } = await setup({ fixed: true })
    emit({
      kind: 'probe-before',
      snapshot: await page.evaluate(() => window.snapshot()),
    })
    await packetLoss(cdp, 100)
    await page.waitForTimeout(6000)
    emit({
      kind: 'probe-during',
      snapshot: await page.evaluate(() => window.snapshot()),
    })
    await packetLoss(cdp, 0)
    await context.close()
  }
  if (scenario === 'baseline' || scenario === 'all') await transient(false)
  if (scenario === 'repeat') {
    for (let i = 0; i < 3; i++) {
      await transient(false)
      await transient(true)
    }
  }
  if (scenario === 'fixed' || scenario === 'all') await transient(true)
  if (scenario === 'cleanup-only' || scenario === 'all')
    await transient(true, { cleanupOnly: true })
  if (scenario === 'persistent' || scenario === 'all') await persistent()
  if (scenario === 'idle' || scenario === 'all') {
    await idle(false, false)
    await idle(true, false)
    await idle(true, true)
  }
  emit({ kind: 'completed', scenario })
} catch (error) {
  emit({ kind: 'failure', scenario, error: String(error) })
  throw error
} finally {
  writeFileSync(
    join(root, `results-${scenario}-${Date.now()}.jsonl`),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  )
  await browser.close()
  for (const client of wss.clients) client.terminate()
  wss.close()
  await new Promise((resolve) => server.close(resolve))
}
