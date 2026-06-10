import { homedir } from 'os'

const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'

export const clr = {
  red    : s => `\x1b[31m${s}${R}`,
  green  : s => `\x1b[32m${s}${R}`,
  yellow : s => `\x1b[33m${s}${R}`,
  cyan   : s => `\x1b[36m${s}${R}`,
  gray   : s => `\x1b[90m${s}${R}`,
  bold   : s => `${B}${s}${R}`,
  dim    : s => `${D}${s}${R}`,
}

// ─── Spinner — Braille restored, renderer fixed for Termux ───────────────────
//
// FIX: replaced  `\r` + trailing spaces
//      with      `\r\x1b[K`  (carriage return + ANSI erase-to-EOL)
//
// This ensures the previous status line is fully cleared before writing the
// next one, which prevents «»  / garbage characters on Termux and any
// terminal that doesn't pad correctly with just spaces.
//
class Spinner {
  constructor() {
    this.frames   = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
    this.idx      = 0
    this.text     = ''
    this.timer    = null
    this.spinning = false
  }

  start(text = '') {
    this.text     = text
    this.spinning = true
    if (this.timer) clearInterval(this.timer)

    // Write once immediately so there's no blank gap before the interval fires
    this._write()

    this.timer = setInterval(() => {
      this.idx = (this.idx + 1) % this.frames.length
      this._write()
    }, 80)
    return this
  }

  _write() {
    const frame = `\x1b[36m${this.frames[this.idx]}\x1b[0m`
    // \r  — go to column 0
    // \x1b[K — erase from cursor to end of line  (Termux-safe)
    process.stdout.write(`\r\x1b[K${frame} \x1b[2m${this.text}\x1b[0m`)
  }

  /** Update text without restarting the interval */
  update(text) {
    this.text = text
    return this
  }

  /** update() alias used by edit-mode callers */
  set(text) {
    if (this.spinning) {
      this.text = text
    } else {
      this.start(text)
    }
    return this
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    process.stdout.write('\r\x1b[K')   // erase the spinner line completely
    this.spinning = false
    return this
  }

  succeed(text) { this.stop(); if (text) console.log(`\x1b[32m✓\x1b[0m ${text}`); return this }
  fail(text)    { this.stop(); if (text) console.log(`\x1b[31m✗\x1b[0m ${text}`); return this }
}

export const spin = new Spinner()

// ─── Smart status — emoji based on tool + command ─────────────────────────────
export function smartStatus(toolName, params) {
  const p   = params ?? {}
  const cmd = String(p.command ?? '').toLowerCase()

  if (toolName === 'execute_command') {
    if (/npm install|pnpm install|yarn install|bun install|pip install|pip3/.test(cmd))
      return '📦 Installing Dependencies...'
    if (/npm run build|pnpm build|yarn build|vite build|tsc |next build|bun run build|react-scripts build/.test(cmd))
      return '🏗️ Building Project...'
    if (/npm run dev|pnpm dev|yarn dev|vite$|next dev|bun dev|nodemon|ts-node-dev/.test(cmd))
      return '🚀 Starting Development Server...'
    if (/npm (run )?start|node server|node index|bun start|python.*app\.py|flask|uvicorn/.test(cmd))
      return '🚀 Starting Server...'
    if (/npm run test|jest |vitest|mocha |pytest|bun test/.test(cmd))
      return '🧪 Running Tests...'
    if (/npm run lint|eslint|prettier|tsc --noEmit/.test(cmd))
      return '🔍 Linting & Type Checking...'
    if (/git clone/.test(cmd))   return '📥 Cloning Repository...'
    if (/git commit/.test(cmd))  return '💾 Committing Changes...'
    if (/git push/.test(cmd))    return '📤 Pushing to Remote...'
    if (/git pull/.test(cmd))    return '📥 Pulling Changes...'
    if (/docker/.test(cmd))      return '🐳 Running Docker...'
    if (/prisma|sequelize|migrate/.test(cmd)) return '🗃️ Running Migration...'
    if (/curl|wget/.test(cmd))   return '🌐 Fetching Data...'
    const short = cmd.replace(/^(npm run |pnpm |yarn |bun )/, '').slice(0, 35)
    return `⚙️ Running: ${short}...`
  }

  switch (toolName) {
    case 'read_file':        return `📖 Reading ${p.path ?? 'file'}...`
    case 'write_file':       return `📝 Writing ${p.path ?? 'file'}...`
    case 'edit_file':        return `✏️ Updating ${p.path ?? 'file'}...`
    case 'append_file':      return `✏️ Updating ${p.path ?? 'file'}...`
    case 'delete_file':      return `🗑️ Deleting ${p.path ?? 'file'}...`
    case 'delete_directory': return `🗑️ Removing ${p.path ?? 'directory'}...`
    case 'create_directory': return `📁 Creating ${p.path ?? 'directory'}...`
    case 'list_directory':   return `📂 Scanning ${p.path ?? '.'}...`
    case 'search_files':     return `🔍 Searching Files...`
    case 'project_scan':     return `🔍 Analyzing Project...`
    case 'memory_read':      return `🧠 Reading Memory...`
    case 'memory_write':     return `🧠 Saving to Memory...`
    case 'git_status':       return `📊 Checking Status...`
    case 'git_add':          return `📋 Staging Changes...`
    case 'git_commit':       return `💾 Committing...`
    case 'git_push':         return `📤 Pushing...`
    case 'git_pull':         return `📥 Pulling...`
    case 'git_clone':        return `📥 Cloning Repository...`
    case 'start_server':     return `🚀 Starting Server...`
    case 'stop_server':      return `⏹️ Stopping Server...`
    case 'server_status':    return `🔍 Checking Server...`
    case 'move_file':        return `📁 Moving ${p.source ?? 'file'}...`
    case 'rename_file':      return `✏️ Renaming ${p.path ?? 'file'}...`
    case 'copy_file':        return `📋 Copying ${p.source ?? 'file'}...`
    default:                 return `⚙️ Processing...`
  }
}

export function thoughtToStatus(thought) {
  const t = (thought ?? '').toLowerCase()
  if (/fix|repair|bug|error|issue|broken/.test(t))   return '🔧 Fixing Issues...'
  if (/creat|build|generat|scaffold|setup/.test(t))  return '🏗️ Building...'
  if (/install|package|depend|module/.test(t))       return '📦 Installing...'
  if (/test|verif|check|validat/.test(t))            return '🧪 Testing...'
  if (/search|find|look|scan|analyz|read/.test(t))   return '🔍 Analyzing...'
  if (/deploy|publish|push|upload|release/.test(t))  return '🚀 Deploying...'
  if (/write|save|updat|edit|modif/.test(t))         return '📝 Writing Files...'
  if (/understand|plan|think|decide|figur/.test(t))  return '🤔 Understanding Request...'
  return '⚙️ Processing...'
}

// ─── UI object ────────────────────────────────────────────────────────────────
export const ui = {

  banner() {
    console.log(`
\x1b[38;5;39m  ╔══════════════════════════════════════════════════════╗\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[1m\x1b[38;5;51m ▲  A E T H E R\x1b[0m   \x1b[38;5;245mv2.0\x1b[0m                            \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[38;5;245m AI Development Partner · Powered by Gemini\x1b[0m       \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ╚══════════════════════════════════════════════════════╝\x1b[0m
`)
  },

  workspaceInfo(workingDir, projectScan) {
    const home    = homedir()
    const display = workingDir.startsWith(home) ? '~' + workingDir.slice(home.length) : workingDir
    let   proj    = null
    if (projectScan) {
      const fw  = projectScan.match(/⚡ Framework\s+:\s+(.+)/)?.[1]?.trim()
      const typ = projectScan.match(/🔤 Language\s+:\s+(.+)/)?.[1]?.trim()
      const nm  = projectScan.match(/🏷 Project\s+:\s+(.+)/)?.[1]?.trim()
      const parts = [fw, !fw && typ].filter(Boolean)
      if (nm && nm !== '(unnamed)') proj = `${nm}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
      else if (parts.length)        proj = parts.join(' · ')
    }
    console.log(`  \x1b[38;5;245mWorkspace\x1b[0m  \x1b[1m${display}\x1b[0m`)
    if (proj) console.log(`  \x1b[38;5;245mProject  \x1b[0m  \x1b[36m${proj}\x1b[0m`)
    console.log()
  },

  help() {
    console.log(`\x1b[1mUsage:\x1b[0m
  \x1b[36maether\x1b[0m               Interactive AI mode
  \x1b[36maether\x1b[0m \x1b[2m[task]\x1b[0m          Run task directly
  \x1b[36maether run\x1b[0m \x1b[2m[cmd]\x1b[0m       Run command + auto error recovery
  \x1b[36maether doctor\x1b[0m        Diagnostics

\x1b[1mCommands:\x1b[0m  \x1b[36m/help\x1b[0m  \x1b[36m/scan\x1b[0m  \x1b[36m/memory\x1b[0m  \x1b[36m/serve\x1b[0m  \x1b[36m/history\x1b[0m  \x1b[36m/clear\x1b[0m  \x1b[36m/exit\x1b[0m
`)
  },

  // ── Status (delegates to spinner) ─────────────────────────────────────────
  status(text)  { spin.set(text) },
  stopSpin()    { spin.stop() },

  // ── Permanent output lines ─────────────────────────────────────────────────
  log(text)     { spin.stop(); console.log(text) },
  success(text) { spin.stop(); console.log(`\x1b[32m✓\x1b[0m ${text}`) },
  error(text)   { spin.stop(); console.log(`\x1b[31m✗\x1b[0m \x1b[31m${text}\x1b[0m`) },
  warn(text)    { spin.stop(); console.log(`\x1b[33m⚠️\x1b[0m  ${text}`) },
  info(text)    { spin.stop(); console.log(`\x1b[36mℹ\x1b[0m  ${text}`) },

  section(title) {
    console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`)
    console.log('\x1b[90m' + '─'.repeat(Math.min(title.length + 2, 50)) + '\x1b[0m')
  },

  // ── Command lifecycle ──────────────────────────────────────────────────────
  cmdStart(label)          { spin.set(label) },
  cmdSuccess(label)        { spin.stop(); console.log(`\x1b[32m✓\x1b[0m ${label}`) },
  cmdFail(label, reason)   {
    spin.stop()
    console.log(`\x1b[31m✗\x1b[0m ${label}`)
    if (reason) console.log(`\n  \x1b[1mReason:\x1b[0m\n  ${extractErrorReason(reason)}\n`)
  },

  // ── Build ──────────────────────────────────────────────────────────────────
  buildStart()             { spin.set('🏗️ Building Project...') },
  buildSuccess()           { spin.stop(); console.log(`\x1b[32m✓\x1b[0m Build Successful`) },
  buildFail(r)             {
    spin.stop()
    console.log(`\x1b[31m✗\x1b[0m Build Failed`)
    if (r) console.log(`\n  \x1b[1mReason:\x1b[0m\n  ${extractErrorReason(r)}\n`)
  },
  buildNoOutput()          { spin.stop(); console.log(`\x1b[33m⚠️\x1b[0m  Build finished but no deployable output found`) },

  // ── Server ─────────────────────────────────────────────────────────────────
  serverStart()            { spin.set('🚀 Starting Server...') },
  serverReady(local, net)  {
    spin.stop()
    console.log(`\x1b[32m✓\x1b[0m Development Server Ready`)
    if (local) console.log(`   🌐 \x1b[1m\x1b[36m${local}\x1b[0m`)
    if (net)   console.log(`   📱 \x1b[36m${net}\x1b[0m`)
    console.log()
  },
  serverNotAccessible(url) {
    spin.stop()
    console.log(`\x1b[33m⚠️\x1b[0m  Server process running but application is not accessible`)
    if (url) console.log(`   Tried: ${url}`)
    console.log()
  },
  serverFail(reason)       {
    spin.stop()
    console.log(`\x1b[31m✗\x1b[0m Application Failed To Start`)
    if (reason) console.log(`\n  \x1b[1mReason:\x1b[0m\n  ${extractErrorReason(reason)}\n`)
  },

  // ── Tests ──────────────────────────────────────────────────────────────────
  testPass(s)   { spin.stop(); console.log(`\x1b[32m✓\x1b[0m Tests Passed${s ? ` — ${s}` : ''}`) },
  testFail(r)   {
    spin.stop()
    console.log(`\x1b[31m✗\x1b[0m Tests Failed`)
    if (r) console.log(`\n  \x1b[1mReason:\x1b[0m\n  ${extractErrorReason(r)}\n`)
  },

  // ── Project gen ────────────────────────────────────────────────────────────
  projectGenDone(n, dir)   {
    spin.stop()
    console.log()
    console.log(`\x1b[32m✓\x1b[0m \x1b[1m${n} file${n !== 1 ? 's' : ''} created\x1b[0m`)
    if (dir) console.log(`\x1b[32m✓\x1b[0m Project ready at \x1b[36m${dir}\x1b[0m`)
    console.log()
  },

  // ── Final answer ───────────────────────────────────────────────────────────
  finalAnswer(text)        {
    spin.stop()
    console.log(`\n\x1b[32m✅ Task Complete\x1b[0m\n`)
    const clean = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]{30,}`/g, '').trim()
    if (clean) console.log(clean)
    console.log()
  },

  // ── Confirm ────────────────────────────────────────────────────────────────
  confirmBox(lines)        {
    spin.stop()
    console.log()
    console.log('\x1b[33m⚠️  Confirmation required:\x1b[0m')
    lines.forEach(l => console.log(`   ${l}`))
    console.log()
  },

  // ── Chat ───────────────────────────────────────────────────────────────────
  chatReply(text)          {
    spin.stop()
    console.log(`\n\x1b[1m\x1b[32mAETHER\x1b[0m\x1b[90m ›\x1b[0m\n${text}\n`)
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractErrorReason(raw) {
  return String(raw ?? '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(npm warn|npm notice|>|\s*at )/.test(l) && !/^node:/.test(l))
    .find(l => /error|failed|cannot|not found|undefined|invalid|missing/i.test(l))
    ?? String(raw ?? '').split('\n').find(l => l.trim().length > 5)?.trim()
    ?? String(raw ?? '').slice(0, 120)
}

export default ui
