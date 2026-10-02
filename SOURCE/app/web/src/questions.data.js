// Question bank (SFEN + USI two-choice format).
//
// Each item is a board position and two candidate moves — one correct, one
// wrong — exactly matching the output of the automatic generator:
//
//   {
//     sfen:    "<board> <turn> <hand> <moveNo>",   // full SFEN
//     correct: "7g7f",   // USI move (the right answer)
//     wrong:   "2g2f",   // USI move (the decoy)
//     // optional:
//     id:      "stable-id",   // omit to auto-derive from sfen+moves
//     theme:   "序盤",         // shown as the category chip
//     comment: "…",           // explanation shown after answering
//     level:   1,             // 1..3, controls introduction order (default 1)
//   }
//
// `wrong` may also be an array of decoys; the loader uses the first.
//
// The samples below are placeholders to demo the format — replace this array
// with your generator's output (same shape) and everything else just works.
export const QUESTIONS = [
  {
    id: 'sample-open-1',
    sfen: 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
    correct: '7g7f',
    wrong: '1g1f',
    theme: '序盤',
    level: 1,
    comment: '▲７六歩は角道を開ける自然な一手。いきなりの端歩▲１六歩は方向性が定まらず、序盤の第一手としては消極的です。',
  },
  {
    id: 'sample-open-2',
    sfen: 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
    correct: '2g2f',
    wrong: '5i5h',
    theme: '序盤',
    level: 1,
    comment: '▲２六歩は飛車先を伸ばす積極的な手。序盤早々の▲５八玉のような玉上がりは、方針が決まる前で時期尚早です。',
  },
  {
    id: 'sample-open-3',
    sfen: 'lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2',
    correct: '3c3d',
    wrong: '1c1d',
    theme: '序盤',
    level: 1,
    comment: '先手が角道を開けたので、後手も△３四歩と角道を開けて対応するのが自然。端の△１四歩は後回しでよい手です。',
  },
  {
    id: 'sample-attack-1',
    sfen: 'lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 3',
    correct: '2g2f',
    wrong: '9g9f',
    theme: '序盤',
    level: 2,
    comment: '飛車先の歩▲２六歩を伸ばして攻めの形を作るのが有力。逆側の端歩▲９六歩は、この局面では優先度が低い一手です。',
  },
  {
    id: 'sample-drop-1',
    sfen: '4k4/9/9/9/9/9/9/9/4K4 b G 1',
    correct: 'G*5b',
    wrong: 'G*5h',
    theme: '持ち駒',
    level: 2,
    comment: '持ち駒の金は相手玉の前▲５二金打と打てば王手。自玉のそばの▲５八金打は、攻めにも受けにもならない手です。',
  },
]
