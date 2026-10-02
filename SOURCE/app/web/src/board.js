// SVG shogi board renderer + move-arrow overlay.
import { PIECE_KANJI, PROMOTED_KANJI, parseUsi, handList } from './shogi.js'

const CELL = 44
const PAD_T = 22 // room for file numbers along the top
const PAD_R = 22 // room for rank kanji down the right
const PAD_L = 6
const PAD_B = 6
const BOARD = CELL * 9
const W = PAD_L + BOARD + PAD_R
const H = PAD_T + BOARD + PAD_B

const FILE_TOP = ['9', '8', '7', '6', '5', '4', '3', '2', '1'] // left -> right
const RANK_SIDE = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function center(row, col) {
  return { x: PAD_L + col * CELL + CELL / 2, y: PAD_T + row * CELL + CELL / 2 }
}

function pieceGlyph(p) {
  return p.promoted ? PROMOTED_KANJI[p.type] || PIECE_KANJI[p.type] : PIECE_KANJI[p.type]
}

// Build an arrow (or drop marker) for one candidate move.
function moveMarker(move, color, label) {
  const mv = parseUsi(move)
  if (!mv) return ''
  const to = center(mv.to.row, mv.to.col)
  let out = ''

  if (mv.from) {
    const from = center(mv.from.row, mv.from.col)
    // shorten the segment so the head sits on the square, not over the glyph
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const sx = from.x + ux * (CELL * 0.32)
    const sy = from.y + uy * (CELL * 0.32)
    const ex = to.x - ux * (CELL * 0.3)
    const ey = to.y - uy * (CELL * 0.3)
    // arrowhead
    const ah = 9
    const perp = { x: -uy, y: ux }
    const p1 = `${ex},${ey}`
    const p2 = `${ex - ux * ah + perp.x * ah * 0.7},${ey - uy * ah + perp.y * ah * 0.7}`
    const p3 = `${ex - ux * ah - perp.x * ah * 0.7},${ey - uy * ah - perp.y * ah * 0.7}`
    out += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="0.9"/>`
    out += `<polygon points="${p1} ${p2} ${p3}" fill="${color}"/>`
    // origin ring
    out += `<circle cx="${from.x}" cy="${from.y}" r="${CELL * 0.34}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.55"/>`
  } else {
    // drop: highlight the destination square
    out += `<rect x="${PAD_L + mv.to.col * CELL + 2}" y="${PAD_T + mv.to.row * CELL + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="4" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="2.5"/>`
  }
  // destination square emphasis + label badge
  out += `<rect x="${PAD_L + mv.to.col * CELL + 1.5}" y="${PAD_T + mv.to.row * CELL + 1.5}" width="${CELL - 3}" height="${CELL - 3}" rx="4" fill="none" stroke="${color}" stroke-width="2.5"/>`
  if (label) {
    const bx = PAD_L + mv.to.col * CELL + CELL - 7
    const by = PAD_T + mv.to.row * CELL + 8
    out += `<circle cx="${bx}" cy="${by}" r="8" fill="${color}"/>`
    out += `<text x="${bx}" y="${by}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="#fff">${esc(label)}</text>`
  }
  return out
}

// Render the 9x9 board as an inline SVG string.
// moves: [{ usi, color, label }] drawn on top.
export function boardSVG(position, { moves = [] } = {}) {
  const parts = []
  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="board-svg" role="img" aria-label="将棋盤">`,
  )
  // board wood
  parts.push(
    `<rect x="${PAD_L}" y="${PAD_T}" width="${BOARD}" height="${BOARD}" fill="var(--board, #f4d9a0)" stroke="#7a5a2e" stroke-width="2"/>`,
  )
  // grid lines
  for (let i = 1; i < 9; i++) {
    const gx = PAD_L + i * CELL
    const gy = PAD_T + i * CELL
    parts.push(`<line x1="${gx}" y1="${PAD_T}" x2="${gx}" y2="${PAD_T + BOARD}" stroke="#7a5a2e" stroke-width="1"/>`)
    parts.push(`<line x1="${PAD_L}" y1="${gy}" x2="${PAD_L + BOARD}" y2="${gy}" stroke="#7a5a2e" stroke-width="1"/>`)
  }
  // star points (3rd/6th intersections)
  for (const cxN of [3, 6]) {
    for (const cyN of [3, 6]) {
      parts.push(`<circle cx="${PAD_L + cxN * CELL}" cy="${PAD_T + cyN * CELL}" r="3" fill="#7a5a2e"/>`)
    }
  }
  // coordinates
  for (let c = 0; c < 9; c++) {
    parts.push(
      `<text x="${PAD_L + c * CELL + CELL / 2}" y="${PAD_T - 8}" text-anchor="middle" font-size="12" fill="#8a7f6a">${FILE_TOP[c]}</text>`,
    )
  }
  for (let r = 0; r < 9; r++) {
    parts.push(
      `<text x="${PAD_L + BOARD + 11}" y="${PAD_T + r * CELL + CELL / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="#8a7f6a">${RANK_SIDE[r]}</text>`,
    )
  }
  // pieces
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = position.board[r][c]
      if (!p) continue
      const { x, y } = center(r, c)
      const glyph = pieceGlyph(p)
      const fill = p.promoted ? '#b23b3b' : '#2b2b2b'
      const rot = p.color === 'w' ? ` transform="rotate(180 ${x} ${y})"` : ''
      parts.push(
        `<text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="600" fill="${fill}"${rot}>${esc(glyph)}</text>`,
      )
    }
  }
  // move overlays
  for (const m of moves) parts.push(moveMarker(m.usi, m.color, m.label))

  parts.push('</svg>')
  return parts.join('')
}

// Hand (captured pieces) row as HTML.
// opts.interactive adds data-drop/data-color for click handling; opts.selectedDrop
// marks the chosen piece; opts.turn (only that color's pieces are clickable).
export function handHTML(position, color, opts = {}) {
  const list = handList(position.hand, color)
  const label = color === 'b' ? '先手' : '後手'
  const chips = list
    .map((h) => {
      const sel = opts.interactive && opts.selectedDrop === h.type && opts.turn === color ? ' selected' : ''
      const clickable = opts.interactive && opts.turn === color ? ' clickable' : ''
      const attrs = opts.interactive ? ` data-drop="${h.type}" data-color="${color}"` : ''
      return `<span class="hand-piece${sel}${clickable}"${attrs}>${PIECE_KANJI[h.type]}${h.count > 1 ? `<b>${h.count}</b>` : ''}</span>`
    })
    .join('')
  return `<span class="hand-label">${label}</span>${chips || '<span class="hand-empty">なし</span>'}`
}

// Interactive board: clickable cells, legal-move dots, selection + last-move
// highlight. Options: { selected:{row,col}, targets:[{row,col}], lastMove:{from,to} }
export function interactiveBoardSVG(position, { selected = null, targets = [], lastMove = null } = {}) {
  const parts = []
  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="board-svg" role="img" aria-label="将棋盤">`,
  )
  parts.push(
    `<rect x="${PAD_L}" y="${PAD_T}" width="${BOARD}" height="${BOARD}" fill="var(--board, #f4d9a0)" stroke="#7a5a2e" stroke-width="2"/>`,
  )
  // last-move tint (under pieces)
  for (const sq of [lastMove && lastMove.from, lastMove && lastMove.to]) {
    if (!sq) continue
    parts.push(
      `<rect x="${PAD_L + sq.col * CELL}" y="${PAD_T + sq.row * CELL}" width="${CELL}" height="${CELL}" fill="#f6e27a" opacity="0.55"/>`,
    )
  }
  // grid + stars
  for (let i = 1; i < 9; i++) {
    const gx = PAD_L + i * CELL
    const gy = PAD_T + i * CELL
    parts.push(`<line x1="${gx}" y1="${PAD_T}" x2="${gx}" y2="${PAD_T + BOARD}" stroke="#7a5a2e" stroke-width="1"/>`)
    parts.push(`<line x1="${PAD_L}" y1="${gy}" x2="${PAD_L + BOARD}" y2="${gy}" stroke="#7a5a2e" stroke-width="1"/>`)
  }
  for (const a of [3, 6]) for (const b of [3, 6]) parts.push(`<circle cx="${PAD_L + a * CELL}" cy="${PAD_T + b * CELL}" r="3" fill="#7a5a2e"/>`)
  // coordinates
  for (let c = 0; c < 9; c++) parts.push(`<text x="${PAD_L + c * CELL + CELL / 2}" y="${PAD_T - 8}" text-anchor="middle" font-size="12" fill="#8a7f6a">${FILE_TOP[c]}</text>`)
  for (let r = 0; r < 9; r++) parts.push(`<text x="${PAD_L + BOARD + 11}" y="${PAD_T + r * CELL + CELL / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="#8a7f6a">${RANK_SIDE[r]}</text>`)
  // pieces
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = position.board[r][c]
      if (!p) continue
      const { x, y } = center(r, c)
      const fill = p.promoted ? '#b23b3b' : '#2b2b2b'
      const rot = p.color === 'w' ? ` transform="rotate(180 ${x} ${y})"` : ''
      parts.push(`<text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="600" fill="${fill}"${rot}>${esc(pieceGlyph(p))}</text>`)
    }
  // selection outline
  if (selected) {
    parts.push(
      `<rect x="${PAD_L + selected.col * CELL + 1.5}" y="${PAD_T + selected.row * CELL + 1.5}" width="${CELL - 3}" height="${CELL - 3}" rx="4" fill="#3fa7ff" opacity="0.22" stroke="#2f74c0" stroke-width="2.5"/>`,
    )
  }
  // legal-move markers
  for (const t of targets) {
    const cx = PAD_L + t.col * CELL + CELL / 2
    const cy = PAD_T + t.row * CELL + CELL / 2
    if (position.board[t.row][t.col]) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="none" stroke="#2fa35a" stroke-width="3" opacity="0.85"/>`)
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="#2fa35a" opacity="0.7"/>`)
    }
  }
  // clickable transparent cells (topmost)
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      parts.push(`<rect class="cell" data-r="${r}" data-c="${c}" x="${PAD_L + c * CELL}" y="${PAD_T + r * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>`)
    }
  parts.push('</svg>')
  return parts.join('')
}
