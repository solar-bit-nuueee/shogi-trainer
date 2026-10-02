// One-command debug-APK build — no Android Studio needed.
//   npm run apk
// Steps: assemble www/ -> cap sync android -> gradlew assembleDebug.
// Finds a JDK automatically (JAVA_HOME, else the JDK bundled with Android
// Studio, else `java` on PATH).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const isWin = process.platform === 'win32'
const genericBuild = process.argv.includes('--generic')

function run(cmd, args, opts = {}) {
  // shell:false lets us run exes whose path has spaces (node.exe under
  // "Program Files"); batch files (npx.cmd / gradlew.bat) pass shell:true.
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts })
  if (r.status !== 0) {
    throw new Error(`\n✗ failed: ${cmd} ${args.join(' ')}`)
  }
}

function findJdk() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin'))) return process.env.JAVA_HOME
  const candidates = isWin
    ? [
        'C:\\Program Files\\Android\\Android Studio\\jbr',
        'C:\\Program Files\\Android\\Android Studio\\jre',
        `${process.env.LOCALAPPDATA}\\Programs\\Android Studio\\jbr`,
      ]
    : [
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        '/usr/lib/jvm/default-java',
      ]
  return candidates.find((p) => p && existsSync(p)) || null
}

// 0) regenerate questions.json from problems/ (no-op if the folder is absent)
run(process.execPath, ['tools/convert-problems.mjs'])

// 1) web bundle (without the WASM engine — the APK uses the native one)
run(process.execPath, ['tools/build-web.mjs', '--no-wasm-engine', ...(genericBuild ? ['--generic'] : [])])

// The Capacitor config is temporarily switched so the built APK gets its own
// neutral app identity, while this checkout retains its regular development identity.
const configPath = join(ROOT, 'capacitor.config.json')
const originalConfig = readFileSync(configPath, 'utf8')
try {
  if (genericBuild) {
    const config = JSON.parse(originalConfig)
    config.appId = 'jp.shogi.trainer'
    config.appName = '将棋トレーナー'
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }

  // 2) sync into the android project (npx is a batch file on Windows -> shell)
  run(isWin ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], { shell: isWin })

  // 3) assemble an installable debug-signed APK
  const jdk = findJdk()
  if (jdk) console.log(`using JAVA_HOME=${jdk}`)
  else console.log('JAVA_HOME not found — relying on `java` on PATH')

  const gradlew = isWin ? join(ROOT, 'android', 'gradlew.bat') : './gradlew'
  const task = genericBuild ? 'assembleGeneralDebug' : 'assembleStandardDebug'
  run(gradlew, [task, '--no-daemon'], {
    cwd: join(ROOT, 'android'),
    env: jdk ? { ...process.env, JAVA_HOME: jdk } : process.env,
    shell: isWin, // gradlew.bat is a batch file
  })

  const variant = genericBuild ? 'general' : 'standard'
  const apk = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', variant, 'debug', `app-${variant}-debug.apk`)
  console.log(`\n✓ APK: ${apk}`)
  if (genericBuild) {
    const dist = join(ROOT, 'dist')
    mkdirSync(dist, { recursive: true })
    const distributable = join(dist, 'shogi-trainer.apk')
    copyFileSync(apk, distributable)
    console.log(`✓ General APK: ${distributable}`)
  }
} finally {
  writeFileSync(configPath, originalConfig)
}
