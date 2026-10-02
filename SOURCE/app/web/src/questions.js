// Question bank loader for the SFEN/USI format.
//
// Data source priority at runtime:
//   1. ./questions.json at the site root  (drop your generator's output here)
//   2. the built-in samples in questions.data.js  (fallback)
//
// Either source is an array of items shaped like:
//   { sfen, correct, wrong, id?, theme?, comment?, level? }
import { QUESTIONS as SAMPLE } from './questions.data.js'
import { parseSfen, parseUsi, usiToJp, shortHash } from './shogi.js'
import { applyMove, findKing, isInCheck, moveFromUsi } from './movegen.js'

const firstMove = (m) => (Array.isArray(m) ? m[0] : m)

// Validate + normalise a raw array into ready-to-use question objects.
export function buildFrom(raw, { type = 'choice', idPrefix = '', defaultTheme = '問題' } = {}) {
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const line = type === 'line' && Array.isArray(item.line) ? item.line.map(String) : null
    const correct = firstMove(item.correct)
    const wrong = type === 'choice' ? firstMove(item.wrong) : null
    if (!item.sfen || (type === 'line' ? !line || line.length < 3 || line.length % 2 === 0 : type !== 'tsume' && !correct) || (type === 'choice' && !wrong)) {
      console.warn('[questions] missing required fields:', item)
      continue
    }
    let position
    try {
      position = parseSfen(item.sfen)
    } catch (e) {
      console.warn('[questions] bad sfen skipped:', item.sfen, e)
      continue
    }
    if (type !== 'line' && type !== 'tsume' && (!parseUsi(correct) || (wrong && !parseUsi(wrong)))) {
      console.warn('[questions] unparseable move skipped:', item.sfen, correct, wrong)
      continue
    }
    if (type === 'tsume' && (!findKing(position.board, position.turn) || !findKing(position.board, position.turn === 'b' ? 'w' : 'b'))) {
      console.warn('[questions] tsume position needs both kings:', item.sfen)
      continue
    }
    if (type === 'tsume' && (isInCheck(position.board, 'b') || isInCheck(position.board, 'w'))) {
      console.warn('[questions] tsume start position must not already be in check:', item.sfen)
      continue
    }
    const linePositions = [position]
    const lineJp = []
    if (type === 'line') {
      let p = position
      let valid = item.trainSide === p.turn
      for (const usi of line) {
        const move = moveFromUsi(p, usi)
        if (!move) {
          valid = false
          break
        }
        lineJp.push(usiToJp(p, usi))
        p = applyMove(p, move)
        linePositions.push(p)
      }
      if (!valid) {
        console.warn('[questions] invalid line skipped:', item.sfen, line)
        continue
      }
    }
    const identity = type === 'line' ? line.join(' ') : type === 'tsume' ? 'tsume' : `${correct}|${wrong || ''}`
    const id = item.id || `${idPrefix}q-${shortHash(`${item.sfen}|${identity}`)}`
    if (seen.has(id)) {
      console.warn('[questions] duplicate id skipped:', id)
      continue
    }
    seen.add(id)
    out.push({
      id,
      sfen: item.sfen,
      position,
      correct: type === 'line' ? line[0] : correct,
      wrong,
      answerType: type,
      line,
      linePositions: type === 'line' ? linePositions : null,
      lineJp: type === 'line' ? lineJp : null,
      trainSide: type === 'line' ? item.trainSide : null,
      theme: item.theme || defaultTheme,
      level: item.level || 1,
      comment: item.comment || '',
      correctJp: type === 'tsume' ? null : usiToJp(position, type === 'line' ? line[0] : correct),
      wrongJp: wrong ? usiToJp(position, wrong) : null,
    })
  }
  return out
}

// Parse the text format emitted by the existing automatic puzzle generator.
export function parseChoiceText(text) {
  const out = []
  const seen = new Set()
  for (const block of String(text || '').split(/\r?\n\s*\r?\n/)) {
    let sfen = null
    let choices = null
    let correct = null
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.startsWith('sfen ')) sfen = line.slice(5).trim()
      else if (line.startsWith('選択肢')) {
        choices = line.replace(/^選択肢[：:]\s*/, '').split(/[,、]\s*/).map((s) => s.trim()).filter(Boolean)
      } else if (line.startsWith('正解')) correct = line.replace(/^正解[：:]\s*/, '').trim()
    }
    const wrong = choices && choices.find((move) => move !== correct)
    if (!sfen || !correct || !wrong) continue
    const key = `${sfen}|${correct}|${wrong}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ sfen, correct, wrong })
  }
  return out
}

// Build lookup + ordering indexes for a processed question list.
export function indexOf(list) {
  const BY_ID = new Map(list.map((q) => [q.id, q]))
  const ORDERED_IDS = list
    .map((q, i) => ({ q, i }))
    .sort((a, b) => a.q.level - b.q.level || a.i - b.i)
    .map(({ q }) => q.id)
  const THEMES = [...new Set(list.map((q) => q.theme))]
  return { BY_ID, ORDERED_IDS, THEMES }
}

// Runtime loader: prefer ./questions.json, fall back to bundled samples.
export async function loadQuestions() {
  let raw = SAMPLE
  let source = 'samples'
  try {
    const res = await fetch('./questions.json', { cache: 'no-cache' })
    if (res.ok) {
      const json = await res.json()
      if (Array.isArray(json) && json.length) {
        raw = json
        source = 'questions.json'
      }
    }
  } catch {
    /* no questions.json — use samples */
  }
  const QUESTIONS = buildFrom(raw)
  console.info(`[questions] loaded ${QUESTIONS.length} from ${source}`)
  return { QUESTIONS, source, ...indexOf(QUESTIONS) }
}

// Static exports from the samples (used by tests / non-async callers).
export const QUESTIONS = buildFrom(SAMPLE)
export const { BY_ID, ORDERED_IDS, THEMES } = indexOf(QUESTIONS)
export const getQuestion = (id) => BY_ID.get(id)
