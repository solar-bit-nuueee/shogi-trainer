// Interactive analysis board (ShogiGUI-style): explore variations by playing
// legal moves, step back/forward, and see the engine's evaluation + best line
// update live.
import { parseSfen, usiToJp } from './shogi.js'
import { interactiveBoardSVG, handHTML } from './board.js'
import { legalMoves, movesFrom, dropTargets, applyMove, usiOf, toSfen, moveFromUsi } from './movegen.js'
import { engine } from './engine.js'

const el = {}
let S = null
let analysisToken = 0
let stopContinuous = null
let stopAnalysisUi = null
let analysisOpen = false
const pauseReasons = new Set()

function stopRunningAnalysis() {
  analysisToken++
  if (stopContinuous) stopContinuous()
  stopContinuous = null
  if (stopAnalysisUi) stopAnalysisUi()
  stopAnalysisUi = null
}

export function initAnalysis(refs) {
  Object.assign(el, refs)
  el.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell')
    if (!cell) return
    onBoardClick(Number(cell.dataset.r), Number(cell.dataset.c))
  })
  const handClick = (e) => {
    const chip = e.target.closest('.hand-piece[data-drop]')
    if (!chip) return
    onHandClick(chip.dataset.drop, chip.dataset.color)
  }
  el.handGote.addEventListener('click', handClick)
  el.handSente.addEventListener('click', handClick)

  el.first.addEventListener('click', () => jump(0))
  el.prev.addEventListener('click', () => jump(S.cursor - 1))
  el.next.addEventListener('click', () => jump(S.cursor + 1))
  el.reset.addEventListener('click', () => jump(0))
  el.promoYes.addEventListener('click', () => resolvePromo(true))
  el.promoNo.addEventListener('click', () => resolvePromo(false))
  el.lineUndo?.addEventListener('click', undoLineCapture)
  el.lineCancel?.addEventListener('click', cancelLineCapture)
  el.lineFinish?.addEventListener('click', finishLineCapture)
}

export function openAnalysis(question) {
  stopRunningAnalysis()
  analysisOpen = true
  pauseReasons.clear()
  const startPos = parseSfen(question.sfen)
  S = {
    positions: [startPos],
    lastMoves: [null], // move object that led to positions[i]
    usiMoves: [], // usi strings
    jpMoves: [], // japanese labels
    cursor: 0,
    selected: null, // {row,col}
    selectedDrop: null, // type
    targets: [],
    pending: null, // {from,to,moves:[promoteMove,plainMove]}
    capture: null, // one-move answer or multi-move line currently being recorded
  }
  if (el.addStatus) el.addStatus.textContent = ''
  if (el.addButton) el.addButton.disabled = false
  el.lineCapture?.classList.add('hidden')
  el.title.textContent = question.theme ? `検討 — ${question.theme}` : '検討'
  render()
  analyzeCurrent()
}

export function closeAnalysis() {
  analysisOpen = false
  pauseReasons.clear()
  stopRunningAnalysis()
  if (S) {
    S.capture = null
    S.pending = null
  }
  el.lineCapture?.classList.add('hidden')
  if (el.addButton) el.addButton.disabled = false
  if (el.promoDialog) el.promoDialog.classList.add('hidden')
}

// Blocking UI (question-set picker, promotion choice, app backgrounding) must
// not leave the native engine searching behind it. Reasons are reference-like:
// analysis resumes only after every currently open blocker has gone away.
export function pauseAnalysis(reason = 'manual', label = '解析を一時停止中…') {
  if (!analysisOpen) return false
  pauseReasons.add(reason)
  stopRunningAnalysis()
  if (el.eval && label) el.eval.textContent = label
  return true
}

export function resumeAnalysis(reason = 'manual') {
  pauseReasons.delete(reason)
  if (!analysisOpen || pauseReasons.size) return false
  analyzeCurrent()
  return true
}

export function currentAnalysisSfen() {
  return S ? toSfen(cur()) : null
}

export function beginAddCapture(setId, type = 'move') {
  if (!S || !setId) return false
  pauseReasons.delete('add-dialog')
  pauseReasons.add('capture')
  stopRunningAnalysis()
  S.capture = type === 'line'
    ? { kind: 'line', setId, sfen: toSfen(cur()), trainSide: cur().turn, line: [], startCursor: S.cursor }
    : { kind: 'move', setId, sfen: toSfen(cur()) }
  clearSelection()
  if (el.addButton) el.addButton.disabled = true
  if (el.best) el.best.innerHTML = ''
  if (el.pv) el.pv.textContent = ''
  if (type === 'line') {
    if (el.addStatus) el.addStatus.textContent = 'この局面から正解手順を盤上で並べてください。'
    if (el.eval) el.eval.textContent = '手順の記録中（解析停止）…'
    updateLineCaptureUi()
  } else {
    if (el.addStatus) el.addStatus.textContent = 'この局面の正解手を盤上で指してください。'
    if (el.eval) el.eval.textContent = '正解手の指定中（解析停止）…'
  }
  render()
  return true
}

function updateLineCaptureUi() {
  const capture = S?.capture?.kind === 'line' ? S.capture : null
  el.lineCapture?.classList.toggle('hidden', !capture)
  if (!capture) return
  const ownMoves = Math.ceil(capture.line.length / 2)
  el.lineSummary.textContent = `手順を記録中：全${capture.line.length}手／自分の正解${ownMoves}回`
  el.lineUndo.disabled = capture.line.length === 0
  const complete = capture.line.length >= 3 && capture.line.length % 2 === 1
  el.lineFinish.disabled = !complete
}

function undoLineCapture() {
  const capture = S?.capture
  if (!capture || capture.kind !== 'line' || !capture.line.length || S.cursor <= capture.startCursor) return
  capture.line.pop()
  S.positions.length = S.cursor
  S.lastMoves.length = S.cursor
  S.usiMoves.length = S.cursor - 1
  S.jpMoves.length = S.cursor - 1
  S.cursor--
  clearSelection()
  updateLineCaptureUi()
  render()
}

function cancelLineCapture() {
  const capture = S?.capture
  if (!capture || capture.kind !== 'line') return
  S.cursor = capture.startCursor
  S.positions.length = capture.startCursor + 1
  S.lastMoves.length = capture.startCursor + 1
  S.usiMoves.length = capture.startCursor
  S.jpMoves.length = capture.startCursor
  S.capture = null
  pauseReasons.delete('capture')
  if (el.addButton) el.addButton.disabled = false
  clearSelection()
  updateLineCaptureUi()
  if (el.addStatus) el.addStatus.textContent = '手順問題の作成を中止しました。'
  render()
  analyzeCurrent()
}

function finishLineCapture() {
  const capture = S?.capture
  if (!capture || capture.kind !== 'line') return
  if (capture.line.length < 3 || capture.line.length % 2 === 0) {
    if (el.addStatus) el.addStatus.textContent = '自分の正解手で終わる3手以上の手順にしてください。'
    return
  }
  let added = false
  try {
    added = el.onAddSequence && el.onAddSequence({
      setId: capture.setId,
      sfen: capture.sfen,
      line: capture.line.slice(),
      trainSide: capture.trainSide,
    })
  } catch {
    added = false
  }
  const count = capture.line.length
  S.capture = null
  pauseReasons.delete('capture')
  if (el.addButton) el.addButton.disabled = false
  updateLineCaptureUi()
  if (el.addStatus) el.addStatus.textContent = added ? `${count}手の手順問題を追加しました。` : '追加できませんでした（同じ手順が登録済みかもしれません）。'
  render()
  analyzeCurrent()
}

const cur = () => S.positions[S.cursor]

function clearSelection() {
  S.selected = null
  S.selectedDrop = null
  S.targets = []
}

function onBoardClick(r, c) {
  const pos = cur()
  const inTargets = S.targets.some((t) => t.row === r && t.col === c)

  if (S.selectedDrop) {
    if (inTargets) return doDrop(S.selectedDrop, r, c)
    clearSelection()
    return render()
  }
  if (S.selected) {
    if (inTargets) return tryMove(S.selected, { row: r, col: c })
    // reselect own piece or clear
    const p = pos.board[r][c]
    if (p && p.color === pos.turn) selectSquare(r, c)
    else clearSelection()
    return render()
  }
  const p = pos.board[r][c]
  if (p && p.color === pos.turn) selectSquare(r, c)
  render()
}

function selectSquare(r, c) {
  S.selected = { row: r, col: c }
  S.selectedDrop = null
  S.targets = movesFrom(cur(), r, c).map((m) => m.to)
}

function onHandClick(type, color) {
  const pos = cur()
  if (color !== pos.turn) return
  S.selected = null
  S.selectedDrop = type
  S.targets = dropTargets(pos, type).map((m) => m.to)
  render()
}

function doDrop(type, r, c) {
  const mv = { drop: type, to: { row: r, col: c } }
  applyUserMove(mv)
}

function tryMove(from, to) {
  const opts = legalMoves(cur()).filter(
    (m) => m.from && m.from.row === from.row && m.from.col === from.col && m.to.row === to.row && m.to.col === to.col,
  )
  if (opts.length === 0) return
  if (opts.length === 1) return applyUserMove(opts[0])
  // both promote and non-promote are legal -> ask
  pauseAnalysis('promotion', '成るかどうかを選択中…')
  S.pending = { moves: opts }
  el.promoDialog.classList.remove('hidden')
}

function resolvePromo(promote) {
  el.promoDialog.classList.add('hidden')
  if (!S.pending) return
  const mv = S.pending.moves.find((m) => !!m.promote === promote) || S.pending.moves[0]
  S.pending = null
  pauseReasons.delete('promotion')
  applyUserMove(mv)
}

function applyUserMove(mv) {
  const pos = cur()
  const usi = usiOf(mv)
  const jp = usiToJp(pos, usi)
  if (S.capture?.kind === 'move') {
    const capture = S.capture
    S.capture = null
    pauseReasons.delete('capture')
    if (el.addButton) el.addButton.disabled = false
    let added = false
    try {
      added = el.onAddQuestion && el.onAddQuestion({ setId: capture.setId, sfen: capture.sfen, correct: usi })
    } catch {
      added = false
    }
    if (el.addStatus) el.addStatus.textContent = added ? `追加しました（正解 ${jp}）` : '追加できませんでした。'
  } else if (S.capture?.kind === 'line') {
    S.capture.line.push(usi)
  }
  // branch: drop anything after the current cursor
  S.positions.length = S.cursor + 1
  S.lastMoves.length = S.cursor + 1
  S.usiMoves.length = S.cursor
  S.jpMoves.length = S.cursor

  const next = applyMove(pos, mv)
  S.positions.push(next)
  S.lastMoves.push(mv)
  S.usiMoves.push(usi)
  S.jpMoves.push(jp)
  S.cursor++
  clearSelection()
  updateLineCaptureUi()
  render()
  analyzeCurrent()
}

function jump(i) {
  if (i < 0 || i >= S.positions.length) return
  if (S.capture?.kind === 'line') return
  S.cursor = i
  if (S.capture) {
    S.capture = null
    pauseReasons.delete('capture')
    if (el.addButton) el.addButton.disabled = false
    if (el.addStatus) el.addStatus.textContent = '正解手の指定を中止しました。'
  }
  clearSelection()
  render()
  analyzeCurrent()
}

function lastMoveMarks() {
  const mv = S.lastMoves[S.cursor]
  if (!mv) return null
  return { from: mv.from || null, to: mv.to }
}

function render() {
  const pos = cur()
  const recordingLine = S.capture?.kind === 'line'
  el.board.innerHTML = interactiveBoardSVG(pos, {
    selected: S.selected,
    targets: S.targets,
    lastMove: lastMoveMarks(),
  })
  el.handGote.innerHTML = handHTML(pos, 'w', { interactive: true, turn: pos.turn, selectedDrop: S.selectedDrop })
  el.handSente.innerHTML = handHTML(pos, 'b', { interactive: true, turn: pos.turn, selectedDrop: S.selectedDrop })

  el.first.disabled = recordingLine || S.cursor === 0
  el.prev.disabled = recordingLine || S.cursor === 0
  el.next.disabled = recordingLine || S.cursor >= S.positions.length - 1
  el.reset.disabled = recordingLine || S.cursor === 0

  // move list
  if (!S.jpMoves.length) {
    el.moves.innerHTML = '<span class="an-move-empty">開始局面。駒を動かして変化を試せます。</span>'
  } else {
    el.moves.innerHTML = S.jpMoves
      .map((m, i) => `<button class="an-move${i + 1 === S.cursor ? ' current' : ''}" data-i="${i + 1}">${i + 1}. ${m}</button>`)
      .join('')
    if (!recordingLine) el.moves.querySelectorAll('.an-move').forEach((b) => b.addEventListener('click', () => jump(Number(b.dataset.i))))
  }
}

// ---- engine ----------------------------------------------------------------
function pvToJp(pos, pv, max = 6) {
  const out = []
  let p = pos
  for (let i = 0; i < pv.length && i < max; i++) {
    const mv = moveFromUsi(p, pv[i])
    if (!mv) break
    out.push(usiToJp(p, pv[i]))
    p = applyMove(p, mv)
  }
  return out.join(' ')
}

function fmtEval(r, turn) {
  const toSente = (v) => (turn === 'b' ? v : -v)
  if (r.mate != null) {
    const s = toSente(r.mate)
    return `${s >= 0 ? '+' : '-'}詰み ${Math.abs(r.mate)}手`
  }
  if (r.scoreCp != null) {
    const s = toSente(r.scoreCp)
    return `${s > 0 ? '+' : ''}${s}`
  }
  return '—'
}

function analyzeCurrent(recoveryAttempt = 0) {
  stopRunningAnalysis()
  if (!analysisOpen || pauseReasons.size) return
  const pos = cur()
  el.best.innerHTML = ''
  if (!engine.supported) {
    el.eval.textContent = '解析不可'
    el.pv.textContent = 'この環境では解析エンジンが動きません（cross-origin isolation 必須）。'
    return
  }
  const token = ++analysisToken
  el.eval.textContent = engine.ready ? '解析中…' : 'エンジン起動中…'
  el.pv.textContent = engine.ready ? '' : '初回は評価関数(184MB)の読み込みに数分かかることがあります'
  // Tick the elapsed time during the slow first load so it doesn't look frozen.
  let ticker = null
  if (!engine.ready) {
    const t0 = Date.now()
    ticker = setInterval(() => {
      if (token !== analysisToken || engine.ready) return
      el.eval.textContent = `エンジン起動中… ${Math.round((Date.now() - t0) / 1000)}秒`
    }, 1000)
  }
  const stopTicker = () => {
    if (ticker) clearInterval(ticker)
    ticker = null
    if (stopAnalysisUi === stopTicker) stopAnalysisUi = null
  }
  stopAnalysisUi = stopTicker
  // if game over (no legal moves) skip
  if (legalMoves(pos).length === 0) {
    stopTicker()
    el.eval.textContent = '—'
    el.pv.textContent = '合法手なし（詰みなど）'
    return
  }
  const renderResult = (r) => {
    stopTicker()
    if (token !== analysisToken) return // stale
    const work = [r.depth != null ? `深さ ${r.depth}` : null, r.nodes != null ? `${r.nodes.toLocaleString()}ノード` : null]
      .filter(Boolean)
      .join(' / ')
    el.eval.textContent = '評価値 ' + fmtEval(r, pos.turn) + '（先手視点）' + (work ? `　${work}` : '')

    // Top-3 candidate moves (MultiPV), each playable.
    el.best.innerHTML = ''
    const lines = (r.lines && r.lines.length ? r.lines : r.bestmove ? [{ move: r.bestmove, scoreCp: r.scoreCp, mate: r.mate, pv: r.pv }] : [])
    lines.slice(0, 3).forEach((ln, i) => {
      if (!ln.move) return
      const jp = usiToJp(pos, ln.move)
      const ev = fmtEval(ln, pos.turn)
      const btn = document.createElement('button')
      btn.className = 'an-cand'
      btn.innerHTML = `<span class="cand-rank">${i + 1}</span><span class="cand-move">${jp}</span><span class="cand-eval">${ev}</span>`
      btn.addEventListener('click', () => {
        if (S.capture) return
        const mv = moveFromUsi(cur(), ln.move)
        if (mv) applyUserMove(mv)
      })
      el.best.appendChild(btn)
    })

    el.pv.textContent = r.pv && r.pv.length ? '読み筋: ' + pvToJp(pos, r.pv) : ''
  }
  const renderError = (e) => {
    stopTicker()
    if (token !== analysisToken) return
    const message = String(e.message || e)
    const recoverable = engine.backend === 'native' && /(engine exited|bridge error|stream closed|エンジン.*終了)/i.test(message)
    if (recoverable && recoveryAttempt < 1) {
      el.eval.textContent = 'エンジン再起動中…'
      el.pv.textContent = 'ネイティブエンジンを作り直しています。'
      const retryTimer = setTimeout(() => {
        if (token === analysisToken && analysisOpen && pauseReasons.size === 0) analyzeCurrent(recoveryAttempt + 1)
      }, 500)
      stopAnalysisUi = () => {
        clearTimeout(retryTimer)
        if (stopAnalysisUi) stopAnalysisUi = null
      }
      return
    }
    el.eval.textContent = '解析失敗'
    el.pv.textContent = message
    // No console on a phone — show the engine's own output so the failure is
    // diagnosable from the device.
    const det = document.createElement('details')
    det.className = 'an-diag'
    det.innerHTML = `<summary>エンジンの詳細ログ</summary><pre>${engine
      .diagnostics()
      .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`
    el.best.appendChild(det)
  }
  stopContinuous = engine.analyzeContinuous(toSfen(pos), { onUpdate: renderResult, onError: renderError })
}
