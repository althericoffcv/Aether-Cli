/**
 * interactive.mjs — Unified AETHER interactive mode
 * EDIT MODE: single status line, smart emoji, auto-fix, clean output.
 */
import readline             from 'readline'
import { AetherAgent }      from '../agent/index.mjs'
import { ui, spin, smartStatus, thoughtToStatus } from './ui.mjs'
import { scanProject }      from '../scanner/index.mjs'
import { initWorkspace, getWorkspaceFiles } from '../config/index.mjs'
import { askGemini }        from '../providers/gemini.mjs'
import { homedir }          from 'os'
import { existsSync }       from 'fs'
import { readFile }         from 'fs/promises'
import { join }             from 'path'

const TASK_EN   = /^\s*(create|make|build|write|fix|add|remove|delete|update|refactor|implement|generate|install|setup|init|configure|rename|move|copy|migrate|start|run|deploy|test|scaffold|debug|optimize|convert|fetch)\b/i
const TASK_ID   = /^\s*(buat|bikin|tulis|perbaiki|tambah|hapus|ubah|jalankan|mulai|pasang|konfigurasi|atur|pindah|salin|deploy|debug)\b/i
const PROJ_GEN  = /\b(website|landing.?page|web.?app|app|aplikasi|project|proyek|bot|dashboard|api|backend|frontend|portfolio|blog|toko|ecommerce|todo.?app|chat.?app|crud)\b/i
const DESTRUCTIVE = new Set(['delete_file','delete_directory','move_file','rename_file'])
const BUILD_CMDS  = /npm run build|pnpm build|yarn build|vite build|tsc |next build|bun run build/
const SERVER_CMDS = /npm run dev|pnpm dev|yarn dev|vite$|next dev|bun dev|npm (run )?start|node server|flask|uvicorn/
const TEST_CMDS   = /npm run test|jest |vitest|mocha |pytest|bun test/
const INSTALL_CMDS = /npm install|pnpm install|yarn install|bun install|pip install/
const BUILD_OUT_DIRS = ['dist','build','.next','out','public/build','.output','www']

function looksLikeTask(input) {
  return TASK_EN.test(input) || TASK_ID.test(input) ||
    (PROJ_GEN.test(input) && input.length > 15) ||
    /\.(js|ts|jsx|tsx|css|html|json|py|go|rs|md|yml|yaml|toml|sh|env)\b/i.test(input)
}
function looksLikeProjectGen(input) {
  return PROJ_GEN.test(input) && (TASK_EN.test(input) || TASK_ID.test(input))
}

// ─── Main entry ───────────────────────────────────────────────────────────────
export async function runInteractive(options = {}) {
  const { workingDir = process.cwd(), config = {}, verbose = false, directTask = null } = options

  ui.banner()
  await initWorkspace(workingDir)

  spin.set('🔍 Scanning workspace...')
  let projectScan = null
  try { projectScan = await scanProject('.', workingDir) } catch {}
  spin.stop()

  ui.workspaceInfo(workingDir, projectScan)

  // Last task hint
  try {
    const wf = getWorkspaceFiles(workingDir)
    if (existsSync(wf.session)) {
      const s = JSON.parse(await readFile(wf.session, 'utf8'))
      if (s.objective) {
        const short = String(s.objective).slice(0, 60)
        console.log(`  \x1b[38;5;245mLast task\x1b[0m  \x1b[2m"${short}${s.objective.length > 60 ? '…' : ''}"\x1b[0m`)
        console.log()
      }
    }
  } catch {}

  console.log('  \x1b[2mType a task or question.  /help for commands.\x1b[0m\n')

  const maxIterations = config.maxIterations ?? 25

  if (directTask) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('SIGINT', () => { console.log('\n'); rl.close(); process.exit(0) })
    await handleInput(directTask, workingDir, maxIterations, verbose, projectScan, rl)
    rl.close()
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n'); rl.close(); process.exit(0) })

  const ask = () => {
    rl.question('\x1b[1m\x1b[36mYou › \x1b[0m', async (raw) => {
      const input = raw.trim()
      if (!input) { ask(); return }
      if (input.startsWith('/')) await handleSlash(input, workingDir, maxIterations, verbose, projectScan, rl)
      else await handleInput(input, workingDir, maxIterations, verbose, projectScan, rl)
      ask()
    })
  }
  ask()
  return new Promise(resolve => rl.on('close', resolve))
}

// ─── Router ───────────────────────────────────────────────────────────────────
async function handleInput(input, workingDir, maxIterations, verbose, projectScan, rl) {
  if (looksLikeTask(input)) await runAgentTask(input, workingDir, maxIterations, verbose, projectScan, rl)
  else                       await runChatQuery(input, workingDir, verbose)
}

// ─── AGENT TASK — edit mode, smart status, auto-fix ──────────────────────────
async function runAgentTask(objective, workingDir, maxIterations, verbose, projectScan, rl) {
  const isGenMode = looksLikeProjectGen(objective)

  if (isGenMode) {
    const confirmed = await projectGenConfirm(objective, workingDir, rl)
    if (!confirmed) { console.log('\x1b[2m  Cancelled.\x1b[0m\n'); return }
    console.log()
  }

  // ── State tracking ─────────────────────────────────────────────────────────
  let _lastTool     = null
  let _lastParams   = null
  let _lastCmd      = ''
  let filesCreated  = 0
  let filesUpdated  = 0
  let errorDetected = false

  const startTime = Date.now()

  // Initial status
  spin.set('⏳ Understanding Request...')

  const agent = new AetherAgent({
    workingDir, maxIterations, verbose,

    onStatus(text) {
      // Only update if it's a meaningful status (not raw internal messages)
      if (text && !text.startsWith('Loading') && !text.startsWith('Scanning')) {
        spin.set(`⚙️ ${text}`)
      }
    },

    // No iteration counter — clean edit mode
    onIteration(i, max) {
      // Silent — status line already shows what's happening
    },

    // Thought: extract smart status, update line silently
    onThought(thought) {
      const status = thoughtToStatus(thought)
      spin.set(status)
    },

    // Action: smart emoji status based on tool + command
    onAction(toolName, params) {
      _lastTool   = toolName
      _lastParams = params
      _lastCmd    = String(params?.command ?? '').toLowerCase()

      const status = smartStatus(toolName, params)
      spin.set(status)
    },

    // Observation: interpret result, update status or print permanent line
    onObservation(obs) {
      const tool   = _lastTool
      const params = _lastParams
      const cmd    = _lastCmd
      const failed = obs.startsWith('ERROR') ||
                     obs.includes('COMMAND FAILED') ||
                     obs.startsWith('EXECUTOR ERROR')

      // ── execute_command ─────────────────────────────────────────────────
      if (tool === 'execute_command') {
        if (failed) {
          errorDetected = true
          // Show the failure permanently, then show that we're fixing it
          const errReason = extractFirstError(obs)
          if (BUILD_CMDS.test(cmd)) {
            ui.buildFail(errReason)
          } else if (SERVER_CMDS.test(cmd)) {
            ui.serverFail(errReason)
          } else if (TEST_CMDS.test(cmd)) {
            ui.testFail(errReason)
          } else {
            spin.stop()
            console.log(`\x1b[31m✗\x1b[0m Command Failed`)
            if (errReason) console.log(`\n  \x1b[1mReason:\x1b[0m\n  ${errReason}\n`)
          }
          // Auto-fix: show we're analyzing and continuing
          spin.set('🔧 Analyzing error...')
        } else {
          // Success
          if (BUILD_CMDS.test(cmd)) {
            // Validate build output
            const hasOutput = BUILD_OUT_DIRS.some(d => existsSync(join(workingDir, d)))
            if (hasOutput) ui.buildSuccess()
            else           ui.buildNoOutput()
          } else if (SERVER_CMDS.test(cmd)) {
            // Server started via execute_command (not start_server tool)
            const url = obs.match(/https?:\/\/localhost:\d+[^\s]*/i)?.[0]
            if (url) ui.serverReady(url, null)
            else     ui.cmdSuccess('Server started')
          } else if (TEST_CMDS.test(cmd)) {
            const summary = extractTestSummary(obs)
            ui.testPass(summary)
          } else if (INSTALL_CMDS.test(cmd)) {
            ui.cmdSuccess('Dependencies Installed')
          } else {
            // Generic — silent unless there's a brief useful line
            const preview = obs.split('\n').filter(l => l.trim() && !l.startsWith('>') && !l.startsWith('npm')).slice(0, 1).join('').slice(0, 80)
            if (preview) {
              spin.stop()
              console.log(`\x1b[32m✓\x1b[0m \x1b[2m${preview}\x1b[0m`)
            }
          }
        }
        return
      }

      // ── start_server tool ────────────────────────────────────────────────
      if (tool === 'start_server') {
        if (failed || obs.startsWith('ERROR')) {
          ui.serverFail(obs)
        } else if (obs.includes('WARNING')) {
          const url = obs.match(/URL tried: (\S+)/)?.[1] ?? obs.match(/Try manually: (\S+)/)?.[1]
          ui.serverNotAccessible(url)
        } else {
          const localUrl = obs.match(/LOCAL: (\S+)/)?.[1]
          const netUrl   = obs.match(/NETWORK: (\S+)/)?.[1]
          ui.serverReady(localUrl, netUrl)
        }
        return
      }

      // ── File operations (silent — edit mode, no per-file spam) ───────────
      if (tool === 'write_file') {
        filesCreated++
        if (isGenMode) {
          spin.set(`📝 Creating files... [${filesCreated}] ${params?.path ?? ''}`)
        } else {
          spin.set(`📝 Writing ${params?.path ?? 'file'}... (${filesCreated} created)`)
        }
        return
      }

      if (tool === 'edit_file' || tool === 'append_file') {
        filesUpdated++
        spin.set(`✏️ Updating ${params?.path ?? 'file'}...`)
        return
      }

      // ── Everything else: stay silent (update spinner) ────────────────────
      spin.set(smartStatus(tool, params).replace('...', '. Done.'))
    },

    onFinalAnswer(answer) {
      spin.stop()
      if (isGenMode) {
        const home = homedir()
        const dir  = workingDir.startsWith(home) ? '~' + workingDir.slice(home.length) : workingDir
        ui.projectGenDone(filesCreated, filesCreated > 0 ? dir : null)
        const summary = stripCode(answer).split('\n').filter(l => l.trim()).slice(0, 4).join('\n')
        if (summary.trim()) console.log(`\x1b[2m${summary}\x1b[0m\n`)
      } else {
        ui.finalAnswer(answer)
      }
    },

    onError(msg) {
      if (verbose) { spin.stop(); console.log(`\x1b[90m[debug] ${msg}\x1b[0m`) }
      // In normal mode: silent — agent handles its own errors
    },

    // Confirm destructive operations
    async onBeforeAction(toolName, params) {
      if (!DESTRUCTIVE.has(toolName)) return true
      spin.stop()
      const desc = describeDestructive(toolName, params)
      ui.confirmBox([`About to: \x1b[1m${desc}\x1b[0m`])
      return new Promise(resolve => {
        rl.question('  Proceed? [\x1b[32mY\x1b[0m/\x1b[31mn\x1b[0m] ', ans => {
          const yes = ans.trim().toLowerCase() !== 'n'
          if (!yes) console.log('\x1b[2m  Skipped.\x1b[0m')
          console.log()
          resolve(yes)
        })
      })
    },
  })

  try {
    const result  = await agent.run(objective)
    spin.stop()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (!isGenMode) {
      const mark = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m⚠️\x1b[0m'
      console.log(`${mark} \x1b[2mDone in ${elapsed}s\x1b[0m\n`)
      if (!result.success)
        console.log('\x1b[2mTip: Run again to continue where AETHER left off.\x1b[0m\n')
    }
  } catch (err) {
    spin.stop()
    ui.error(`Agent error: ${err.message}`)
    printConnectionHint(err)
  }
}

// ─── Chat mode ────────────────────────────────────────────────────────────────
let _chatAgent = null
async function runChatQuery(message, workingDir, verbose) {
  if (!_chatAgent || _chatAgent.workingDir !== workingDir)
    _chatAgent = new AetherAgent({ workingDir, verbose })
  spin.set('💭 Thinking...')
  try {
    const reply = await _chatAgent.chat(message)
    spin.stop()
    ui.chatReply(reply)
  } catch (err) {
    spin.stop()
    ui.error(`Error: ${err.message}`)
    printConnectionHint(err)
  }
}

// ─── Project gen planning ─────────────────────────────────────────────────────
async function projectGenConfirm(objective, workingDir, rl) {
  spin.set('🤔 Planning project structure...')
  let planText = null
  try {
    const p = `Project planner. User wants: "${objective}"\nList files to create (one per line):\n- path/to/file.ext : description\nMax 20 files. No explanation. Just the list.`
    planText = await askGemini(p)
  } catch { spin.stop(); return true }
  spin.stop()

  const fileLines = planText.split('\n')
    .filter(l => l.match(/^\s*[-•*]?\s*\S+\.\w+/)).slice(0, 25)

  if (!fileLines.length) return true

  console.log(`\n\x1b[1mProject Plan\x1b[0m`)
  console.log('\x1b[90m' + '─'.repeat(44) + '\x1b[0m')
  fileLines.forEach(l => console.log(`  \x1b[2m${l.trim()}\x1b[0m`))
  console.log('\x1b[90m' + '─'.repeat(44) + '\x1b[0m')
  console.log(`  \x1b[2m${fileLines.length} file(s) planned\x1b[0m\n`)

  return new Promise(resolve => {
    rl.question('  Proceed? [\x1b[32mY\x1b[0m/\x1b[31mn\x1b[0m] ', ans => {
      console.log(); resolve(ans.trim().toLowerCase() !== 'n')
    })
  })
}

// ─── Slash commands ───────────────────────────────────────────────────────────
async function handleSlash(input, workingDir, maxIterations, verbose, projectScan, rl) {
  const [cmd, ...rest] = input.slice(1).split(' ')
  const arg = rest.join(' ').trim()

  switch (cmd.toLowerCase()) {
    case 'help': case 'h':
      console.log(`\n\x1b[1mCommands:\x1b[0m\n  \x1b[36m/scan\x1b[0m      Scan project\n  \x1b[36m/memory\x1b[0m    View memory\n  \x1b[36m/history\x1b[0m   Task history\n  \x1b[36m/serve\x1b[0m     Start dev server\n  \x1b[36m/run\x1b[0m \x1b[2m<cmd>\x1b[0m  Run shell command\n  \x1b[36m/clear\x1b[0m     Clear screen\n  \x1b[36m/reset\x1b[0m     Clear chat history\n  \x1b[36m/exit\x1b[0m      Exit\n`)
      break

    case 'clear':
      console.clear(); ui.banner(); ui.workspaceInfo(workingDir, projectScan)
      break

    case 'reset':
      _chatAgent = null; console.log('\x1b[32m✓\x1b[0m Chat history cleared.\n')
      break

    case 'scan': {
      spin.set('🔍 Scanning project...')
      try { const r = await scanProject('.', workingDir); spin.stop(); console.log(`\n${r}\n`) }
      catch (err) { spin.stop(); ui.error(`Scan failed: ${err.message}`) }
      break
    }

    case 'memory': {
      const { Memory } = await import('../agent/memory/index.mjs')
      const mem  = new Memory(workingDir)
      const ctx  = await mem.getContextSummary()
      const last = await mem.getLastSession()
      console.log('\n\x1b[1mMemory\x1b[0m\n\x1b[90m' + '─'.repeat(40) + '\x1b[0m')
      console.log(ctx ?? '\x1b[2m(empty)\x1b[0m')
      if (last?.objective) {
        console.log(`\n\x1b[1mLast Session\x1b[0m\n  ${String(last.objective).slice(0, 70)}`)
        console.log(`  \x1b[2m${last.steps} steps · ${last.completedAt}\x1b[0m`)
      }
      console.log()
      break
    }

    case 'history': {
      const { getWorkspaceFiles: gwf } = await import('../config/index.mjs')
      const wf = gwf(workingDir)
      try {
        const hist = JSON.parse(await readFile(wf.history, 'utf8'))
        if (!hist.length) { console.log('\x1b[2m  No history.\x1b[0m\n'); break }
        console.log('\n\x1b[1mTask History\x1b[0m\n\x1b[90m' + '─'.repeat(50) + '\x1b[0m')
        hist.slice(-10).reverse().forEach((h, i) => {
          const ts = h.completedAt ? new Date(h.completedAt).toLocaleString() : ''
          console.log(`  \x1b[36m${i+1}.\x1b[0m ${String(h.objective).slice(0, 60)}\n     \x1b[2m${h.steps} steps · ${ts}\x1b[0m`)
        })
        console.log()
      } catch { console.log('\x1b[2m  No history.\x1b[0m\n') }
      break
    }

    case 'serve':
      await runAgentTask(arg ? `Start server: ${arg}` : 'Start the development server', workingDir, 8, verbose, projectScan, rl)
      break

    case 'run': {
      if (!arg) { ui.error('Usage: /run <command>'); break }
      console.log(`\n\x1b[2m$ ${arg}\x1b[0m\n`)
      spin.set(`⚙️ Running: ${arg.slice(0, 50)}...`)
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const { stdout, stderr } = await promisify(exec)(arg, { cwd: workingDir, timeout: 60000 })
        spin.stop()
        if (stdout) process.stdout.write(stdout)
        if (stderr) process.stderr.write('\x1b[33m' + stderr + '\x1b[0m')
        ui.success('Done.\n')
      } catch (err) {
        spin.stop()
        if (err.stdout) process.stdout.write(err.stdout)
        if (err.stderr) process.stderr.write('\x1b[31m' + err.stderr + '\x1b[0m')
        ui.error(`Failed (exit ${err.code ?? 1})`)
        const fix = await askYN('\n  Fix with AETHER? [Y/n] ', rl)
        if (fix) {
          const errOut = [err.stdout && `STDOUT:\n${err.stdout}`, err.stderr && `STDERR:\n${err.stderr}`].filter(Boolean).join('\n\n')
          await runAgentTask(`Fix the failing command: "${arg}"\n\nError:\n${errOut}`, workingDir, 12, verbose, projectScan, rl)
        }
      }
      break
    }

    case 'exit': case 'quit': case 'q':
      console.log('\n\x1b[36m  Goodbye ✨\x1b[0m\n'); rl.close(); process.exit(0)
      break

    default:
      console.log(`\x1b[2m  Unknown: /${cmd} — type /help\x1b[0m\n`)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractFirstError(obs) {
  return obs.split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(npm warn|>|\s*$|npm notice)/.test(l) && !/^\s*at /.test(l))
    .find(l => /error|failed|cannot|not found|undefined|invalid|missing|unexpected/i.test(l))
    ?? obs.split('\n').map(l => l.trim()).filter(l => l).find(l => l.length > 5)
    ?? obs.slice(0, 120)
}

function extractTestSummary(obs) {
  const m = obs.match(/(\d+ (test|spec|suite).{0,40})/i)
  return m ? m[1] : null
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]{30,}`/g, '').trim()
}

function describeDestructive(toolName, params) {
  switch (toolName) {
    case 'delete_file':      return `delete file: ${params?.path}`
    case 'delete_directory': return `delete directory: ${params?.path}`
    case 'move_file':        return `move: ${params?.source} → ${params?.destination}`
    case 'rename_file':      return `rename: ${params?.path} → ${params?.newName}`
    default:                 return toolName
  }
}

function printConnectionHint(err) {
  const msg = (err.message ?? '').toLowerCase()
  if (msg.includes('session') || msg.includes('fetch') || msg.includes('initialize') || msg.includes('enotfound')) {
    console.log(`\n\x1b[33mConnection tips:\x1b[0m\n  • Sign in at \x1b[36mhttps://gemini.google.com\x1b[0m\n  • Run \x1b[36maether doctor\x1b[0m for diagnostics\n`)
  }
}

async function askYN(question, rl) {
  return new Promise(resolve => { rl.question(question, ans => resolve(ans.trim().toLowerCase() !== 'n')) })
}
