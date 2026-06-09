import { homedir } from 'os'
import { relative } from 'path'

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'
const I = '\x1b[3m'

export const clr = {
  black   : s => `\x1b[30m${s}${R}`,
  red     : s => `\x1b[31m${s}${R}`,
  green   : s => `\x1b[32m${s}${R}`,
  yellow  : s => `\x1b[33m${s}${R}`,
  blue    : s => `\x1b[34m${s}${R}`,
  magenta : s => `\x1b[35m${s}${R}`,
  cyan    : s => `\x1b[36m${s}${R}`,
  white   : s => `\x1b[37m${s}${R}`,
  gray    : s => `\x1b[90m${s}${R}`,
  bold    : s => `${B}${s}${R}`,
  dim     : s => `${D}${s}${R}`,
  italic  : s => `${I}${s}${R}`,
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
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
    this.timer = setInterval(() => {
      const frame = `\x1b[36m${this.frames[this.idx]}\x1b[0m`
      process.stdout.write(`\r${frame} \x1b[2m${this.text}\x1b[0m   `)
      this.idx = (this.idx + 1) % this.frames.length
    }, 80)
    return this
  }

  update(text) { this.text = text; return this }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    process.stdout.write('\r\x1b[K')
    this.spinning = false
    return this
  }

  succeed(text) { this.stop(); process.stdout.write(`\x1b[32m✓\x1b[0m ${text || this.text}\n`); return this }
  fail(text)    { this.stop(); process.stdout.write(`\x1b[31m✗\x1b[0m ${text || this.text}\n`); return this }
}

export const spin = new Spinner()

// ─── UI object ────────────────────────────────────────────────────────────────
export const ui = {

  banner() {
    const v = '2.0.0'
    console.log(`
\x1b[38;5;39m  ╔══════════════════════════════════════════════════════╗\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[1m\x1b[38;5;51m ▲  A E T H E R\x1b[0m   \x1b[38;5;245mv${v}\x1b[0m                          \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m  \x1b[38;5;245m AI Development Partner · Powered by Gemini\x1b[0m       \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ║\x1b[0m                                                      \x1b[38;5;39m║\x1b[0m
\x1b[38;5;39m  ╚══════════════════════════════════════════════════════╝\x1b[0m
`)
  },

  workspaceInfo(workingDir, projectScan) {
    const home = homedir()
    const display = workingDir.startsWith(home)
      ? '~' + workingDir.slice(home.length)
      : workingDir

    // Extract framework/type from scan string
    let projectLine = null
    if (projectScan) {
      const fw  = projectScan.match(/⚡ Framework\s+:\s+(.+)/)?.[1]?.trim()
      const typ = projectScan.match(/🔤 Language\s+:\s+(.+)/)?.[1]?.trim()
      const nm  = projectScan.match(/🏷 Project\s+:\s+(.+)/)?.[1]?.trim()
      const parts = [fw, !fw && typ].filter(Boolean)
      if (nm && nm !== '(unnamed)') projectLine = `${nm}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
      else if (parts.length) projectLine = parts.join(' · ')
    }

    console.log(`  \x1b[38;5;245mWorkspace\x1b[0m  \x1b[1m${display}\x1b[0m`)
    if (projectLine) console.log(`  \x1b[38;5;245mProject  \x1b[0m  \x1b[36m${projectLine}\x1b[0m`)
    console.log()
  },

  help() {
    console.log(`\x1b[1mUsage:\x1b[0m
  \x1b[36maether\x1b[0m                    Start interactive AI mode
  \x1b[36maether\x1b[0m \x1b[2m[task]\x1b[0m             Run a task directly
  \x1b[36maether run\x1b[0m  \x1b[2m[command]\x1b[0m     Run command + AI error recovery
  \x1b[36maether doctor\x1b[0m             System & project diagnostics
  \x1b[36maether memory\x1b[0m             View/manage persistent memory
  \x1b[36maether update\x1b[0m             Show update instructions

\x1b[1mIn interactive mode:\x1b[0m
  \x1b[2mJust type your task or question.\x1b[0m

  \x1b[36m/help\x1b[0m                     Show this help
  \x1b[36m/scan\x1b[0m                     Scan current project
  \x1b[36m/memory\x1b[0m                   View persistent memory
  \x1b[36m/serve\x1b[0m                    Start development server
  \x1b[36m/history\x1b[0m                  Show task history
  \x1b[36m/clear\x1b[0m                    Clear screen
  \x1b[36m/exit\x1b[0m                     Exit

\x1b[1mExamples:\x1b[0m
  \x1b[2m$\x1b[0m aether "create a REST API with Express"
  \x1b[2m$\x1b[0m aether "fix all TypeScript errors"
  \x1b[2m$\x1b[0m aether "add dark mode to the app"
  \x1b[2m$\x1b[0m aether run npm test

\x1b[1mFlags:\x1b[0m
  \x1b[36m--max N\x1b[0m      Set max iterations (default: 25)
  \x1b[36m--verbose\x1b[0m    Show debug output
  \x1b[36m--version\x1b[0m    Show version
`)
  },

  // ── Status / Logging ───────────────────────────────────────────────────────
  status(text) {
    if (spin.spinning) { spin.update(text) }
    else { spin.start(text) }
  },

  thinking(text) { spin.start(text || 'Thinking…') },
  stopSpin()     { spin.stop() },

  log(text)      { console.log(text) },
  success(text)  { spin.stop(); console.log(`\x1b[32m✓\x1b[0m ${text}`) },
  error(text)    { spin.stop(); console.log(`\x1b[31m✗\x1b[0m \x1b[31m${text}\x1b[0m`) },
  warn(text)     { spin.stop(); console.log(`\x1b[33m⚠\x1b[0m \x1b[33m${text}\x1b[0m`) },
  info(text)     { spin.stop(); console.log(`\x1b[36mℹ\x1b[0m ${text}`) },

  section(title) {
    console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`)
    console.log('\x1b[90m' + '─'.repeat(Math.min(title.length + 2, 60)) + '\x1b[0m')
  },

  // ── Agent loop UI ──────────────────────────────────────────────────────────
  iterHeader(i, max) {
    spin.stop()
    console.log(`\n\x1b[90m──── Step ${i}/${max} ${'─'.repeat(Math.max(0, 40 - String(i).length - String(max).length))} \x1b[0m`)
  },

  thought(text) {
    if (!text?.trim()) return
    spin.stop()
    const wrapped = wrapText(text.trim(), 70)
    console.log(`\n\x1b[35m💭\x1b[0m \x1b[3m\x1b[90m${wrapped}\x1b[0m`)
  },

  action(toolName, params) {
    spin.stop()
    // For write_file, don't show content param (too long / shows code)
    let displayParams = params
    if (toolName === 'write_file' && params?.content) {
      displayParams = { path: params.path, bytes: String(params.content ?? '').length }
    }
    const paramStr = displayParams && Object.keys(displayParams).length
      ? ' ' + JSON.stringify(displayParams).slice(0, 120)
      : ''
    const truncated = paramStr.length >= 120 ? '…' : ''
    console.log(`\n\x1b[33m🔧\x1b[0m \x1b[1m\x1b[33m${toolName}\x1b[0m\x1b[90m${paramStr}${truncated}\x1b[0m`)
  },

  // Clean action display for project gen mode (no params)
  actionClean(toolName, detail) {
    spin.stop()
    const icon = toolName === 'write_file' ? '📄' :
                 toolName === 'execute_command' ? '⚙' : '🔧'
    console.log(`  ${icon} \x1b[2m${detail}\x1b[0m`)
  },

  observation(text) {
    if (!text?.trim()) return
    spin.stop()
    const lines  = text.split('\n')
    const shown  = lines.slice(0, 18)
    const hidden = lines.length - shown.length
    console.log('\x1b[90m│\x1b[0m')
    shown.forEach(l => console.log(`\x1b[90m│\x1b[0m \x1b[2m${l}\x1b[0m`))
    if (hidden > 0) console.log(`\x1b[90m│  … ${hidden} more lines\x1b[0m`)
    console.log('\x1b[90m│\x1b[0m')
  },

  finalAnswer(text) {
    spin.stop()
    console.log(`
\x1b[32m╔═══════════════════════════════════════════════╗\x1b[0m
\x1b[32m║  ✅  Task Complete                            ║\x1b[0m
\x1b[32m╚═══════════════════════════════════════════════╝\x1b[0m
`)
    console.log(text)
    console.log()
  },

  // ── Project generation UI ──────────────────────────────────────────────────
  projectGenHeader(taskName) {
    spin.stop()
    console.log(`\n\x1b[1m\x1b[36m⚡ Generating: ${taskName}\x1b[0m\n`)
  },

  projectGenProgress(filesCreated, currentFile) {
    spin.update(`Creating files… [${filesCreated}] ${currentFile || ''}`)
  },

  projectGenDone(filesCreated, outputDir) {
    spin.stop()
    console.log()
    console.log(`\x1b[32m✓\x1b[0m \x1b[1m${filesCreated} file${filesCreated !== 1 ? 's' : ''} created\x1b[0m`)
    if (outputDir) {
      console.log(`\x1b[32m✓\x1b[0m Project ready at \x1b[36m${outputDir}\x1b[0m`)
    }
    console.log()
  },

  // ── Confirmation prompt ────────────────────────────────────────────────────
  confirmBox(lines) {
    spin.stop()
    console.log()
    console.log('\x1b[33m┌─ Confirmation required ─────────────────────────────┐\x1b[0m')
    lines.forEach(l => console.log(`\x1b[33m│\x1b[0m  ${l}`))
    console.log('\x1b[33m└─────────────────────────────────────────────────────┘\x1b[0m')
  },

  // ── Server UI ─────────────────────────────────────────────────────────────
  serverStarted(url, command) {
    spin.stop()
    console.log(`\n\x1b[32m✓\x1b[0m Server started`)
    if (url) console.log(`\x1b[32m✓\x1b[0m URL: \x1b[1m\x1b[36m${url}\x1b[0m`)
    console.log(`\x1b[2m  Command: ${command}\x1b[0m\n`)
  },

  serverError(msg) {
    spin.stop()
    console.log(`\x1b[31m✗\x1b[0m Server failed to start: ${msg}`)
  },

  // ── Chat UI ───────────────────────────────────────────────────────────────
  chatPrompt() {
    process.stdout.write(`\n\x1b[1m\x1b[36mYou › \x1b[0m`)
  },

  chatReply(text) {
    spin.stop()
    console.log(`\n\x1b[1m\x1b[32mAETHER\x1b[0m\x1b[90m ›\x1b[0m\n${text}\n`)
  },

  chatHint(text) {
    console.log(`\x1b[2m${text}\x1b[0m`)
  },
}

function wrapText(text, width) {
  if (text.length <= width) return text
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + w).length > width) { lines.push(line.trim()); line = '' }
    line += w + ' '
  }
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n   ')
}

export default ui
