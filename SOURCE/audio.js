// Sound manager: answer clips plus an optional BGM pool.
//
// BGM can come from a CORS-enabled URL or from audio files selected by the
// user. Selected files are kept in IndexedDB so they survive app restarts and
// can be played offline. The current BGM continues across questions and is
// changed only after the track ends, avoiding an immediate repeat when there
// is more than one track.
import { GOOD_SOUNDS, BAD_SOUNDS } from './assets-manifest.js'

const SETTINGS_KEY = 'speaki_shogi.audio'
const BGM_DB_NAME = 'speaki_shogi.audio.files'
const BGM_STORE = 'bgmFiles'

const DEFAULT_SETTINGS = {
  muted: false,
  volume: 0.9,
  bgmEnabled: true,
  bgmVolume: 0.28,
  bgmUrl: '',
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function openBgmDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(BGM_DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(BGM_STORE)) {
          req.result.createObjectStore(BGM_STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function isAudioFile(file) {
  return file?.type?.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file?.name || '')
}

export class AudioManager {
  constructor() {
    this.settings = loadSettings()
    this.unlocked = false
    this._current = null
    this._lastIndex = { good: -1, bad: -1 }
    this._pools = {
      good: GOOD_SOUNDS.map((s) => this._make(s.src)),
      bad: BAD_SOUNDS.map((s) => this._make(s.src)),
    }
    this._bgm = null
    this._bgmSource = null
    this._bgmObjectUrl = null
    this._bgmFiles = []
    this._lastBgmKey = ''
    this._db = null
    this._toneContext = null
    this._dbPromise = openBgmDb().then((db) => {
      this._db = db
      return this._loadBgmFiles()
    })
    this._captions = {
      good: GOOD_SOUNDS.map((s) => s.caption),
      bad: BAD_SOUNDS.map((s) => s.caption),
    }

    window.addEventListener('online', () => {
      if (this._bgmSource?.kind === 'url') this.startBgm()
      else if (!this._bgmSource && this.settings.bgmUrl) this.nextBgm()
    })
    window.addEventListener('offline', () => {
      // Local files remain usable offline. Remote URLs pause until online.
      if (this._bgmSource?.kind === 'url') this.stopBgm()
    })
  }

  async ready() {
    await this._dbPromise
    if (this.settings.bgmEnabled) this.nextBgm({ keepCurrent: true })
  }

  _make(src) {
    const a = new Audio(src)
    a.preload = 'auto'
    a.volume = this.settings.volume
    return a
  }

  get muted() {
    return this.settings.muted
  }

  get volume() {
    return this.settings.volume
  }

  setMuted(muted) {
    this.settings.muted = !!muted
    this._persist()
  }

  setVolume(v) {
    this.settings.volume = Math.min(1, Math.max(0, v))
    for (const kind of ['good', 'bad']) {
      for (const a of this._pools[kind]) a.volume = this.settings.volume
    }
    this._persist()
  }

  get bgmEnabled() {
    return this.settings.bgmEnabled
  }

  get bgmVolume() {
    return this.settings.bgmVolume
  }

  get bgmUrl() {
    return this.settings.bgmUrl
  }

  get bgmFiles() {
    return this._bgmFiles.map(({ id, name, type, size }) => ({ id, name, type, size }))
  }

  setBgmEnabled(enabled) {
    this.settings.bgmEnabled = !!enabled
    if (this.settings.bgmEnabled) this.nextBgm()
    else this.stopBgm()
    this._persist()
  }

  setBgmVolume(v) {
    this.settings.bgmVolume = Math.min(1, Math.max(0, v))
    if (this._bgm) this._bgm.volume = this.settings.bgmVolume
    this._persist()
  }

  // Set a direct MP3/OGG/M4A URL. A page URL from YouTube or SoundCloud is
  // intentionally not treated as an audio source.
  setBgmUrl(value) {
    const raw = String(value || '').trim()
    if (raw) {
      try {
        const url = new URL(raw, location.href)
        if (!['http:', 'https:'].includes(url.protocol)) return false
      } catch {
        return false
      }
    }
    this.settings.bgmUrl = raw
    this._persist()
    if (this.settings.bgmEnabled) this.nextBgm()
    return true
  }

  async _loadBgmFiles() {
    if (!this._db) return
    try {
      const tx = this._db.transaction(BGM_STORE, 'readonly')
      const req = tx.objectStore(BGM_STORE).getAll()
      this._bgmFiles = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => reject(req.error)
      })
    } catch {
      this._bgmFiles = []
    }
  }

  async addBgmFiles(fileList) {
    const files = [...(fileList || [])].filter(isAudioFile)
    if (!files.length || !this._db) return { added: 0, error: !this._db && files.length > 0 }

    const records = files
      .filter((file) => !this._bgmFiles.some((old) =>
        old.name === file.name && old.size === file.size && old.lastModified === file.lastModified,
      ))
      .map((file, i) => ({
        id: `bgm-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || 'audio/mpeg',
        size: file.size,
        lastModified: file.lastModified || 0,
        blob: new Blob([file], { type: file.type || 'audio/mpeg' }),
      }))
    if (!records.length) return { added: 0, error: false }

    try {
      const tx = this._db.transaction(BGM_STORE, 'readwrite')
      for (const record of records) tx.objectStore(BGM_STORE).put(record)
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      this._bgmFiles.push(...records)
      if (this.settings.bgmEnabled && !this._bgmSource) this.nextBgm()
      return { added: records.length, error: false }
    } catch {
      return { added: 0, error: true }
    }
  }

  async removeBgmFile(id) {
    const index = this._bgmFiles.findIndex((file) => file.id === id)
    if (index < 0) return false
    try {
      if (this._db) {
        const tx = this._db.transaction(BGM_STORE, 'readwrite')
        tx.objectStore(BGM_STORE).delete(id)
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      }
      const wasCurrent = this._bgmSource?.key === `file:${id}`
      this._bgmFiles.splice(index, 1)
      if (wasCurrent) this.nextBgm()
      return true
    } catch {
      return false
    }
  }

  _persist() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      /* storage full / private mode — non-fatal */
    }
  }

  // Pick a new BGM after the current track ends. Local files work offline;
  // the URL candidate is included only while the device reports online.
  nextBgm({ keepCurrent = false } = {}) {
    if (!this.settings.bgmEnabled) return this.stopBgm()
    if (keepCurrent && this._bgmSource) return this.startBgm()
    const candidates = this._bgmFiles.map((file) => ({
      kind: 'file',
      key: `file:${file.id}`,
      blob: file.blob,
      label: file.name,
    }))
    if (this.settings.bgmUrl && this._isOnline()) {
      candidates.push({ kind: 'url', key: `url:${this.settings.bgmUrl}`, url: this.settings.bgmUrl, label: 'オンラインBGM' })
    }
    if (!candidates.length) {
      this.stopBgm()
      this._setBgmElement(null)
      return false
    }

    let track = candidates[Math.floor(Math.random() * candidates.length)]
    if (candidates.length > 1 && track.key === this._lastBgmKey) {
      track = candidates[(candidates.indexOf(track) + 1) % candidates.length]
    }
    this._lastBgmKey = track.key
    if (this._bgmSource?.key !== track.key) this._setBgmElement(track)
    else if (this._bgm?.ended) this._bgm.currentTime = 0
    return this.startBgm()
  }

  // Start or resume the current track when a question is shown. It does not
  // select a new track, so moving to another question never interrupts BGM.
  startBgmForQuestion() {
    if (this._bgm?.ended) return this.nextBgm()
    if (this._bgmSource) return this.startBgm()
    return this.nextBgm()
  }

  _isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  }

  _setBgmElement(track) {
    if (this._bgm) {
      this._bgm.pause()
      this._bgm.removeAttribute('src')
      this._bgm.load()
    }
    if (this._bgmObjectUrl) {
      URL.revokeObjectURL(this._bgmObjectUrl)
      this._bgmObjectUrl = null
    }
    this._bgm = null
    this._bgmSource = track
    if (!track) return

    const a = new Audio()
    a.preload = 'none'
    a.loop = false
    a.addEventListener('ended', () => {
      if (this._bgm === a && this.settings.bgmEnabled) this.nextBgm()
    })
    a.volume = this.settings.bgmVolume
    if (track.kind === 'url') {
      // Cross-origin isolation requires a CORS-enabled remote audio host.
      a.crossOrigin = 'anonymous'
      a.src = track.url
    } else {
      this._bgmObjectUrl = URL.createObjectURL(track.blob)
      a.src = this._bgmObjectUrl
    }
    this._bgm = a
  }

  // Call once from the first user gesture to satisfy mobile autoplay policy.
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    const a = this._pools.good[0] || this._pools.bad[0]
    if (a) {
      const prev = a.muted
      a.muted = true
      a.play()
        .then(() => {
          a.pause()
          a.currentTime = 0
          a.muted = prev
        })
        .catch(() => {
          a.muted = prev
        })
    }
    if (this._bgmSource) this.startBgm()
    else this.nextBgm()
  }

  // Browsers require a user gesture before starting media. Calling this from
  // unlock() or a settings click satisfies that requirement on mobile too.
  startBgm() {
    if (!this.unlocked || !this.settings.bgmEnabled || !this._bgm || !this._bgmSource) return false
    if (this._bgmSource.kind === 'url' && !this._isOnline()) return false
    this._bgm.volume = this.settings.bgmVolume
    this._bgm.play().catch(() => {
      // Offline transitions, autoplay policy, and decoding errors are all
      // non-fatal; the next gesture or online event can retry playback.
    })
    return true
  }

  stopBgm() {
    if (!this._bgm) return false
    this._bgm.pause()
    this._bgm.currentTime = 0
    return true
  }

  // Pick a random clip index avoiding an immediate repeat when possible.
  _pick(kind) {
    const n = this._pools[kind].length
    if (n === 0) return -1
    if (n === 1) return 0
    let i = Math.floor(Math.random() * n)
    if (i === this._lastIndex[kind]) i = (i + 1) % n
    this._lastIndex[kind] = i
    return i
  }

  // Play a random good/bad clip. Returns the clip caption (or null).
  play(kind) {
    if (this.settings.muted) return null
    const i = this._pick(kind)
    if (i < 0) {
      this._playSynthTone(kind)
      return null
    }
    if (this._current && !this._current.paused) {
      this._current.pause()
      this._current.currentTime = 0
    }
    const a = this._pools[kind][i]
    a.currentTime = 0
    a.volume = this.settings.volume
    a.play().catch(() => {
      /* gesture/decoding hiccup — ignore, keep quiz responsive */
    })
    this._current = a
    return this._captions[kind][i] ?? null
  }

  // The general distribution has no bundled third-party sound files. Give
  // answer feedback with locally synthesized tones instead.
  _playSynthTone(kind) {
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context || this.settings.volume <= 0) return
    try {
      this._toneContext ??= new Context()
      const context = this._toneContext
      if (context.state === 'suspended') context.resume().catch(() => {})

      const notes = kind === 'good'
        ? [{ hz: 660, at: 0, length: 0.12 }, { hz: 880, at: 0.12, length: 0.2 }]
        : [{ hz: 330, at: 0, length: 0.16 }, { hz: 247, at: 0.16, length: 0.22 }]
      const now = context.currentTime
      const master = context.createGain()
      master.gain.value = this.settings.volume * 0.24
      master.connect(context.destination)

      for (const note of notes) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const start = now + note.at
        const end = start + note.length
        oscillator.type = kind === 'good' ? 'sine' : 'triangle'
        oscillator.frequency.setValueAtTime(note.hz, start)
        envelope.gain.setValueAtTime(0, start)
        envelope.gain.linearRampToValueAtTime(0.8, start + 0.012)
        envelope.gain.setValueAtTime(0.8, end - 0.02)
        envelope.gain.linearRampToValueAtTime(0, end)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(start)
        oscillator.stop(end + 0.01)
      }
    } catch {
      // Audio feedback is optional; an unsupported audio context must not
      // interrupt answering a question.
    }
  }

  playGood() {
    return this.play('good')
  }

  playBad() {
    return this.play('bad')
  }
}
