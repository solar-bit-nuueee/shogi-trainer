// Shogi core: SFEN parsing, USI move parsing, and USI -> Japanese notation.
//
// Coordinate conventions (standard SFEN/USI):
//   - A square is "<file><rank>", file 1-9, rank a-i.
//   - File 1 is the RIGHT-most column, file 9 the LEFT-most (as viewed from
//     Black/sente at the bottom).
//   - Rank a is the TOP row (White/gote's back rank), rank i the BOTTOM.
//   - SFEN board string lists ranks a..i top-to-bottom, each rank listing
//     files 9..1 left-to-right. Uppercase = Black (sente), lowercase = White
//     (gote). '+' prefixes a promoted piece, digits are runs of empty squares.
//
// Internally the board is board[row][col], row 0..8 = rank a..i, col 0..8 =
// file 9..1 (so file = 9 - col).

export const PIECE_KANJI = {
  P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉',
}
export const PROMOTED_KANJI = {
  P: 'と', L: '杏', N: '圭', S: '全', B: '馬', R: '龍',
}
const FILE_FW = ['１', '２', '３', '４', '５', '６', '７', '８', '９']
const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
// Order captured pieces are shown in hand (strongest first).
const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P']

// Parse a full SFEN ("board turn hand move") into a position object.
export function parseSfen(sfen) {
  const parts = String(sfen).trim().split(/\s+/)
  const boardStr = parts[0] || ''
  const turn = parts[1] === 'w' ? 'w' : 'b'
  const handStr = parts[2] || '-'
  const moveNo = parseInt(parts[3], 10) || 1

  const board = Array.from({ length: 9 }, () => Array(9).fill(null))
  const rows = boardStr.split('/')
  for (let r = 0; r < 9 && r < rows.length; r++) {
    let col = 0
    let promoted = false
    for (const ch of rows[r]) {
      if (ch === '+') {
        promoted = true
        continue
      }
      if (/[1-9]/.test(ch)) {
        col += Number(ch)
        continue
      }
      const color = ch === ch.toUpperCase() ? 'b' : 'w'
      const type = ch.toUpperCase()
      if (col < 9) board[r][col] = { type, color, promoted }
      promoted = false
      col++
    }
  }

  // Hand: sequence of [count?]<piece>. Uppercase = black, lowercase = white.
  const hand = { b: {}, w: {} }
  if (handStr && handStr !== '-') {
    let num = 0
    for (const ch of handStr) {
      if (/[0-9]/.test(ch)) {
        num = num * 10 + Number(ch)
        continue
      }
      const color = ch === ch.toUpperCase() ? 'b' : 'w'
      const type = ch.toUpperCase()
      hand[color][type] = (hand[color][type] || 0) + (num || 1)
      num = 0
    }
  }
  return { board, turn, hand, moveNo }
}

// "7f" -> { file:7, rank:6, row:5, col:2 }
export function parseSquare(sq) {
  const file = Number(sq[0])
  const rankIdx = sq.charCodeAt(1) - 97 // 'a' -> 0
  return { file, rank: rankIdx + 1, row: rankIdx, col: 9 - file }
}

// Parse a USI move. Returns:
//   normal: { from:{...}, to:{...}, promote:bool }
//   drop:   { drop:'P', to:{...} }
export function parseUsi(move) {
  const m = String(move).trim()
  const drop = m.match(/^([PLNSGBRplnsgbr])\*([1-9][a-i])$/)
  if (drop) return { drop: drop[1].toUpperCase(), to: parseSquare(drop[2]) }
  const mv = m.match(/^([1-9][a-i])([1-9][a-i])(\+)?$/)
  if (!mv) return null
  return { from: parseSquare(mv[1]), to: parseSquare(mv[2]), promote: !!mv[3] }
}

// Convert a USI move to Japanese notation using the position it is played in.
// e.g. "7g7f" (black to move, pawn) -> "▲７六歩".
export function usiToJp(position, move, turnOverride) {
  const parsed = parseUsi(move)
  if (!parsed) return move
  const turn = turnOverride || position.turn
  const side = turn === 'b' ? '▲' : '△'
  const dest = FILE_FW[parsed.to.file - 1] + RANK_KANJI[parsed.to.rank - 1]

  if (parsed.drop) {
    return `${side}${dest}${PIECE_KANJI[parsed.drop]}打`
  }
  const piece = position.board?.[parsed.from.row]?.[parsed.from.col]
  let name = '?'
  if (piece) {
    name = piece.promoted ? PROMOTED_KANJI[piece.type] || PIECE_KANJI[piece.type] : PIECE_KANJI[piece.type]
  }
  return `${side}${dest}${name}${parsed.promote ? '成' : ''}`
}

// Hand pieces as an ordered [{type, count}] list for display.
export function handList(hand, color) {
  const h = hand?.[color] || {}
  return HAND_ORDER.filter((t) => h[t] > 0).map((t) => ({ type: t, count: h[t] }))
}

// Stable short hash (cyrb53) -> base36, used to derive question ids.
export function shortHash(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(36)
}
