// Shogi move generation + application, for the interactive analysis board.
//
// Position shape (from shogi.js parseSfen):
//   board[row][col]  row 0..8 = rank a..i (top..bottom), col 0..8 = file 9..1
//   cell = { type:'P'|'L'|'N'|'S'|'G'|'B'|'R'|'K', color:'b'|'w', promoted:bool } | null
//   hand = { b:{TYPE:count}, w:{...} }, turn = 'b'|'w', moveNo
//
// Black (sente) sits at the bottom and moves toward row 0 (forward = row-1);
// white mirrors. Move vectors below are written for black; for white we flip
// the row component.

// step-move pieces (relative [dr,dc], black orientation)
const STEP = {
  P: [[-1, 0]],
  N: [[-2, -1], [-2, 1]],
  S: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]],
  G: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]],
  K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
}
const SLIDE = {
  L: [[-1, 0]],
  B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  R: [[-1, 0], [1, 0], [0, -1], [0, 1]],
}
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const DROP_TYPES = ['R', 'B', 'G', 'S', 'N', 'L', 'P']

function vectors(piece) {
  const { type: t, promoted: pr } = piece
  if (pr) {
    if (t === 'P' || t === 'L' || t === 'N' || t === 'S') return { steps: STEP.G, slides: [] }
    if (t === 'B') return { steps: ORTHO, slides: SLIDE.B }
    if (t === 'R') return { steps: DIAG, slides: SLIDE.R }
  }
  if (t === 'P') return { steps: STEP.P, slides: [] }
  if (t === 'N') return { steps: STEP.N, slides: [] }
  if (t === 'S') return { steps: STEP.S, slides: [] }
  if (t === 'G') return { steps: STEP.G, slides: [] }
  if (t === 'K') return { steps: STEP.K, slides: [] }
  if (t === 'L') return { steps: [], slides: SLIDE.L }
  if (t === 'B') return { steps: [], slides: SLIDE.B }
  if (t === 'R') return { steps: [], slides: SLIDE.R }
  return { steps: [], slides: [] }
}

const inBoard = (r, c) => r >= 0 && r < 9 && c >= 0 && c < 9
const other = (color) => (color === 'b' ? 'w' : 'b')

export function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)))
}
function cloneHand(hand) {
  return { b: { ...hand.b }, w: { ...hand.w } }
}

// Raw destination squares a piece at (r,c) can reach (ignores king safety).
function pieceDestinations(board, r, c) {
  const piece = board[r][c]
  const flip = piece.color === 'b' ? 1 : -1
  const { steps, slides } = vectors(piece)
  const out = []
  for (const [dr, dc] of steps) {
    const nr = r + dr * flip
    const nc = c + dc
    if (!inBoard(nr, nc)) continue
    const t = board[nr][nc]
    if (!t || t.color !== piece.color) out.push([nr, nc])
  }
  for (const [dr, dc] of slides) {
    let nr = r + dr * flip
    let nc = c + dc
    while (inBoard(nr, nc)) {
      const t = board[nr][nc]
      if (!t) out.push([nr, nc])
      else {
        if (t.color !== piece.color) out.push([nr, nc])
        break
      }
      nr += dr * flip
      nc += dc
    }
  }
  return out
}

export function findKing(board, color) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (p && p.type === 'K' && p.color === color) return [r, c]
    }
  return null
}

// Is `color`'s king attacked in this board?
export function isInCheck(board, color) {
  const k = findKing(board, color)
  if (!k) return false
  const enemy = other(color)
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p || p.color !== enemy) continue
      for (const [dr, dc] of pieceDestinations(board, r, c)) {
        if (dr === k[0] && dc === k[1]) return true
      }
    }
  return false
}

const inZone = (color, row) => (color === 'b' ? row <= 2 : row >= 6)
function canPromoteType(piece) {
  return !piece.promoted && ['P', 'L', 'N', 'S', 'B', 'R'].includes(piece.type)
}
// Must promote because the piece would otherwise have no legal move.
function mustPromote(piece, toRow) {
  const c = piece.color
  if (piece.type === 'P' || piece.type === 'L') return c === 'b' ? toRow === 0 : toRow === 8
  if (piece.type === 'N') return c === 'b' ? toRow <= 1 : toRow >= 7
  return false
}
// A drop of `type` for `color` at row is allowed w.r.t. "no dead piece" rule.
function dropRowOk(type, color, row) {
  if (type === 'P' || type === 'L') return color === 'b' ? row !== 0 : row !== 8
  if (type === 'N') return color === 'b' ? row > 1 : row < 7
  return true
}

// Apply a move object to a position, returning a NEW position.
// move = { from:{row,col}, to:{row,col}, promote?:bool } | { drop:'P', to:{row,col} }
export function applyMove(pos, move) {
  const board = cloneBoard(pos.board)
  const hand = cloneHand(pos.hand)
  const turn = pos.turn
  if (move.drop) {
    board[move.to.row][move.to.col] = { type: move.drop, color: turn, promoted: false }
    hand[turn][move.drop] = (hand[turn][move.drop] || 0) - 1
    if (hand[turn][move.drop] <= 0) delete hand[turn][move.drop]
  } else {
    const p = board[move.from.row][move.from.col]
    const cap = board[move.to.row][move.to.col]
    if (cap) hand[turn][cap.type] = (hand[turn][cap.type] || 0) + 1
    board[move.from.row][move.from.col] = null
    board[move.to.row][move.to.col] = {
      type: p.type,
      color: p.color,
      promoted: p.promoted || !!move.promote,
    }
  }
  return { board, hand, turn: other(turn), moveNo: (pos.moveNo || 1) + 1 }
}

// All legal moves for the side to move.
export function legalMoves(pos) {
  const { board, turn } = pos
  const pseudo = []

  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p || p.color !== turn) continue
      for (const [nr, nc] of pieceDestinations(board, r, c)) {
        const from = { row: r, col: c }
        const to = { row: nr, col: nc }
        if (canPromoteType(p) && (inZone(turn, r) || inZone(turn, nr))) {
          pseudo.push({ from, to, promote: true })
          if (!mustPromote(p, nr)) pseudo.push({ from, to, promote: false })
        } else {
          pseudo.push({ from, to, promote: false })
        }
      }
    }

  // drops
  for (const type of DROP_TYPES) {
    if (!pos.hand[turn][type]) continue
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        if (board[r][c]) continue
        if (!dropRowOk(type, turn, r)) continue
        if (type === 'P' && fileHasOwnPawn(board, c, turn)) continue // 二歩
        pseudo.push({ drop: type, to: { row: r, col: c } })
      }
  }

  // filter out moves that leave own king in check
  const legal = []
  for (const mv of pseudo) {
    const next = applyMove(pos, mv)
    if (!isInCheck(next.board, turn)) legal.push(mv)
  }
  return legal
}

function fileHasOwnPawn(board, col, color) {
  for (let r = 0; r < 9; r++) {
    const p = board[r][col]
    if (p && p.type === 'P' && !p.promoted && p.color === color) return true
  }
  return false
}

// Legal moves originating from a given board square (for UI highlighting).
export function movesFrom(pos, row, col) {
  return legalMoves(pos).filter((m) => m.from && m.from.row === row && m.from.col === col)
}
// Legal drop targets for a hand piece type.
export function dropTargets(pos, type) {
  return legalMoves(pos).filter((m) => m.drop === type)
}

// ---- USI conversion --------------------------------------------------------
const sqUsi = (s) => `${9 - s.col}${String.fromCharCode(97 + s.row)}`
export function usiOf(move) {
  if (move.drop) return `${move.drop}*${sqUsi(move.to)}`
  return `${sqUsi(move.from)}${sqUsi(move.to)}${move.promote ? '+' : ''}`
}

// Match a USI move string to a legal move object in `pos` (null if illegal).
export function moveFromUsi(pos, usi) {
  return legalMoves(pos).find((m) => usiOf(m) === usi) || null
}

// ---- SFEN serialization (to feed the engine the current position) ----------
export function toSfen(pos) {
  const rows = []
  for (let r = 0; r < 9; r++) {
    let s = ''
    let empty = 0
    for (let c = 0; c < 9; c++) {
      const p = pos.board[r][c]
      if (!p) {
        empty++
        continue
      }
      if (empty) {
        s += empty
        empty = 0
      }
      let ch = p.type
      ch = p.color === 'b' ? ch.toUpperCase() : ch.toLowerCase()
      s += (p.promoted ? '+' : '') + ch
    }
    if (empty) s += empty
    rows.push(s)
  }
  let hand = ''
  for (const color of ['b', 'w']) {
    for (const type of DROP_TYPES) {
      const n = pos.hand[color][type]
      if (!n) continue
      hand += (n > 1 ? n : '') + (color === 'b' ? type.toUpperCase() : type.toLowerCase())
    }
  }
  return `${rows.join('/')} ${pos.turn} ${hand || '-'} ${pos.moveNo || 1}`
}
