// Temporary engine-free reproduction. Keep the WebSocket open until WebKit
// closes, just as an application connection would be during normal teardown.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { once } = require('node:events')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { webkit, devices } = require('playwright')
const { defaultBrowserType: _defaultBrowserType, ...desktopSafari } = devices['Desktop Safari']

async function main() {
  const server = http.createServer((_, response) => response.end('<!doctype html><title>Shutdown probe</title>'))
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  })
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    socket.write(Buffer.from([0x81, 5, ...Buffer.from('hello')]))
    // Reply to the client's close frame; do not create a missing-close-ack bug.
    socket.on('data', frame => {
      if ((frame[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0x00]))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const results = []
  try {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const scenario of ['blank', 'websocket', 'routed-websocket']) {
        const label = `minimal:${repeat}:${scenario}`
        const started = performance.now()
        const context = await webkit.launchPersistentContext('', { ...desktopSafari, headless: true })
        const launchMs = Math.round(performance.now() - started)
        try {
          const page = context.pages()[0] || await context.newPage()
          let routedConnections = 0
          let forwardedMessages = 0
          if (scenario === 'routed-websocket') {
            await page.routeWebSocket('**/ws/ml/copilot**', client => {
              routedConnections++
              const upstream = client.connectToServer()
              upstream.onMessage(message => {
                forwardedMessages++
                client.send(message)
              })
            })
          }
          if (scenario !== 'blank') {
            await page.goto(origin)
            await page.evaluate(async () => {
              const socket = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws/ml/copilot')
              window.shutdownProbeSocket = socket
              await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Local WebSocket greeting timed out')), 10000)
                socket.onmessage = event => {
                  clearTimeout(timer)
                  if (event.data === 'hello') resolve()
                  else reject(new Error('Unexpected local WebSocket greeting'))
                }
                socket.onerror = () => reject(new Error('Local WebSocket did not open'))
              })
            })
            assert.equal(await page.evaluate(() => window.shutdownProbeSocket.readyState), 1)
            assert.equal(routedConnections, scenario === 'routed-websocket' ? 1 : 0)
            assert.equal(forwardedMessages, scenario === 'routed-websocket' ? 1 : 0)
          } else {
            assert.equal(page.url(), 'about:blank')
          }
        } finally {
          process.emit('webkit-teardown-diagnostic', { stage: 'start', label })
          const closeStarted = performance.now()
          try {
            await context.close()
            const result = { label, repeat, scenario, launchMs, closeMs: Math.round(performance.now() - closeStarted) }
            results.push(result)
            console.log('[webkit-minimal]', JSON.stringify(result))
          } finally {
            process.emit('webkit-teardown-diagnostic', { stage: 'end', label })
          }
        }
      }
    }
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    const directory = process.env.WEBKIT_TEARDOWN_DIAGNOSTICS_DIR || 'test-results/webkit-shutdown-diagnostics'
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'minimal-results.json'), JSON.stringify(results, null, 2))
  }
  assert.equal(results.length, 9)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
