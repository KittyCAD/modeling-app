// Temporary, opt-in observer. Never read pipe data, change handles, or kill a
// browser. Observing 'exit' independently of 'close' is essential here.
if (process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS === '1') {
  const cp = require('node:child_process')
  const fs = require('node:fs')
  const path = require('node:path')
  const os = require('node:os')
  const { performance } = require('node:perf_hooks')
  const originalSpawn = cp.spawn
  const browsers = new Map()
  const observers = new Map()
  const artifactDir = process.env.WEBKIT_TEARDOWN_DIAGNOSTICS_DIR ||
    path.resolve('test-results/webkit-shutdown-diagnostics')
  const emit = (event, details = {}) => console.log('[webkit-native]', JSON.stringify({
    timestamp: new Date().toISOString(), observerPid: process.pid, event, ...details,
  }))
  const write = (file, data) => {
    try {
      fs.mkdirSync(artifactDir, { recursive: true })
      fs.writeFileSync(path.join(artifactDir, file), JSON.stringify(data, null, 2))
    } catch { emit('artifact.unavailable') }
  }
  // stderr is deliberately discarded: failed tool invocations can include paths
  // or arbitrary OS messages. Only status and explicitly selected output survive.
  const command = (executable, args, timeout = 2500, maxBytes = 1024 * 1024) =>
    new Promise((resolve) => {
      const child = originalSpawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = '', truncated = false, timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
      child.stdout.on('data', (chunk) => {
        if (Buffer.byteLength(stdout) + chunk.length <= maxBytes) stdout += chunk.toString()
        else truncated = true
      })
      child.on('error', () => {})
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, timedOut, truncated, stdout })
      })
    })
  const processes = async () => {
    const result = await command('/bin/ps', ['-axo', 'uid=,pid=,ppid=,pgid=,state=,pcpu=,rss=,etime=,comm='])
    const rows = result.stdout.split('\n').flatMap((line) => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
      return m && Number(m[1]) === process.getuid() ? [{
        pid: Number(m[2]), ppid: Number(m[3]), pgid: Number(m[4]), state: m[5],
        cpuPercent: Number(m[6]), rssKb: Number(m[7]), lifetime: m[8], executable: m[9],
      }] : []
    })
    return { rows, status: { code: result.code, timedOut: result.timedOut, truncated: result.truncated } }
  }
  const metadata = async (record) => {
    const [version, memory, swap, disk, load] = await Promise.all([
      command('/usr/bin/sw_vers', []), command('/usr/bin/vm_stat', []),
      command('/usr/sbin/sysctl', ['-n', 'vm.swapusage']), command('/bin/df', ['-k', os.tmpdir()]),
      command('/usr/bin/uptime', []),
    ])
    const result = { platform: process.platform, arch: process.arch, node: process.version,
      cpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(),
      version, memory, swap, disk, load }
    try {
      const coreDir = path.dirname(require.resolve('playwright-core/package.json', { paths: [process.cwd()] }))
      result.playwright = JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'))).version
      result.webkit = JSON.parse(fs.readFileSync(path.join(coreDir, 'browsers.json'))).browsers.find(b => b.name === 'webkit')
    } catch { result.versionMetadataUnavailable = true }
    write(`${record.pid}-environment.json`, result)
  }
  const snapshot = async (record, state, seconds) => {
    if (state.ended) return
    const started = performance.now()
    const { rows, status } = await processes()
    // XPC helpers may belong to launchd. Establish ownership through the
    // browser's inherited pipes instead of sampling unrelated WebKit apps.
    const candidates = rows.filter(p => p.pid === record.pid || p.pgid === record.pid ||
      /Playwright\.app|com\.apple\.WebKit|WebKit(Network|Web|GPU|Storage)Process/.test(p.executable)).slice(0, 32)
    const descriptorPids = [...new Set([process.pid, ...candidates.map(p => p.pid)])]
    const rawHandles = await command('/usr/sbin/lsof', [
      '-nP', '-a', '-p', descriptorPids.join(','), '-F', 'pcfDdtn',
    ])
    const files = []
    let pid, file
    for (const line of rawHandles.stdout.split('\n')) {
      const key = line[0], value = line.slice(1)
      if (key === 'p') { pid = Number(value); file = undefined }
      else if (key === 'f') { file = { pid, fd: value }; files.push(file) }
      else if (file && ['D', 'd', 't', 'n'].includes(key)) file[key] = value
    }
    const parentFds = new Set(Object.entries(record.parentFds)
      .filter(([slot]) => !record.streams[`${slot}.close`]).map(([, fd]) => String(fd)))
    const parentFiles = files.filter(f => f.pid === process.pid && parentFds.has(f.fd))
    const addresses = f => ['PIPE', 'unix'].includes(f.t)
      ? [f.d, f.D, ...(f.n?.match(/0x[0-9a-f]+/gi) || [])].filter(Boolean) : []
    const pipeAddresses = new Set(parentFiles.flatMap(addresses))
    const linkedPids = new Set(files.filter(f => f.pid !== process.pid &&
      addresses(f).some(address => pipeAddresses.has(address))).map(f => f.pid))
    const relevant = rows.filter(p => p.pid === record.pid || p.pgid === record.pid ||
      p.pid === process.pid || linkedPids.has(p.pid))
    const targets = relevant.filter(p => p.pid !== process.pid).slice(0, 12)
    const pids = targets.map(p => p.pid)
    const handles = { code: rawHandles.code, timedOut: rawHandles.timedOut,
      truncated: rawHandles.truncated, candidateCount: candidates.length,
      parentDescriptors: parentFiles, files: files.filter(f => pids.includes(f.pid)) }
    const data = { timestamp: new Date().toISOString(), label: state.label, seconds, rootPid: record.pid,
      nativeExit: record.exit, nativeClose: record.close, streams: record.streams,
      processes: relevant.map(p => ({ ...p, pipeLinked: linkedPids.has(p.pid) })), processStatus: status, handles,
      host: { freeMemory: os.freemem(), totalMemory: os.totalmem(), loadAverage: os.loadavg() },
      durationMs: Math.round(performance.now() - started) }
    write(`${record.pid}-snapshot-${seconds}s.json`, data)
    emit('snapshot', { rootPid: record.pid, seconds, nativeExit: record.exit,
      nativeClose: record.close, processes: relevant.map(p => ({ pid: p.pid, ppid: p.ppid,
        pgid: p.pgid, state: p.state, cpuPercent: p.cpuPercent, rssKb: p.rssKb,
        executable: path.basename(p.executable) })) })
    // At most one one-second sample per process across both snapshots. Process
    // sampling can fail on protected helpers; that is diagnostic data, not a test failure.
    if (state.ended || seconds === 0) return
    const sampledRoles = new Set()
    const sampleTargets = targets.filter(p => {
      const role = /Networking|NetworkProcess/.test(p.executable) ? 'network' :
        /WebContent|WebProcess/.test(p.executable) ? 'content' :
          /GPU/.test(p.executable) ? 'gpu' : /Playwright\.app/.test(p.executable) ? 'ui' : 'wrapper'
      if (sampledRoles.has(role) || state.sampled.has(p.pid)) return false
      sampledRoles.add(role); state.sampled.add(p.pid); return true
    }).slice(0, 5)
    await Promise.all(sampleTargets.map(async p => {
      const file = path.join(artifactDir, `${record.pid}-sample-${p.pid}.txt`)
      const sample = await command('/usr/bin/sample', [String(p.pid), '1', '10', '-file', file], 4000)
      emit('sample', { rootPid: record.pid, targetPid: p.pid, code: sample.code, timedOut: sample.timedOut })
    }))
    if (seconds === 12 && pids.length && !state.ended) {
      const predicate = pids.map(pid => `processID == ${pid}`).join(' OR ')
      const logs = await command('/usr/bin/log', ['show', '--style', 'ndjson', '--last', '1m', '--predicate', predicate], 3000)
      // Keep only counts of fixed shutdown indicators. Never persist raw log messages.
      const indicators = ['XPCConnectionTerminationWatchdog', 'suspend', 'termination', 'RunningBoard', 'assertion', 'WebSocket', 'SQLite', 'GPU']
      const counts = Object.fromEntries(indicators.map(word => [word,
        logs.stdout.split('\n').filter(line => line.toLowerCase().includes(word.toLowerCase())).length]))
      write(`${record.pid}-system-log-indicators.json`, { counts, code: logs.code,
        timedOut: logs.timedOut, truncated: logs.truncated })
    }
  }
  cp.spawn = function (executable, ...args) {
    const child = originalSpawn.call(this, executable, ...args)
    if (typeof executable !== 'string' || !/[\\/]webkit-[^/\\]+[\\/]pw_run\.sh$/.test(executable)) return child
    const record = { pid: child.pid, launch: performance.now(), exit: null, close: null, streams: {}, parentFds: {} }
    browsers.set(child.pid, record)
    emit('spawn', { rootPid: child.pid, executable })
    child.once('exit', (code, signal) => {
      record.exit = { code, signal, sinceLaunchMs: Math.round(performance.now() - record.launch) }
      emit('exit', { rootPid: child.pid, ...record.exit })
    })
    child.once('close', (code, signal) => {
      record.close = { code, signal, sinceLaunchMs: Math.round(performance.now() - record.launch) }
      emit('close', { rootPid: child.pid, ...record.close })
    })
    for (const fd of [1, 2, 3, 4]) {
      const stream = child.stdio[fd]
      if (!stream) continue
      if (typeof stream._handle?.fd === 'number') record.parentFds[fd] = stream._handle.fd
      for (const event of ['end', 'finish', 'close']) stream.once(event, () => {
        record.streams[`${fd}.${event}`] = Math.round(performance.now() - record.launch)
        emit('stream', { rootPid: child.pid, fd, streamEvent: event,
          sinceLaunchMs: record.streams[`${fd}.${event}`] })
      })
    }
    return child
  }
  // The fixture supplies test identity and the exact start/end of close. No
  // watchdog or browser timeouts are changed by this observer.
  process.on('webkit-teardown-diagnostic', ({ stage, label }) => {
    for (const record of browsers.values()) {
      if (stage === 'start' && !record.close) {
        const state = { label, ended: false, sampled: new Set(), timers: [] }
        observers.set(record.pid, state)
        emit('close.requested', { rootPid: record.pid, label })
        metadata(record).catch(() => emit('metadata.unavailable'))
        for (const seconds of [0, 5, 12]) {
          const timer = setTimeout(() => {
            snapshot(record, state, seconds).catch(() => emit('snapshot.unavailable', { rootPid: record.pid, seconds }))
          }, seconds * 1000)
          timer.unref(); state.timers.push(timer)
        }
      } else if (stage === 'end') {
        const state = observers.get(record.pid)
        if (state && state.label === label) {
          emit('close.completed', { rootPid: record.pid, label })
          state.ended = true
          state.timers.forEach(clearTimeout)
          observers.delete(record.pid)
        }
      }
    }
  })
}
