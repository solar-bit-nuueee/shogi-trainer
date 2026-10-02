// FSRS scheduler wrapper.
//
// FSRS ("Free Spaced Repetition Scheduler") decides *when* each question should
// come back for review based on how well you remembered it. We use the official
// ts-fsrs implementation (vendored, offline) so the maths is correct.
//
// A two-choice quiz only produces "right" or "wrong", so we map:
//    wrong            -> Rating.Again   (you forgot — see it again soon)
//    right            -> Rating.Good    (normal success)
//    right + "簡単"    -> Rating.Easy    (optional: push the interval out further)
// The optional Easy grade lets confident users thin out their queue faster.
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs'

export { Rating, State }

// request_retention 0.9 = aim to review each card when ~90% likely to recall it.
// A three-year cap keeps well-known cards from vanishing for a decade.
const PARAMS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 365 * 3,
  enable_fuzz: true, // spread same-day due cards so they don't all clump
  enable_short_term: true,
})

const engine = fsrs(PARAMS)

export function newCard(now = new Date()) {
  return createEmptyCard(now)
}

// Grade a card. `correct` is the quiz result; `easy` upgrades a correct answer.
// Returns { card, log } — the updated card and a review-log entry.
export function grade(card, correct, { easy = false, now = new Date() } = {}) {
  const rating = correct ? (easy ? Rating.Easy : Rating.Good) : Rating.Again
  return engine.next(card, now, rating)
}

// Preview every rating's outcome (used to show "next review in N" hints).
export function preview(card, now = new Date()) {
  return engine.repeat(card, now)
}

// Current probability of recall, 0..1 — handy for progress displays.
export function retrievability(card, now = new Date()) {
  if (!card || card.state === State.New || !card.last_review) return 0
  return engine.get_retrievability(card, now, false)
}

// Human-friendly interval label for a due date relative to now.
export function intervalLabel(due, now = new Date()) {
  const ms = new Date(due).getTime() - now.getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'まもなく'
  if (mins < 60) return `${mins}分後`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}時間後`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}日後`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}ヶ月後`
  return `${Math.round(months / 12)}年後`
}
