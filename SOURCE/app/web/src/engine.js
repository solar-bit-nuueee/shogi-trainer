// USI engine controller with two backends:
//
//   native : Android APK — the engine runs as a real process via the
//            ShogiEngine Capacitor plugin. Required there, because Android's
//            WebView has no site isolation, so SharedArrayBuffer (and hence
//            the threaded WASM build) can never work inside it.
//   wasm   : browsers — YaneuraOu compiled to WebAssembly, loaded on demand.
//
// Both speak USI; the rest of the app only uses analyze().
import { Capacitor, registerPlugin } from '../vendor/capacitor-core.mjs'

const BASE = 'vendor/engine/'
const GLUE = BASE + 'yaneuraou.halfkp.js'
const MULTIPV = 3

// ---- backend detection -----------------------------------------------------
const ShogiEngine = registerPlugin('ShogiEngine')

function nativePlugin() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ShogiEngine') ? ShogiEngine : null
}

function parseInfo(line) {
  const t = line.split(/\s+/)
  let scoreCp = null
  let mate = null
  let depth = null
  let multipv = 1
  let nodes = null
  let nps = null
  let pv = []
  for (let i = 1; i < t.length; i++) {
    if (t[i] === 'depth') depth = Number(t[i + 1])
    else if (t[i] === 'multipv') multipv = Number(t[i + 1])
    else if (t[i] === 'nodes') nodes = Number(t[i + 1])
    else if (t[i] === 'nps') nps = Number(t[i + 1])
    else if (t[i] === 'score') {
      if (t[i + 1] === 'cp') scoreCp = Number(t[i + 2])
      else if (t[i + 1] === 'mate') mate = Number(t[i + 2])
    } else if (t[i] === 'pv') {
      pv = t.slice(i + 1)
      break
    }
  }
  return { depth, multipv, scoreCp, mate, nodes, nps, pv }
}

let scriptPromise = null
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('failed to load ' + src))
    document.head.appendChild(s)
  })
}

export class Engine {
  constructor() {
    this.ready = false
    this.backend = null // 'native' | 'wasm'
    this.module = null
    this._native = null
    this._loading = null
    this._listeners = new Set()
    this._busy = false
    this._chain = Promise.resolve()
    // Ring buffer of engine output, shown in the UI when something goes wrong
    // (on a phone there is no console to look at).
    this.log = []
    this._exitCode = null
    this._analysisSeq = 0
    this._activeAnalysis = null
    // Capacitor plugin calls are asynchronous. Keep every USI write in one
    // ordered chain so stop/position/go can never overtake each other.
    this._writeChain = Promise.resolve()
    this._engineGeneration = 0
    this._nativeListenersBound = false
  }

  _record(line) {
    this.log.push(line)
    if (this.log.length > 60) this.log.shift()
  }

  // Human-readable diagnostics for the analysis panel.
  diagnostics() {
    const head = [
      `backend: ${this.backend || '-'}`,
      this._evalInfo ? `eval: ${this._evalInfo.evalDir}/${this._evalInfo.evalFile} (${this._evalInfo.evalSize} bytes)` : null,
      this._exitCode != null ? `exit code: ${this._exitCode}` : null,
    ].filter(Boolean)
    return head.concat(this.log.slice(-25)).join('\n')
  }

  // Native always works; WASM needs cross-origin isolation.
  get supported() {
    if (nativePlugin()) return true
    return typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated !== false
  }

  ensureReady() {
    if (this.ready) return Promise.resolve()
    if (!this._loading) {
      // Let a failed start be retried rather than caching the rejection.
      this._loading = this._init().catch((e) => {
        this._loading = null
        throw e
      })
    }
    return this._loading
  }

  async _init() {
    const native = nativePlugin()
    if (native) await this._initNative(native)
    else await this._initWasm()

    await this._until('usi', 'usiok')
    // The Android arm64 build has shown intermittent native crashes under
    // repeated MultiPV work with four search threads. Two threads are still
    // substantially faster than one and leave much more headroom on a phone.
    const threadCap = this.backend === 'native' ? 2 : 4
    const threads = Math.max(1, Math.min(threadCap, navigator.hardwareConcurrency || 2))
    this._post('setoption name USI_Hash value 64')
    this._post('setoption name Threads value ' + threads)
    this._post('setoption name MultiPV value ' + MULTIPV)
    this._post('setoption name USI_OwnBook value false')
    this._post('setoption name BookFile value no_book')
    // Native build loads its NNUE weights from a file next to the binary.
    if (this._evalInfo && this._evalInfo.evalDir) {
      this._post('setoption name EvalDir value ' + this._evalInfo.evalDir)
      this._post('setoption name EvalFile value ' + this._evalInfo.evalFile)
    }
    // Loading AobaNNUE's 184MB of weights means reading ~96M parameters one by
    // one — on a phone that can take minutes, so allow plenty of time.
    await this._until('isready', 'readyok', 10 * 60 * 1000)
    this._post('usinewgame')
    this.ready = true
  }

  async _initNative(native) {
    this.backend = 'native'
    this._native = native
    if (!this._nativeListenersBound) {
      this._nativeListenersBound = true
      native.addListener('line', (ev) => this._emit(ev.line))
      native.addListener('stderr', (ev) => this._emit('[stderr] ' + ev.line))
      native.addListener('exit', (ev) => {
        this._exitCode = ev.code
        this.ready = false
        this._loading = null
        // Invalidate writes that were queued for the dead child process. A
        // subsequent ensureReady() may now safely start a fresh process.
        this._engineGeneration++
        this._writeChain = Promise.resolve()
        this._emit(`[engine exited: code ${ev.code}]`)
      })
    }
    const generation = ++this._engineGeneration
    this._evalInfo = await native.start()
    if (generation !== this._engineGeneration) throw new Error('エンジンが起動中に終了しました。')
    this._exitCode = null
    this.log.push(`[start] ${JSON.stringify(this._evalInfo)}`)
    if (this._evalInfo && this._evalInfo.evalExists === false) {
      throw new Error(`評価関数が見つかりません: ${this._evalInfo.evalDir}/${this._evalInfo.evalFile}`)
    }
  }

  async _initWasm() {
    if (!this.supported) throw new Error('cross-origin isolation unavailable')
    this.backend = 'wasm'
    if (!scriptPromise) scriptPromise = loadScript(GLUE)
    await scriptPromise
    const factory = self.YaneuraOu_HalfKP
    if (typeof factory !== 'function') throw new Error('engine factory not found')
    this.module = await factory({ locateFile: (p) => BASE + p, print: () => {}, printErr: () => {} })
    this.module.addMessageListener((line) => this._emit(line))
  }

  _post(cmd) {
    const generation = this._engineGeneration
    const send = async () => {
      if (generation !== this._engineGeneration) return
      if (this.backend === 'native') await this._native.send({ command: cmd })
      else this.module.postMessage(cmd)
    }
    const queued = this._writeChain.then(send, send)
    this._writeChain = queued.catch((e) => {
      if (generation !== this._engineGeneration) return
      const message = e && e.message ? e.message : String(e)
      this._emit(`[bridge error: ${message}]`)
    })
    return this._writeChain
  }

  _emit(line) {
    // Keep everything except the flood of "info depth ..." search output.
    if (!line.startsWith('info depth') && !line.startsWith('info time')) this._record(line)
    for (const fn of [...this._listeners]) fn(line)
  }

  // Send `cmd` and wait for `token`. Rejects on timeout so a failed engine
  // start surfaces as a message instead of a spinner that never ends — loading
  // the 184MB NNUE weights is the slow part, hence the generous default.
  _until(cmd, token, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const done = (err) => {
        clearTimeout(timer)
        this._listeners.delete(fn)
        err ? reject(err) : resolve()
      }
      const fn = (l) => {
        if (l === token || l.startsWith(token)) return done()
        // YaneuraOu versions report load failures either as
        // "info string Error! ..." or directly as "Error! ...".
        if (/^(?:info string )?.*(Error|error)/.test(l)) this._lastError = l.replace(/^info string /, '')
        // Died mid-handshake — fail now rather than after the full timeout.
        if (l.startsWith('[engine exited')) {
          done(new Error(this._lastError ? `エンジン終了: ${this._lastError}` : `エンジンが終了しました (${l})`))
        }
        if (l.startsWith('[bridge error')) done(new Error(l))
      }
      const timer = setTimeout(
        () => done(new Error(this._lastError || `エンジン応答なし (${cmd})`)),
        timeoutMs,
      )
      this._listeners.add(fn)
      this._post(cmd)
    })
  }

  _finishAnalysisState(active) {
    if (!active || active.finished) return
    active.finished = true
    if (active.emitTimer) clearTimeout(active.emitTimer)
    if (active.listener) this._listeners.delete(active.listener)
    if (this._activeAnalysis === active) this._activeAnalysis = null
    active.finish()
  }

  async _stopActiveAnalysis() {
    const active = this._activeAnalysis
    if (!active) return
    if (!active.stopping) {
      active.stopping = true
      if (active.searching) this._post('stop')
      else this._finishAnalysisState(active)
    }
    // Never send a new position while the previous search is still alive.
    // Each search also has a node cap, so this still completes if a native
    // bridge loses the stop command.
    await active.done
  }

  // Keep one genuine infinite search alive and stream improving MultiPV
  // results. Repeated 10M-node searches caused a long sequence of bestmove /
  // go transitions and eventually exposed a native arm64 crash. Writes are now
  // serialized, so stop -> bestmove -> position is safe without batching.
  analyzeContinuous(sfen, { onUpdate = () => {}, onError = () => {} } = {}) {
    const requestId = ++this._analysisSeq
    let cancelled = false

    const start = async () => {
      await this.ensureReady()
      if (cancelled || requestId !== this._analysisSeq) return
      await this._stopActiveAnalysis()
      if (cancelled || requestId !== this._analysisSeq) return

      let finish
      const done = new Promise((resolve) => { finish = resolve })
      const state = {
        requestId,
        byRank: {},
        latest: {},
        nodes: 0,
        maxDepth: 0,
        lastEmit: 0,
        emitTimer: null,
        stopping: false,
        searching: false,
        finished: false,
        done,
        finish,
        listener: null,
      }

      const snapshot = (bestmove = null) => {
        const lines = Object.keys(state.byRank)
          .map(Number)
          .sort((a, b) => a - b)
          .map((rank) => state.byRank[rank])
          .map((p) => ({ move: p.pv[0] || null, scoreCp: p.scoreCp, mate: p.mate, pv: p.pv }))
        const top = lines[0] || {}
        return {
          bestmove: bestmove || top.move || null,
          scoreCp: top.scoreCp ?? null,
          mate: top.mate ?? null,
          pv: top.pv || [],
          lines,
          depth: state.maxDepth || null,
          nodes: state.nodes || null,
          nps: state.latest.nps ?? null,
        }
      }

      const emitSoon = () => {
        const wait = Math.max(0, 250 - (Date.now() - state.lastEmit))
        if (state.emitTimer) return
        state.emitTimer = setTimeout(() => {
          state.emitTimer = null
          state.lastEmit = Date.now()
          if (!cancelled && requestId === this._analysisSeq) onUpdate(snapshot())
        }, wait)
      }

      state.listener = (line) => {
        if (line.startsWith('info ')) {
          const p = parseInfo(line)
          state.latest = { ...state.latest, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)) }
          if (p.nodes != null) state.nodes = Math.max(state.nodes, p.nodes)
          if (p.depth != null) state.maxDepth = Math.max(state.maxDepth, p.depth)
          if (p.scoreCp != null || p.mate != null) state.byRank[p.multipv] = p
          if (Object.keys(state.byRank).length) emitSoon()
        } else if (line.startsWith('bestmove')) {
          state.searching = false
          if (state.emitTimer) clearTimeout(state.emitTimer)
          if (!cancelled && requestId === this._analysisSeq) onUpdate(snapshot(line.split(/\s+/)[1] || null))
          this._finishAnalysisState(state)
        } else if (line.startsWith('[engine exited')) {
          state.searching = false
          this._finishAnalysisState(state)
          if (!cancelled && requestId === this._analysisSeq) onError(new Error(line))
        } else if (line.startsWith('[bridge error')) {
          state.searching = false
          this._finishAnalysisState(state)
          if (!cancelled && requestId === this._analysisSeq) onError(new Error(line))
        }
      }

      this._activeAnalysis = state
      this._listeners.add(state.listener)
      state.searching = true
      this._post('position sfen ' + sfen)
      this._post('go infinite')
    }

    start().catch((e) => {
      if (!cancelled && requestId === this._analysisSeq) onError(e)
    })

    return () => {
      if (cancelled) return
      cancelled = true
      if (requestId === this._analysisSeq) this._analysisSeq++
      const active = this._activeAnalysis
      if (active && active.requestId === requestId && !active.stopping) {
        active.stopping = true
        if (active.searching) this._post('stop')
        else this._finishAnalysisState(active)
      }
    }
  }

  // Analyse an SFEN. Serialized + interruptible. Resolves with:
  //   { bestmove, scoreCp, mate, pv, lines:[{move,scoreCp,mate,pv},...] }
  // lines are the top-N candidates (MultiPV), best first, from the
  // side-to-move's viewpoint.
  analyze(sfen, { movetime = 1500 } = {}) {
    const run = () => this._runAnalyze(sfen, movetime)
    const p = this._chain.then(run, run)
    this._chain = p.catch(() => {})
    if (this._busy && this.ready) this._post('stop') // interrupt current search
    return p
  }

  async _runAnalyze(sfen, movetime) {
    await this.ensureReady()
    this._busy = true
    try {
      return await new Promise((resolve) => {
        const byRank = {}
        const fn = (line) => {
          if (line.startsWith('info ')) {
            const p = parseInfo(line)
            if (p.scoreCp != null || p.mate != null) byRank[p.multipv] = p
          } else if (line.startsWith('bestmove')) {
            this._listeners.delete(fn)
            const lines = Object.keys(byRank)
              .map(Number)
              .sort((a, b) => a - b)
              .map((r) => byRank[r])
              .map((p) => ({ move: p.pv[0] || null, scoreCp: p.scoreCp, mate: p.mate, pv: p.pv }))
            const top = lines[0] || {}
            resolve({
              bestmove: line.split(/\s+/)[1] || null,
              scoreCp: top.scoreCp ?? null,
              mate: top.mate ?? null,
              pv: top.pv || [],
              lines,
            })
          }
        }
        this._listeners.add(fn)
        this._post('position sfen ' + sfen)
        this._post('go movetime ' + movetime)
      })
    } finally {
      this._busy = false
    }
  }
}

export const engine = new Engine()
