// Assemble a clean web bundle in www/ for packaging (Capacitor).
// Copies ONLY the files the running app needs — not node_modules, the original
// good/bad/資料 folders, tooling, or the android/ project.
//
//   node tools/build-web.mjs
import { rmSync, mkdirSync, cpSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'www')

// Wipe and recreate www/ so removed source files don't linger in the bundle.
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// Pass --no-wasm-engine for Android builds: the WASM engine can't run inside a
// WebView (no SharedArrayBuffer there — we use the native engine instead), so
// shipping its 60MB would only bloat the APK.
const skipWasmEngine = process.argv.includes('--no-wasm-engine')
const genericBuild = process.argv.includes('--generic')

// Single files (copied if present).
const FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'questions.json',
  'vendor/ts-fsrs.mjs',
  'vendor/capacitor-core.mjs',
]
// Whole directories.
const DIRS = ['styles', 'src']
if (!genericBuild) DIRS.push('assets')
if (!skipWasmEngine) DIRS.push('vendor/engine')

for (const rel of FILES) {
  if (genericBuild && rel === 'questions.json') continue
  const src = join(ROOT, rel)
  if (!existsSync(src)) continue
  const dest = join(OUT, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

for (const rel of DIRS) {
  const src = join(ROOT, rel)
  if (!existsSync(src)) continue
  cpSync(src, join(OUT, rel), { recursive: true })
}

if (genericBuild) {
  const indexPath = join(OUT, 'index.html')
  let html = readFileSync(indexPath, 'utf8')
  html = html
    .replace('スピキ将棋 — 二択でおぼえる将棋', '将棋トレーナー — 二択でおぼえる将棋')
    .replaceAll('♟ スピキ将棋', '♟ 将棋トレーナー')
    .replaceAll('alt="スピキ"', 'alt=""')
    .replace('assets/img/speaki.jpg', '')
    .replace('<body>', '<body class="generic-build">')
  writeFileSync(indexPath, html)

  const swPath = join(OUT, 'sw.js')
  if (existsSync(swPath)) {
    const sw = readFileSync(swPath, 'utf8').replace("speaki-shogi-v13", "shogi-trainer-general-v1")
    writeFileSync(swPath, sw)
  }

  const manifestPath = join(OUT, 'manifest.webmanifest')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.name = '将棋トレーナー — 二択でおぼえる将棋'
  manifest.short_name = '将棋トレーナー'
  manifest.description = '二択問題で将棋を学ぶトレーニングアプリ。'
  delete manifest.icons
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  // The general build intentionally has no character portrait or bundled voice clips.
  writeFileSync(
    join(OUT, 'src', 'assets-manifest.js'),
    'export const PORTRAIT = ""\nexport const GOOD_SOUNDS = []\nexport const BAD_SOUNDS = []\n',
  )
  const licensesDir = join(OUT, 'licenses')
  mkdirSync(licensesDir, { recursive: true })
  copyFileSync(join(ROOT, 'engine-src', 'Copying.txt'), join(licensesDir, 'GPL-3.0.txt'))
  const licenseNotice = '<p class="fineprint">解析エンジンと評価データはGPLv3です。再配布時は対応するソースコードも提供してください。<a href="licenses/GPL-3.0.txt" target="_blank" rel="noopener">GPLv3ライセンス</a></p>'
  const noticeAnchor = '<p class="fineprint">記録はこの端末のブラウザに保存されます。</p>'
  html = readFileSync(indexPath, 'utf8').replace(noticeAnchor, `${noticeAnchor}\n          ${licenseNotice}`)
  writeFileSync(indexPath, html)
  const cssPath = join(OUT, 'styles', 'app.css')
  writeFileSync(
    cssPath,
    `${readFileSync(cssPath, 'utf8')}\n.generic-build .portrait-wrap, .generic-build .mini-portrait { display: none !important; }\n`,
  )
}

console.log(
  `web bundle → www/ (index.html, styles/, src/${genericBuild ? ', no character art or voice clips' : ', assets/'}${skipWasmEngine ? '' : ', vendor/engine (wasm)'})`,
)
