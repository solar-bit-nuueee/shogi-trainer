// speaki_shogi — app controller (SFEN/USI two-choice trainer).
// Shows a board position and two candidate moves; you pick the correct one.
import { PORTRAIT } from './assets-manifest.js'
import { loadQuestions, buildFrom, indexOf, parseChoiceText } from './questions.js'
import { boardSVG, interactiveBoardSVG, handHTML } from './board.js'
import { initAnalysis, openAnalysis, closeAnalysis, beginAddCapture, pauseAnalysis, resumeAnalysis, currentAnalysisSfen } from './analysis.js'
import { legalMoves, movesFrom, dropTargets, applyMove, usiOf, moveFromUsi, isInCheck, toSfen } from './movegen.js'
import { engine } from './engine.js'
import { Store } from './store.js'
import { AudioManager } from './audio.js'
import { newCard, grade, intervalLabel } from './scheduler.js'

const store = new Store()
const sound = new AudioManager()

// Choice colours (before reveal) and result colours (after reveal).
const CHOICE_COLORS = ['#2f74c0', '#d68a1e']
const REVEAL = { correct: '#2fa35a', wrong: '#e0607e' }

const el = {}
let session = null
let BY_ID = new Map()
let ORDERED_IDS = []
let builtinData = null
let resumeAnalysisAfterSets = false

async function init() {
  const data = await loadQuestions()
  await sound.ready()
  builtinData = data
  rebuildActiveQuestions()
  for (const id of [
    'screen-home', 'screen-quiz', 'screen-done', 'screen-analysis', 'settings',
    'portrait-home', 'portrait-quiz', 'portrait-done',
    'streak', 'stat-due', 'stat-new', 'stat-learned', 'stat-acc',
    'home-hint', 'home-set-name', 'btn-sets', 'btn-start', 'btn-practice', 'practice-n', 'btn-settings', 'btn-quit', 'btn-home',
    'set-setsize', 'set-setsize-val',
    'quiz-bar', 'quiz-count', 'q-theme', 'q-turn', 'q-prompt', 'tsume-giveup',
    'board', 'hand-gote', 'hand-sente', 'speech',
    'explain', 'grade-row', 'done-summary', 'result-list',
    'an-back', 'an-add-question', 'an-add-status', 'an-add-dialog', 'an-add-set-select', 'an-add-existing-wrap',
    'an-add-new-set-toggle', 'an-add-new-set-form', 'an-add-new-set-name', 'an-add-new-set-type', 'an-add-new-set-status', 'an-add-new-set-create', 'an-add-cancel', 'an-add-begin',
    'an-line-capture', 'an-line-summary', 'an-line-undo', 'an-line-cancel', 'an-line-finish',
    'set-newperday', 'set-newperday-val', 'set-mute', 'set-volume',
    'set-bgm', 'set-bgm-volume', 'set-bgm-files', 'set-bgm-file-list', 'set-bgm-url', 'set-bgm-status',
    'btn-settings-close', 'btn-reset',
    'sets-modal', 'sets-close', 'sets-select', 'sets-info', 'set-new-name', 'set-new-type', 'set-create-btn',
    'set-editor', 'set-manual-area', 'set-line-help', 'set-q-sfen', 'set-q-correct-field', 'set-q-correct', 'set-q-wrong-field', 'set-q-wrong', 'set-q-add',
    'set-import-area', 'set-import-file', 'set-import-btn', 'set-status', 'set-delete-btn',
    'quiz-promo-dialog', 'quiz-promo-yes', 'quiz-promo-no',
  ]) {
    el[id] = document.getElementById(id)
  }
  el.choices = [...document.querySelectorAll('.choice')]

  // Wire the interactive analysis board.
  initAnalysis({
    board: document.getElementById('an-board'),
    handGote: document.getElementById('an-hand-gote'),
    handSente: document.getElementById('an-hand-sente'),
    eval: document.getElementById('an-eval'),
    best: document.getElementById('an-best'),
    pv: document.getElementById('an-pv'),
    moves: document.getElementById('an-moves'),
    title: document.getElementById('an-title'),
    first: document.getElementById('an-first'),
    prev: document.getElementById('an-prev'),
    next: document.getElementById('an-next'),
    reset: document.getElementById('an-reset'),
    promoDialog: document.getElementById('promo-dialog'),
    promoYes: document.getElementById('promo-yes'),
    promoNo: document.getElementById('promo-no'),
    addStatus: document.getElementById('an-add-status'),
    addButton: document.getElementById('an-add-question'),
    lineCapture: document.getElementById('an-line-capture'),
    lineSummary: document.getElementById('an-line-summary'),
    lineUndo: document.getElementById('an-line-undo'),
    lineCancel: document.getElementById('an-line-cancel'),
    lineFinish: document.getElementById('an-line-finish'),
    onAddQuestion: addQuestionFromAnalysis,
    onAddSequence: addSequenceFromAnalysis,
  })
  el['an-back'].addEventListener('click', () => {
    closeAnalysis()
    show('done')
  })

  for (const p of [el['portrait-home'], el['portrait-quiz'], el['portrait-done']]) {
    if (p) p.src = PORTRAIT
  }

  el['btn-start'].addEventListener('click', startSession)
  el['btn-practice'].addEventListener('click', startPractice)
  el['btn-quit'].addEventListener('click', endSession)
  el['btn-home'].addEventListener('click', () => show('home'))
  el['btn-settings'].addEventListener('click', () => el.settings.classList.remove('hidden'))
  el['btn-settings-close'].addEventListener('click', closeSettings)
  el['btn-reset'].addEventListener('click', onReset)
  el.choices.forEach((b) => b.addEventListener('click', () => onChoice(Number(b.dataset.i))))
  el.board.addEventListener('click', onQuizBoardClick)
  el['hand-gote'].addEventListener('click', onQuizHandClick)
  el['hand-sente'].addEventListener('click', onQuizHandClick)
  el['quiz-promo-yes'].addEventListener('click', () => resolveQuizPromo(true))
  el['quiz-promo-no'].addEventListener('click', () => resolveQuizPromo(false))
  el['tsume-giveup'].addEventListener('click', giveUpTsume)

  el['btn-sets'].addEventListener('click', () => openSetManager())
  el['sets-close'].addEventListener('click', closeSetManager)
  el['sets-select'].addEventListener('change', onSetSelected)
  el['set-create-btn'].addEventListener('click', createSet)
  el['set-q-add'].addEventListener('click', addManualQuestion)
  el['set-import-btn'].addEventListener('click', importQuestionText)
  el['set-delete-btn'].addEventListener('click', deleteSelectedSet)
  el['an-add-question'].addEventListener('click', openAnalysisAddDialog)
  el['an-add-set-select'].addEventListener('change', updateAnalysisAddButton)
  el['an-add-new-set-toggle'].addEventListener('click', toggleAnalysisNewSetForm)
  el['an-add-new-set-create'].addEventListener('click', createAnalysisAddSet)
  el['an-add-cancel'].addEventListener('click', cancelAnalysisAdd)
  el['an-add-begin'].addEventListener('click', beginAnalysisAdd)

  const unlock = () => {
    sound.unlock()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })

  el['set-newperday'].value = store.newPerDay
  el['set-newperday-val'].textContent = store.newPerDay
  el['set-newperday'].addEventListener('input', (e) => {
    const v = Number(e.target.value)
    el['set-newperday-val'].textContent = v
    store.setNewPerDay(v)
  })
  el['set-setsize'].value = store.setSize
  el['set-setsize-val'].textContent = store.setSize
  el['set-setsize'].addEventListener('input', (e) => {
    const v = Number(e.target.value)
    el['set-setsize-val'].textContent = v
    store.setSetSize(v)
  })
  el['set-mute'].checked = sound.muted
  el['set-mute'].addEventListener('change', (e) => sound.setMuted(e.target.checked))
  el['set-volume'].value = Math.round(sound.volume * 100)
  el['set-volume'].addEventListener('input', (e) => sound.setVolume(Number(e.target.value) / 100))
  el['set-bgm'].checked = sound.bgmEnabled
  el['set-bgm'].addEventListener('change', (e) => sound.setBgmEnabled(e.target.checked))
  el['set-bgm-volume'].value = Math.round(sound.bgmVolume * 100)
  el['set-bgm-volume'].addEventListener('input', (e) => sound.setBgmVolume(Number(e.target.value) / 100))
  el['set-bgm-files'].addEventListener('change', async (e) => {
    const result = await sound.addBgmFiles(e.target.files)
    e.target.value = ''
    renderBgmFileList()
    el['set-bgm-status'].textContent = result.error
      ? 'ファイルを保存できませんでした。端末の空き容量を確認してください。'
      : result.added > 0
        ? `${result.added}曲を登録しました。曲が終わるとランダムに次の曲へ切り替わります。`
        : '新しく登録する音声ファイルがありません。'
  })
  renderBgmFileList()
  el['set-bgm-url'].value = sound.bgmUrl
  el['set-bgm-url'].addEventListener('change', (e) => {
    const ok = sound.setBgmUrl(e.target.value)
    el['set-bgm-status'].textContent = ok
      ? e.target.value.trim()
        ? '音源を設定しました。次のタップからオンライン時に再生します。'
        : '音源URLを空にしました。BGMは再生されません。'
      : 'URLを確認してください。MP3 / OGG / M4A の直リンクが必要です。'
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAnalysis('visibility', 'アプリが画面外のため解析を一時停止中…')
    else resumeAnalysis('visibility')
  })

  refreshHome()
  show('home')
}

function renderBgmFileList() {
  const list = el['set-bgm-file-list']
  if (!list) return
  list.innerHTML = ''
  sound.bgmFiles.forEach((file) => {
    const item = document.createElement('li')
    item.className = 'bgm-file-item'
    const name = document.createElement('span')
    name.className = 'bgm-file-name'
    name.textContent = file.name
    name.title = file.name
    const remove = document.createElement('button')
    remove.className = 'mini-btn'
    remove.type = 'button'
    remove.textContent = '削除'
    remove.addEventListener('click', async () => {
      const ok = await sound.removeBgmFile(file.id)
      if (ok) {
        renderBgmFileList()
        el['set-bgm-status'].textContent = '登録曲から削除しました。'
      }
    })
    item.append(name, remove)
    list.appendChild(item)
  })
}

function show(name) {
  el['screen-home'].classList.toggle('hidden', name !== 'home')
  el['screen-quiz'].classList.toggle('hidden', name !== 'quiz')
  el['screen-done'].classList.toggle('hidden', name !== 'done')
  el['screen-analysis'].classList.toggle('hidden', name !== 'analysis')
}

function activeSet() {
  return store.activeSetId === 'builtin' ? null : store.getQuestionSet(store.activeSetId)
}

function rebuildActiveQuestions() {
  const set = activeSet()
  if (!set) {
    if (store.activeSetId !== 'builtin') store.setActiveSetId('builtin')
    BY_ID = builtinData ? builtinData.BY_ID : new Map()
    ORDERED_IDS = builtinData ? builtinData.ORDERED_IDS : []
    return
  }
  const list = buildFrom(set.questions, {
    type: set.type,
    idPrefix: `${set.id}-`,
    defaultTheme: set.name,
  })
  const indexed = indexOf(list)
  BY_ID = indexed.BY_ID
  ORDERED_IDS = indexed.ORDERED_IDS
}

function activeSetLabel() {
  const set = activeSet()
  return set ? `${set.name}（${set.type === 'choice' ? '二択' : set.type === 'line' ? '手順' : set.type === 'tsume' ? '詰将棋' : '指して解答'}）` : '標準問題（二択）'
}

function refreshHome() {
  const s = store.summary(ORDERED_IDS)
  el.streak.textContent = s.streak
  el['stat-due'].textContent = s.due
  el['stat-new'].textContent = Math.min(s.newAvailable, s.newRemainingToday)
  el['stat-learned'].textContent = `${s.learned}/${s.total}`
  const acc = store.accuracy()
  el['stat-acc'].textContent = acc == null ? '—' : `${Math.round(acc * 100)}%`
  el['home-set-name'].textContent = activeSetLabel()

  el['practice-n'].textContent = store.setSize
  el['btn-practice'].disabled = s.total === 0

  const playable = s.due + Math.min(s.newAvailable, s.newRemainingToday)
  el['btn-start'].disabled = playable === 0
  if (playable === 0) {
    el['home-hint'].textContent =
      s.total === 0
        ? activeSet()
          ? 'この問題セットは空です。「管理・切替」から問題を追加してください。'
          : '標準の問題データがありません。'
        : s.newAvailable === 0
          ? 'ぜんぶ覚えたね！復習の時間まで待ってね。'
          : '今日のノルマ達成！明日また新しい問題がでるよ。'
  } else {
    const parts = []
    if (s.due) parts.push(`復習 ${s.due}問`)
    const nn = Math.min(s.newAvailable, s.newRemainingToday)
    if (nn) parts.push(`新しい問題 ${nn}問`)
    el['home-hint'].textContent = `今日は ${parts.join(' ・ ')} だよ！`
  }
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildQueue() {
  const now = new Date()
  const due = shuffle(store.dueIds(ORDERED_IDS, now))
  const nNew = Math.min(store.newIds(ORDERED_IDS).length, store.newRemainingToday())
  const fresh = store.newIds(ORDERED_IDS).slice(0, nNew)
  return [...due, ...fresh]
}

// Build a repeatable practice set of up to `setSize`, ignoring the daily new
// cap: due first, then unseen, then already-learned (random) for extra reps —
// so you can keep drilling 10-at-a-time as many times as you like.
function buildPracticeQueue() {
  const now = new Date()
  const N = store.setSize
  const dueArr = shuffle(store.dueIds(ORDERED_IDS, now))
  const dueSet = new Set(dueArr)
  const fresh = shuffle(store.newIds(ORDERED_IDS))
  const seenNotDue = shuffle(ORDERED_IDS.filter((id) => !store.isNew(id) && !dueSet.has(id)))
  const pool = [...dueArr, ...fresh, ...seenNotDue]
  const seen = new Set()
  const q = []
  for (const id of pool) {
    if (seen.has(id)) continue
    seen.add(id)
    q.push(id)
    if (q.length >= N) break
  }
  return q
}

function beginSession(queue) {
  if (queue.length === 0) {
    refreshHome()
    return
  }
  session = { queue, ptr: 0, initial: queue.length, correct: 0, wrong: 0, answered: 0, results: [] }
  show('quiz')
  presentCurrent()
}

function startSession() {
  beginSession(buildQueue())
}

function startPractice() {
  beginSession(buildPracticeQueue())
}

function endSession() {
  if (session?.current?.play?.timer) clearTimeout(session.current.play.timer)
  el['quiz-promo-dialog'].classList.add('hidden')
  session = null
  refreshHome()
  show('home')
}

function renderBoard(moves) {
  const q = session.current.q
  el.board.innerHTML = boardSVG(q.position, { moves })
  el['hand-gote'].innerHTML = handHTML(q.position, 'w')
  el['hand-sente'].innerHTML = handHTML(q.position, 'b')
}

function presentCurrent() {
  if (!session || session.ptr >= session.queue.length) return finishSession()
  const id = session.queue[session.ptr]
  const q = BY_ID.get(id)
  if (!q) {
    session.ptr++
    return presentCurrent()
  }

  const isChoice = q.answerType === 'choice'
  const isLine = q.answerType === 'line'
  const isTsume = q.answerType === 'tsume'
  const order = isChoice ? (Math.random() < 0.5 ? [0, 1] : [1, 0]) : null
  let play = null
  if (!isChoice) {
    if (isLine) {
      const checkpoints = q.line.map((_, i) => i).filter((i) => i % 2 === 0)
      const later = checkpoints.slice(1)
      // A new line is always learned from its beginning. On later reviews,
      // half the presentations start at a random later decision point.
      const useCheckpoint = !store.isNew(id) && later.length > 0 && Math.random() < 0.5
      const startPly = useCheckpoint ? later[Math.floor(Math.random() * later.length)] : 0
      play = {
        kind: 'line',
        position: q.linePositions[startPly],
        ply: startPly,
        startPly,
        totalAnswers: Math.ceil((q.line.length - startPly) / 2),
        answered: 0,
        allCorrect: true,
        locked: false,
        selected: null,
        selectedDrop: null,
        targets: [],
        pending: null,
        timer: null,
        lastMove: null,
      }
    } else if (isTsume) {
      play = {
        kind: 'tsume',
        position: q.position,
        attacker: q.position.turn,
        answered: 0,
        allCorrect: true,
        selected: null,
        selectedDrop: null,
        targets: [],
        pending: null,
        locked: false,
        timer: null,
        lastMove: null,
      }
    } else {
      play = { kind: 'move', position: q.position, selected: null, selectedDrop: null, targets: [], pending: null, locked: false, lastMove: null }
    }
  }
  session.current = {
    id,
    q,
    order,
    revealed: false,
    play,
  }
  sound.startBgmForQuestion()

  el['q-theme'].textContent = q.theme
  const shownPosition = play?.position || q.position
  el['q-turn'].textContent = shownPosition.turn === 'b' ? '先手番 ▲' : '後手番 △'
  el.choices[0].parentElement.classList.toggle('hidden', !isChoice)
  el['tsume-giveup'].classList.toggle('hidden', !isTsume)
  if (isChoice) {
    const moves = [q.correct, q.wrong]
    const jp = [q.correctJp, q.wrongJp]
    renderBoard(order.map((orig, k) => ({ usi: moves[orig], color: CHOICE_COLORS[k], label: String(k + 1) })))
    el['q-prompt'].textContent = '正しい手はどっち？'
    el.choices.forEach((btn, k) => {
      btn.className = 'choice'
      btn.disabled = false
      btn.dataset.orig = order[k]
      btn.style.setProperty('--cc', CHOICE_COLORS[k])
      btn.querySelector('.cnum').textContent = k + 1
      btn.querySelector('.cmove').textContent = jp[order[k]]
    })
  } else {
    renderPlayBoard()
    if (isLine) updateLinePrompt()
    else if (isTsume) updateTsumePrompt()
    else el['q-prompt'].textContent = '正解手を盤上で指してください'
  }

  el.explain.classList.add('hidden')
  el['grade-row'].classList.add('hidden')
  el['grade-row'].innerHTML = ''
  el.speech.classList.add('hidden')
  setPortraitMood('idle')

  const done = session.ptr
  el['quiz-bar'].style.width = `${Math.round((done / session.initial) * 100)}%`
  el['quiz-count'].textContent = `${done} / ${session.initial}`
}

function renderPlayBoard() {
  const cur = session?.current
  if (!cur || !cur.play) return
  const p = cur.play
  el.board.innerHTML = interactiveBoardSVG(p.position, { selected: p.selected, targets: p.targets, lastMove: p.lastMove })
  const interactive = !cur.revealed && !p.locked
  el['hand-gote'].innerHTML = handHTML(p.position, 'w', {
    interactive, turn: p.position.turn, selectedDrop: p.selectedDrop,
  })
  el['hand-sente'].innerHTML = handHTML(p.position, 'b', {
    interactive, turn: p.position.turn, selectedDrop: p.selectedDrop,
  })
}

function updateLinePrompt(message = '') {
  const p = session?.current?.play
  if (!p || p.kind !== 'line') return
  const prefix = p.startPly ? '途中局面から　' : ''
  el['q-prompt'].textContent = message || `${prefix}正解手を指してください（${p.answered + 1}/${p.totalAnswers}）`
}

function updateTsumePrompt(message = '') {
  const p = session?.current?.play
  if (!p || p.kind !== 'tsume') return
  el['q-prompt'].textContent = message || `王手を続けて詰ませてください（${p.answered + 1}手目）`
}

function clearQuizSelection() {
  const p = session?.current?.play
  if (!p) return
  p.selected = null
  p.selectedDrop = null
  p.targets = []
}

function onQuizBoardClick(e) {
  const cur = session?.current
  if (!cur?.play || cur.revealed || cur.play.locked) return
  const cell = e.target.closest('.cell')
  if (!cell) return
  const r = Number(cell.dataset.r)
  const c = Number(cell.dataset.c)
  const p = cur.play
  const pos = p.position
  const inTargets = p.targets.some((t) => t.row === r && t.col === c)
  if (p.selectedDrop) {
    if (inTargets) return submitPlayedMove({ drop: p.selectedDrop, to: { row: r, col: c } })
    clearQuizSelection()
    return renderPlayBoard()
  }
  if (p.selected) {
    if (inTargets) {
      const moves = legalMoves(pos).filter(
        (m) => m.from && m.from.row === p.selected.row && m.from.col === p.selected.col && m.to.row === r && m.to.col === c,
      )
      if (moves.length === 1) return submitPlayedMove(moves[0])
      if (moves.length > 1) {
        p.pending = moves
        el['quiz-promo-dialog'].classList.remove('hidden')
        return
      }
    }
    const piece = pos.board[r][c]
    if (piece && piece.color === pos.turn) {
      p.selected = { row: r, col: c }
      p.selectedDrop = null
      p.targets = movesFrom(pos, r, c).map((m) => m.to)
    } else clearQuizSelection()
    return renderPlayBoard()
  }
  const piece = pos.board[r][c]
  if (piece && piece.color === pos.turn) {
    p.selected = { row: r, col: c }
    p.targets = movesFrom(pos, r, c).map((m) => m.to)
  }
  renderPlayBoard()
}

function onQuizHandClick(e) {
  const cur = session?.current
  if (!cur?.play || cur.revealed || cur.play.locked) return
  const chip = e.target.closest('.hand-piece[data-drop]')
  if (!chip || chip.dataset.color !== cur.play.position.turn) return
  cur.play.selected = null
  cur.play.selectedDrop = chip.dataset.drop
  cur.play.targets = dropTargets(cur.play.position, chip.dataset.drop).map((m) => m.to)
  renderPlayBoard()
}

function resolveQuizPromo(promote) {
  el['quiz-promo-dialog'].classList.add('hidden')
  const p = session?.current?.play
  if (!p?.pending || p.locked) return
  const move = p.pending.find((m) => !!m.promote === promote) || p.pending[0]
  p.pending = null
  submitPlayedMove(move)
}

function submitPlayedMove(move) {
  const cur = session?.current
  if (!cur?.play || cur.revealed || cur.play.locked) return
  if (cur.play.kind === 'line') return submitLineMove(move)
  if (cur.play.kind === 'tsume') return submitTsumeMove(move)
  const attempted = usiOf(move)
  const correct = attempted === cur.q.correct
  cur.revealed = true
  cur.correct = correct
  const marks = [{ usi: cur.q.correct, color: REVEAL.correct, label: '正' }]
  if (!correct) marks.push({ usi: attempted, color: REVEAL.wrong, label: '誤' })
  renderBoard(marks)
  finishAnswer(correct)
}

function submitLineMove(move) {
  const cur = session?.current
  const p = cur?.play
  if (!p || p.kind !== 'line' || cur.revealed || p.locked) return
  const expected = cur.q.line[p.ply]
  const attempted = usiOf(move)
  if (attempted === expected) {
    advanceLineAfterAnswer(true)
    return
  }

  p.allCorrect = false
  p.locked = true
  clearQuizSelection()
  const correctJp = cur.q.lineJp[p.ply]
  el.board.innerHTML = boardSVG(p.position, { moves: [
    { usi: expected, color: REVEAL.correct, label: '正' },
    { usi: attempted, color: REVEAL.wrong, label: '誤' },
  ] })
  el['hand-gote'].innerHTML = handHTML(p.position, 'w')
  el['hand-sente'].innerHTML = handHTML(p.position, 'b')
  updateLinePrompt(`違います。正解は ${correctJp}`)
  p.timer = setTimeout(() => {
    if (session?.current !== cur || cur.revealed) return
    p.locked = false
    advanceLineAfterAnswer(false)
  }, 900)
}

function advanceLineAfterAnswer(wasCorrect) {
  const cur = session?.current
  const p = cur?.play
  if (!p || p.kind !== 'line') return
  const expected = cur.q.line[p.ply]
  const move = moveFromUsi(p.position, expected)
  if (!move) {
    p.allCorrect = false
    return finishLineAnswer()
  }
  p.position = applyMove(p.position, move)
  p.lastMove = { from: move.from || null, to: move.to }
  p.ply++
  p.answered++
  p.selected = null
  p.selectedDrop = null
  p.targets = []
  if (p.ply >= cur.q.line.length) return finishLineAnswer()

  p.locked = true
  renderPlayBoard()
  updateLinePrompt(wasCorrect ? '相手の応手…' : '正解手から続けます…')
  p.timer = setTimeout(() => playLineReply(cur), 450)
}

function playLineReply(cur) {
  if (session?.current !== cur || cur.revealed) return
  const p = cur.play
  const replyUsi = cur.q.line[p.ply]
  const reply = moveFromUsi(p.position, replyUsi)
  if (!reply) {
    p.allCorrect = false
    return finishLineAnswer()
  }
  p.position = applyMove(p.position, reply)
  p.lastMove = { from: reply.from || null, to: reply.to }
  p.ply++
  p.locked = false
  clearQuizSelection()
  renderPlayBoard()
  updateLinePrompt()
}

function finishLineAnswer() {
  const cur = session?.current
  if (!cur || cur.revealed) return
  cur.revealed = true
  cur.play.locked = true
  cur.correct = cur.play.allCorrect
  renderPlayBoard()
  finishAnswer(cur.correct)
}

function submitTsumeMove(move) {
  const cur = session?.current
  const p = cur?.play
  if (!p || p.kind !== 'tsume' || cur.revealed || p.locked) return
  const next = applyMove(p.position, move)
  const defender = next.turn
  if (!isInCheck(next.board, defender)) {
    p.allCorrect = false
    return finishTsumeAnswer(false, '王手になっていないため不正解です。')
  }

  const replies = legalMoves(next)
  if (!replies.length) {
    p.position = next
    p.lastMove = { from: move.from || null, to: move.to }
    p.answered++
    renderPlayBoard()
    if (move.drop === 'P') return finishTsumeAnswer(false, '打ち歩詰めは反則です。')
    return finishTsumeAnswer(true, `${p.answered}手で詰みました。`)
  }

  p.position = next
  p.lastMove = { from: move.from || null, to: move.to }
  p.answered++
  p.locked = true
  clearQuizSelection()
  renderPlayBoard()
  updateTsumePrompt('玉方が応手を選んでいます…')
  playTsumeReply(cur, replies)
}

function weightedRandom(items, weights) {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0)
  if (!(total > 0)) return items[Math.floor(Math.random() * items.length)]
  let pick = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    pick -= Math.max(0, weights[i])
    if (pick <= 0) return items[i]
  }
  return items[items.length - 1]
}

async function chooseTsumeReply(position, replies) {
  const weights = replies.map(() => 1)
  // The engine is already warm after using the analysis screen. If it is not,
  // do not hold the quiz up for a large NNUE load: start it for later turns and
  // use a genuinely random legal evasion now.
  if (!engine.ready) {
    engine.ensureReady().catch(() => {})
    return weightedRandom(replies, weights)
  }
  try {
    const result = await Promise.race([
      engine.analyze(toSfen(position), { movetime: 700 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('engine timeout')), 2500)),
    ])
    ;(result.lines || []).forEach((line, rank) => {
      const i = replies.findIndex((move) => usiOf(move) === line.move)
      if (i < 0) return
      if (line.mate != null) {
        // A negative mate score means this side is being mated. Longer escapes
        // get more tickets, while shorter and unranked replies remain possible.
        weights[i] = line.mate < 0
          ? 5 + Math.min(80, Math.abs(line.mate) ** 2)
          : 100
      } else {
        weights[i] = [12, 7, 4][rank] || 2
      }
    })
  } catch {
    // Engine trouble must not make a tsume problem unplayable.
  }
  return weightedRandom(replies, weights)
}

async function playTsumeReply(cur, replies) {
  const p = cur.play
  const reply = await chooseTsumeReply(p.position, replies)
  if (session?.current !== cur || cur.revealed || p.kind !== 'tsume') return
  const stillLegal = moveFromUsi(p.position, usiOf(reply))
  if (!stillLegal) return finishTsumeAnswer(false, '玉方の応手を作れませんでした。')
  p.position = applyMove(p.position, stillLegal)
  p.lastMove = { from: stillLegal.from || null, to: stillLegal.to }
  p.locked = false
  clearQuizSelection()
  renderPlayBoard()
  updateTsumePrompt()
}

function giveUpTsume() {
  const cur = session?.current
  if (!cur || cur.revealed || cur.play?.kind !== 'tsume') return
  finishTsumeAnswer(false, '詰みなし／あきらめるを選びました。')
}

function finishTsumeAnswer(correct, message) {
  const cur = session?.current
  if (!cur || cur.revealed || cur.play?.kind !== 'tsume') return
  cur.revealed = true
  cur.correct = correct
  cur.play.locked = true
  cur.answerMessage = message
  el['tsume-giveup'].classList.add('hidden')
  renderPlayBoard()
  updateTsumePrompt(correct ? '詰み！' : '不正解')
  finishAnswer(correct)
}

function onChoice(k) {
  const cur = session?.current
  if (!cur || cur.revealed) return
  cur.revealed = true

  const origIdx = cur.order[k]
  const correct = origIdx === 0 // orig index 0 is always the correct move
  cur.correct = correct

  const q = cur.q
  // Re-draw arrows coloured by correctness (keep their original numbers).
  const numFor = (orig) => String(cur.order.indexOf(orig) + 1)
  renderBoard([
    { usi: q.correct, color: REVEAL.correct, label: numFor(0) },
    { usi: q.wrong, color: REVEAL.wrong, label: numFor(1) },
  ])

  el.choices.forEach((btn) => {
    btn.disabled = true
    const o = Number(btn.dataset.orig)
    if (o === 0) btn.classList.add('is-correct')
    if (o === origIdx && !correct) btn.classList.add('is-wrong')
  })

  finishAnswer(correct)
}

function finishAnswer(correct) {
  const q = session.current.q
  const caption = correct ? sound.playGood() : sound.playBad()
  setPortraitMood(correct ? 'happy' : 'sad')
  if (caption) {
    el.speech.textContent = caption
    el.speech.classList.remove('hidden')
  }

  const explainText = q.comment || session.current.answerMessage || (q.answerType === 'line'
    ? `正解手順：${q.lineJp.join('　')}`
    : q.answerType === 'tsume'
      ? '王手を続け、玉方に合法な応手がなくなれば正解です。'
      : `正解は ${q.correctJp} でした。`)
  el.explain.textContent = explainText
  el.explain.classList.remove('hidden')

  renderGradeButtons(correct)
}

function renderGradeButtons(correct) {
  const row = el['grade-row']
  row.innerHTML = ''
  row.classList.remove('hidden')
  const preCard = store.getCard(session.current.id) || newCard()

  const mk = (label, easy, cls) => {
    const b = document.createElement('button')
    b.className = `grade-btn ${cls}`
    const res = grade(preCard, correct, { easy })
    const small = document.createElement('span')
    small.className = 'grade-when'
    small.textContent = intervalLabel(res.card.due)
    b.append(document.createTextNode(label), small)
    b.addEventListener('click', () => commitGrade(correct, easy))
    return b
  }

  if (correct) {
    row.append(mk('つぎへ', false, 'good'), mk('かんたん！', true, 'easy'))
  } else {
    row.append(mk('もう一度おぼえる', false, 'again'))
  }
}

function commitGrade(correct, easy) {
  const cur = session.current
  const wasNew = store.isNew(cur.id)
  const preCard = store.getCard(cur.id) || newCard()
  const { card, log } = grade(preCard, correct, { easy })
  store.recordReview(cur.id, { card, correct, rating: log.rating, wasNew })

  session.answered++
  if (correct) session.correct++
  else session.wrong++
  // No in-session re-drilling: each question is shown once. Wrong ones are
  // rescheduled by FSRS for a future day, and can be studied now on the result
  // screen with the interactive analysis board.
  session.results.push({ id: cur.id, correct })
  session.ptr++
  presentCurrent()
}

function finishSession() {
  const s = session
  show('done')
  setPortraitMoodOn(el['portrait-done'], s.correct >= s.wrong ? 'happy' : 'idle')
  const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0
  el['done-summary'].innerHTML = `
    <div class="done-stat"><b>${s.initial}</b><span>出題</span></div>
    <div class="done-stat"><b>${acc}%</b><span>正解率</span></div>
    <div class="done-stat"><b>${store.state.streak.current}</b><span>日連続</span></div>`
  renderResultList(s.results)
  session = null
  refreshHome()
}

// List every question from the session; tap one to open the analysis board.
function renderResultList(results) {
  const list = el['result-list']
  list.innerHTML = ''
  results.forEach((r, i) => {
    const q = BY_ID.get(r.id)
    if (!q) return
    const row = document.createElement('button')
    row.className = `result-row ${r.correct ? 'ok' : 'ng'}`
    row.innerHTML =
      `<span class="rr-mark">${r.correct ? '✓' : '✗'}</span>` +
      `<span class="rr-info"><span class="rr-theme">${q.theme}</span>` +
      `<span class="rr-move">${q.answerType === 'line' ? `正解手順 ${q.line.length}手` : q.answerType === 'tsume' ? '詰将棋' : `正解 ${q.correctJp}`}</span></span>` +
      `<span class="rr-go">検討 ▶</span>`
    row.addEventListener('click', () => {
      show('analysis')
      openAnalysis(q)
    })
    list.appendChild(row)
  })
}

function setPortraitMood(mood) {
  setPortraitMoodOn(el['portrait-quiz'], mood)
}
function setPortraitMoodOn(img, mood) {
  if (!img) return
  img.classList.remove('is-happy', 'is-sad', 'is-idle')
  void img.offsetWidth
  img.classList.add(`is-${mood}`)
}

// ---- question-set management ---------------------------------------------
function setTypeLabel(type) {
  return type === 'choice' ? '二択' : type === 'line' ? '手順を指して解答' : type === 'tsume' ? '詰将棋' : '盤上で指して解答'
}

function renderSetManager(selectedId = store.activeSetId) {
  const sets = store.getQuestionSets()
  el['sets-select'].innerHTML = [
    `<option value="builtin">標準問題（二択・${builtinData?.QUESTIONS.length || 0}問）</option>`,
    ...sets.map((set) => `<option value="${set.id}">${escapeHtml(set.name)}（${setTypeLabel(set.type)}・${set.questions.length}問）</option>`),
  ].join('')
  if (![...el['sets-select'].options].some((o) => o.value === selectedId)) selectedId = 'builtin'
  el['sets-select'].value = selectedId
  const set = selectedId === 'builtin' ? null : store.getQuestionSet(selectedId)
  el['sets-info'].textContent = set
    ? `${setTypeLabel(set.type)} ／ ${set.questions.length}問。内容はこの端末に保存されます。`
    : '自動生成プログラムから同梱された標準問題です。'
  el['set-editor'].classList.toggle('hidden', !set)
  if (set) {
    const choice = set.type === 'choice'
    const line = set.type === 'line'
    const tsume = set.type === 'tsume'
    el['set-manual-area'].classList.toggle('hidden', line)
    el['set-line-help'].classList.toggle('hidden', !line)
    el['set-q-correct-field'].classList.toggle('hidden', tsume)
    el['set-q-wrong-field'].classList.toggle('hidden', !choice)
    el['set-import-area'].classList.toggle('hidden', !choice)
    el['set-q-add'].textContent = tsume ? '開始局面を追加' : '1問追加'
  }
}

function openSetManager({ resumeAnalysisOnClose = false } = {}) {
  resumeAnalysisAfterSets = resumeAnalysisAfterSets || resumeAnalysisOnClose
  renderSetManager()
  el['set-status'].textContent = ''
  el['sets-modal'].classList.remove('hidden')
}

function closeSetManager() {
  el['sets-modal'].classList.add('hidden')
  refreshHome()
  if (resumeAnalysisAfterSets) {
    resumeAnalysisAfterSets = false
    resumeAnalysis('add-dialog')
  }
}

function onSetSelected() {
  store.setActiveSetId(el['sets-select'].value)
  rebuildActiveQuestions()
  renderSetManager(store.activeSetId)
  refreshHome()
}

function createSet() {
  try {
    const set = store.createQuestionSet(el['set-new-name'].value, el['set-new-type'].value)
    el['set-new-name'].value = ''
    rebuildActiveQuestions()
    renderSetManager(set.id)
    el['set-status'].textContent = `「${set.name}」を作成しました。`
    refreshHome()
  } catch (e) {
    el['sets-info'].textContent = e.message || String(e)
  }
}

function selectedEditableSet() {
  const id = el['sets-select'].value
  return id === 'builtin' ? null : store.getQuestionSet(id)
}

function cleanSfen(value) {
  return String(value || '').trim().replace(/^sfen\s+/i, '')
}

function validateOne(set, raw, { checkLegal = true } = {}) {
  const list = buildFrom([raw], { type: set.type, idPrefix: `${set.id}-`, defaultTheme: set.name })
  if (list.length !== 1) throw new Error('SFENまたは指し手の形式を確認してください。')
  const q = list[0]
  if (checkLegal && set.type !== 'tsume' && !moveFromUsi(q.position, q.correct)) throw new Error('正解手がこの局面の合法手ではありません。')
  if (checkLegal && q.wrong && !moveFromUsi(q.position, q.wrong)) throw new Error('不正解手がこの局面の合法手ではありません。')
  return q
}

function addManualQuestion() {
  const set = selectedEditableSet()
  if (!set || set.type === 'line') return
  const raw = {
    sfen: cleanSfen(el['set-q-sfen'].value),
    ...(set.type !== 'tsume' ? { correct: el['set-q-correct'].value.trim() } : {}),
    ...(set.type === 'choice' ? { wrong: el['set-q-wrong'].value.trim() } : {}),
    theme: set.name,
  }
  try {
    validateOne(set, raw)
    const added = store.addQuestions(set.id, [raw])
    if (!added) throw new Error('同じ問題がすでに入っています。')
    el['set-q-sfen'].value = ''
    el['set-q-correct'].value = ''
    el['set-q-wrong'].value = ''
    if (store.activeSetId === set.id) rebuildActiveQuestions()
    renderSetManager(set.id)
    el['set-status'].textContent = '1問追加しました。'
    refreshHome()
  } catch (e) {
    el['set-status'].textContent = e.message || String(e)
  }
}

async function importQuestionText() {
  const set = selectedEditableSet()
  if (!set || set.type !== 'choice') return
  const file = el['set-import-file'].files?.[0]
  if (!file) {
    el['set-status'].textContent = '取り込むTXTファイルを選んでください。'
    return
  }
  try {
    const parsed = parseChoiceText(await file.text())
    const valid = buildFrom(parsed, { type: 'choice', idPrefix: `${set.id}-`, defaultTheme: set.name })
    const added = store.addQuestions(set.id, valid.map((q) => ({
      sfen: q.sfen, correct: q.correct, wrong: q.wrong, theme: set.name,
    })))
    if (store.activeSetId === set.id) rebuildActiveQuestions()
    renderSetManager(set.id)
    el['set-import-file'].value = ''
    el['set-status'].textContent = `${parsed.length}問を読み取り、重複を除く${added}問を追加しました。`
    refreshHome()
  } catch (e) {
    el['set-status'].textContent = `取り込み失敗: ${e.message || e}`
  }
}

function deleteSelectedSet() {
  const set = selectedEditableSet()
  if (!set || !confirm(`問題セット「${set.name}」と、その問題を削除します。よろしいですか？`)) return
  store.deleteQuestionSet(set.id)
  rebuildActiveQuestions()
  renderSetManager('builtin')
  el['set-status'].textContent = '問題セットを削除しました。'
  refreshHome()
}

function openAnalysisAddDialog() {
  pauseAnalysis('add-dialog', '問題追加の準備中…')
  const sets = store.getQuestionSets().filter((set) => set.type === 'move' || set.type === 'line' || set.type === 'tsume')
  const select = el['an-add-set-select']
  select.innerHTML = sets
    .map((set) => `<option value="${set.id}">${escapeHtml(set.name)}（${set.type === 'line' ? '手順' : set.type === 'tsume' ? '詰将棋' : '1手'}）</option>`)
    .join('')
  const active = sets.find((set) => set.id === store.activeSetId)
  select.value = (active || sets[0])?.id || ''
  el['an-add-existing-wrap'].classList.toggle('hidden', sets.length === 0)
  el['an-add-begin'].disabled = sets.length === 0
  el['an-add-new-set-form'].classList.toggle('hidden', sets.length > 0)
  el['an-add-new-set-name'].value = ''
  el['an-add-new-set-status'].textContent = ''
  el['an-add-new-set-toggle'].classList.toggle('hidden', sets.length === 0)
  updateAnalysisAddButton()
  el['an-add-dialog'].classList.remove('hidden')
}

function toggleAnalysisNewSetForm() {
  const form = el['an-add-new-set-form']
  const show = form.classList.contains('hidden')
  form.classList.toggle('hidden', !show)
  el['an-add-new-set-status'].textContent = ''
  if (show) el['an-add-new-set-name'].focus()
}

function createAnalysisAddSet() {
  try {
    const set = store.createQuestionSet(el['an-add-new-set-name'].value, el['an-add-new-set-type'].value)
    rebuildActiveQuestions()
    refreshHome()

    const sets = store.getQuestionSets().filter((item) => item.type === 'move' || item.type === 'line' || item.type === 'tsume')
    el['an-add-set-select'].innerHTML = sets
      .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}（${item.type === 'line' ? '手順' : item.type === 'tsume' ? '詰将棋' : '1手'}）</option>`)
      .join('')
    el['an-add-set-select'].value = set.id
    el['an-add-existing-wrap'].classList.remove('hidden')
    el['an-add-begin'].disabled = false
    el['an-add-new-set-form'].classList.add('hidden')
    el['an-add-new-set-toggle'].classList.remove('hidden')
    el['an-add-new-set-name'].value = ''
    updateAnalysisAddButton()
  } catch (e) {
    el['an-add-new-set-status'].textContent = e.message || String(e)
  }
}

function updateAnalysisAddButton() {
  const set = store.getQuestionSet(el['an-add-set-select'].value)
  el['an-add-begin'].textContent = set?.type === 'line' ? '手順を記録' : set?.type === 'tsume' ? 'この局面を登録' : '正解手を指定'
}

function cancelAnalysisAdd() {
  el['an-add-dialog'].classList.add('hidden')
  resumeAnalysis('add-dialog')
}

function beginAnalysisAdd() {
  const setId = el['an-add-set-select'].value
  const set = store.getQuestionSet(setId)
  el['an-add-dialog'].classList.add('hidden')
  if (set?.type === 'tsume') {
    const added = addTsumeFromAnalysis(set, currentAnalysisSfen())
    el['an-add-status'].textContent = added ? '詰将棋の開始局面を追加しました。' : '追加できませんでした（同じ局面が登録済みかもしれません）。'
    resumeAnalysis('add-dialog')
    return
  }
  if (!beginAddCapture(setId, set?.type)) resumeAnalysis('add-dialog')
}

function addTsumeFromAnalysis(set, sfen) {
  if (!set || set.type !== 'tsume' || !sfen) return false
  const raw = { sfen, theme: set.name }
  try {
    validateOne(set, raw)
    const added = store.addQuestions(set.id, [raw])
    if (added && store.activeSetId === set.id) rebuildActiveQuestions()
    refreshHome()
    return added > 0
  } catch {
    return false
  }
}

function addQuestionFromAnalysis({ setId, sfen, correct }) {
  const set = store.getQuestionSet(setId)
  if (!set || set.type !== 'move') return false
  const raw = { sfen, correct, theme: set.name }
  try {
    validateOne(set, raw)
    const added = store.addQuestions(set.id, [raw])
    if (added && store.activeSetId === set.id) rebuildActiveQuestions()
    refreshHome()
    return added > 0
  } catch {
    return false
  }
}

function addSequenceFromAnalysis({ setId, sfen, line, trainSide }) {
  const set = store.getQuestionSet(setId)
  if (!set || set.type !== 'line') return false
  const raw = { sfen, line, trainSide, theme: set.name }
  try {
    const valid = buildFrom([raw], { type: 'line', idPrefix: `${set.id}-`, defaultTheme: set.name })
    if (valid.length !== 1) return false
    const added = store.addQuestions(set.id, [raw])
    if (added && store.activeSetId === set.id) rebuildActiveQuestions()
    refreshHome()
    return added > 0
  } catch {
    return false
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function closeSettings() {
  el.settings.classList.add('hidden')
  refreshHome()
}
function onReset() {
  if (!confirm('学習の記録をすべて消してリセットします。よろしいですか？')) return
  store.reset()
  rebuildActiveQuestions()
  session = null
  refreshHome()
  show('home')
  closeSettings()
}

document.addEventListener('DOMContentLoaded', init)
