// Persistence layer (localStorage). Holds every question's FSRS card, review
// history, streak and per-day counters so the app is a real learning tool that
// survives reloads and works fully offline.
const KEY = 'speaki_shogi.state.v1'
const HISTORY_CAP = 2000

const DATE_FIELDS = ['due', 'last_review']

function todayStr(now = new Date()) {
  // Local calendar day, YYYY-MM-DD.
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function serializeCard(card) {
  const out = { ...card }
  for (const f of DATE_FIELDS) {
    if (out[f] instanceof Date) out[f] = out[f].toISOString()
  }
  return out
}

function reviveCard(raw) {
  if (!raw) return raw
  const out = { ...raw }
  for (const f of DATE_FIELDS) {
    if (typeof out[f] === 'string') out[f] = new Date(out[f])
  }
  return out
}

const DEFAULTS = () => ({
  version: 2,
  cards: {}, // id -> { card fields..., seen, correct, wrong, lastResult }
  history: [], // { id, ts, correct, rating }
  daily: { date: todayStr(), newIntroduced: 0, reviewsDone: 0 },
  streak: { current: 0, best: 0, lastStudyDate: null },
  settings: { newPerDay: 12, sound: true, setSize: 10, activeSetId: 'builtin' },
  questionSets: [], // [{ id, name, type: 'choice'|'move'|'line'|'tsume', questions: [...] }]
})

export class Store {
  constructor() {
    this.state = this._read()
    this._rollDaily()
    this._saveTimer = null
  }

  _read() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return DEFAULTS()
      const parsed = JSON.parse(raw)
      return { ...DEFAULTS(), ...parsed, settings: { ...DEFAULTS().settings, ...(parsed.settings || {}) } }
    } catch {
      return DEFAULTS()
    }
  }

  // Reset the "new cards introduced today" counter when the day changes.
  _rollDaily(now = new Date()) {
    const t = todayStr(now)
    if (this.state.daily.date !== t) {
      this.state.daily = { date: t, newIntroduced: 0, reviewsDone: 0 }
      this._flush()
    }
  }

  save() {
    // Debounce writes so rapid answering doesn't thrash localStorage.
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this._flush()
    }, 250)
  }

  _flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state))
    } catch {
      /* quota / private mode — the session still works in memory */
    }
  }

  // ---- cards -------------------------------------------------------------
  getEntry(id) {
    const e = this.state.cards[id]
    if (!e) return null
    return { ...e, card: reviveCard(e) }
  }

  // Raw FSRS card (revived) for an id, or null if never seen.
  getCard(id) {
    const e = this.state.cards[id]
    if (!e) return null
    return reviveCard(e)
  }

  getStats(id) {
    const e = this.state.cards[id]
    if (!e) return { seen: 0, correct: 0, wrong: 0, lastResult: null }
    return { seen: e.seen || 0, correct: e.correct || 0, wrong: e.wrong || 0, lastResult: e.lastResult ?? null }
  }

  isNew(id) {
    return !this.state.cards[id]
  }

  // Persist an updated card + review outcome for a question.
  recordReview(id, { card, correct, rating, wasNew, now = new Date() }) {
    const prev = this.state.cards[id] || { seen: 0, correct: 0, wrong: 0 }
    const merged = {
      ...serializeCard(card),
      seen: (prev.seen || 0) + 1,
      correct: (prev.correct || 0) + (correct ? 1 : 0),
      wrong: (prev.wrong || 0) + (correct ? 0 : 1),
      lastResult: correct ? 'correct' : 'wrong',
      lastReviewedAt: now.toISOString(),
    }
    this.state.cards[id] = merged

    this.state.history.push({ id, ts: now.getTime(), correct, rating })
    if (this.state.history.length > HISTORY_CAP) {
      this.state.history.splice(0, this.state.history.length - HISTORY_CAP)
    }

    this._rollDaily(now)
    this.state.daily.reviewsDone += 1
    if (wasNew) this.state.daily.newIntroduced += 1

    this._bumpStreak(now)
    this.save()
  }

  _bumpStreak(now = new Date()) {
    const t = todayStr(now)
    const s = this.state.streak
    if (s.lastStudyDate === t) return
    const yesterday = todayStr(new Date(now.getTime() - 86400000))
    s.current = s.lastStudyDate === yesterday ? s.current + 1 : 1
    s.best = Math.max(s.best || 0, s.current)
    s.lastStudyDate = t
  }

  // ---- queries used to build a study session -----------------------------
  get newPerDay() {
    return this.state.settings.newPerDay
  }

  setNewPerDay(n) {
    this.state.settings.newPerDay = Math.max(0, Math.min(100, Math.round(n)))
    this.save()
  }

  get setSize() {
    return this.state.settings.setSize || 10
  }

  setSetSize(n) {
    this.state.settings.setSize = Math.max(5, Math.min(30, Math.round(n)))
    this.save()
  }

  // ---- user-created question sets ---------------------------------------
  get activeSetId() {
    return this.state.settings.activeSetId || 'builtin'
  }

  setActiveSetId(id) {
    this.state.settings.activeSetId = id || 'builtin'
    this.save()
  }

  getQuestionSets() {
    return this.state.questionSets || []
  }

  getQuestionSet(id) {
    return this.getQuestionSets().find((set) => set.id === id) || null
  }

  createQuestionSet(name, type) {
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('問題セット名を入力してください。')
    if (!['choice', 'move', 'line', 'tsume'].includes(type)) throw new Error('回答形式が不正です。')
    const id = `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const set = { id, name: cleanName, type, questions: [], createdAt: new Date().toISOString() }
    this.state.questionSets.push(set)
    this.state.settings.activeSetId = id
    this._flush()
    return set
  }

  deleteQuestionSet(id) {
    const i = this.state.questionSets.findIndex((set) => set.id === id)
    if (i < 0) return false
    this.state.questionSets.splice(i, 1)
    if (this.activeSetId === id) this.state.settings.activeSetId = 'builtin'
    this._flush()
    return true
  }

  addQuestions(setId, questions) {
    const set = this.getQuestionSet(setId)
    if (!set) throw new Error('追加先の問題セットが見つかりません。')
    const keyOf = (q) => set.type === 'line'
      ? `${q.sfen}|${Array.isArray(q.line) ? q.line.join(' ') : ''}`
      : set.type === 'tsume' ? String(q.sfen || '') : `${q.sfen}|${q.correct}|${q.wrong || ''}`
    const seen = new Set(set.questions.map(keyOf))
    let added = 0
    for (const q of questions) {
      const common = {
        sfen: String(q.sfen || '').trim(),
        theme: String(q.theme || set.name).trim(),
        comment: String(q.comment || '').trim(),
      }
      const item = set.type === 'line'
        ? { ...common, line: (Array.isArray(q.line) ? q.line : []).map((m) => String(m || '').trim()).filter(Boolean), trainSide: q.trainSide === 'w' ? 'w' : 'b' }
        : set.type === 'tsume'
          ? common
          : { ...common, correct: String(q.correct || '').trim(), ...(set.type === 'choice' ? { wrong: String(q.wrong || '').trim() } : {}) }
      const key = keyOf(item)
      const missingAnswer = set.type === 'line'
        ? item.line.length < 3 || item.line.length % 2 === 0
        : set.type === 'tsume' ? false : !item.correct
      if (!item.sfen || missingAnswer || (set.type === 'choice' && !item.wrong) || seen.has(key)) continue
      seen.add(key)
      set.questions.push(item)
      added++
    }
    if (added) this._flush()
    return added
  }

  newRemainingToday() {
    this._rollDaily()
    return Math.max(0, this.state.settings.newPerDay - this.state.daily.newIntroduced)
  }

  // Ids whose card is due at/before `now` (already-learned material).
  dueIds(allIds, now = new Date()) {
    const t = now.getTime()
    return allIds.filter((id) => {
      const c = this.state.cards[id]
      return c && new Date(c.due).getTime() <= t
    })
  }

  // Ids never studied yet, in the given order.
  newIds(allIds) {
    return allIds.filter((id) => !this.state.cards[id])
  }

  summary(allIds, now = new Date()) {
    const due = this.dueIds(allIds, now).length
    const fresh = this.newIds(allIds).length
    const learned = allIds.length - fresh
    return {
      total: allIds.length,
      learned,
      due,
      newAvailable: fresh,
      newRemainingToday: this.newRemainingToday(),
      reviewsToday: this.state.daily.reviewsDone,
      streak: this.state.streak.current || 0,
      bestStreak: this.state.streak.best || 0,
    }
  }

  // Overall accuracy across all recorded reviews.
  accuracy() {
    const h = this.state.history
    if (!h.length) return null
    const ok = h.reduce((n, r) => n + (r.correct ? 1 : 0), 0)
    return ok / h.length
  }

  reset() {
    const questionSets = this.state.questionSets || []
    const activeSetId = this.activeSetId
    const settings = { ...this.state.settings }
    this.state = DEFAULTS()
    this.state.questionSets = questionSets
    this.state.settings = { ...this.state.settings, ...settings, activeSetId }
    this._flush()
  }
}
