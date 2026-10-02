// Convert the generator's puzzle text file into questions.json.
//
// Input  : problems/*.txt  (blocks separated by blank lines)
//            sfen <board turn hand move>
//            選択肢：<usi1>, <usi2>
//            正解：<usi>
// Output : questions.json  (array of { sfen, correct, wrong })
//
//   node tools/convert-problems.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'problems')

if (!existsSync(DIR)) {
  console.log('no problems/ folder — skipping (keeping existing questions.json)')
  process.exit(0)
}

const txts = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.txt'))
if (!txts.length) {
  console.log('no .txt in problems/ — skipping')
  process.exit(0)
}

const items = []
const seen = new Set()
let blocks = 0
let skipped = 0
let dupes = 0

for (const file of txts) {
  const text = readFileSync(join(DIR, file), 'utf8')
  // Split into blocks on blank lines; tolerate CRLF.
  const rawBlocks = text.split(/\r?\n\s*\r?\n/)
  for (const block of rawBlocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    blocks++
    let sfen = null
    let choices = null
    let correct = null
    for (const line of lines) {
      if (line.startsWith('sfen ')) {
        sfen = line.slice(5).trim() // drop the "sfen " prefix
      } else if (line.startsWith('選択肢')) {
        choices = line
          .replace(/^選択肢[：:]\s*/, '')
          .split(/[,、]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
      } else if (line.startsWith('正解')) {
        correct = line.replace(/^正解[：:]\s*/, '').trim()
      }
    }
    if (!sfen || !choices || choices.length < 2 || !correct) {
      skipped++
      continue
    }
    const wrong = choices.find((c) => c !== correct)
    if (!wrong) {
      skipped++
      continue
    }
    // Drop exact duplicate positions (same sfen + same pair of moves).
    const key = `${sfen}|${correct}|${wrong}`
    if (seen.has(key)) {
      dupes++
      continue
    }
    seen.add(key)
    items.push({ sfen, correct, wrong })
  }
}

writeFileSync(join(ROOT, 'questions.json'), JSON.stringify(items))
console.log(
  `converted ${items.length} puzzles → questions.json (blocks=${blocks}, duplicates=${dupes}, malformed=${skipped})`,
)
