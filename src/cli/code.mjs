/**
 * code.mjs — aether code <task>
 * AUTO FIX MODE: silent tools, clean output, auto-retry on errors.
 */
import readline          from 'readline'
import { AetherAgent }   from '../agent/index.mjs'
import { ui, spin }      from './ui.mjs'
import { initWorkspace } from '../config/index.mjs'

export async function runCode(task, options = {}) {
  ui.banner()

  let objective = task?.trim()
  if (!objective) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    objective = await new Promise(resolve => {
      rl.question(
        '\x1b[1m\x1b[33m⚡ What should AETHER do?\x1b[0m\n\x1b[2m(e.g. "create a REST API", "fix all TypeScript errors")\x1b[0m\n\n\x1b[1m› \x1b[0m',
        ans => { rl.close(); resolve(ans.trim()) }
      )
    })
  }
  if (!objective) { ui.error('No task provided.'); process.exit(1) }

  const workingDir    = options.workingDir    ?? process.cwd()
  const maxIterations = options.maxIterations ?? 25
  const verbose       = options.verbose       ?? false

  await initWorkspace(workingDir)

  console.log(`\x1b[1m\x1b[33m⚡ Task\x1b[0m`)
  console.log(`  ${objective}\n`)
  console.log(`\x1b[2m  📁 ${workingDir}  ·  max ${maxIterations} steps\x1b[0m\n`)
  console.log('\x1b[90m' + '─'.repeat(54) + '\x1b[0m')

  let _lastTool   = null
  let _lastParams = null

  const startTime = Date.now()

  const agent = new AetherAgent({
    workingDir, maxIterations, verbose,

    onStatus(text)   { spin.update(text) },

    onIteration(i, max) {
      spin.stop()
      const bar = progressBar(i, max, 16)
      console.log(`\n\x1b[90m── ${String(i).padStart(2)}/${max}  ${bar} ──\x1b[0m`)
    },

    // Thought: silent — just update spinner with a brief hint
    onThought(thought) {
      const hint = thought.trim().split('.')[0].slice(0, 55)
      if (hint) spin.update(hint + '…')
    },

    // Action: clean status, no raw tool+params
    onAction(toolName, params) {
      _lastTool = toolName; _lastParams = params
      spin.stop()
      const cmd = String(params?.command ?? '')
      if (toolName === 'execute_command') {
        if (/npm (run )?build|tsc/.test(cmd))        { ui.buildStart(); return }
        if (/npm install|pnpm install/.test(cmd))    { spin.start('Installing dependencies…'); return }
        if (/npm (run )?test|jest|vitest/.test(cmd)) { spin.start('Running tests…'); return }
        spin.start(`Running: ${cmd.slice(0, 55)}…`)
        return
      }
      spin.start(toolStatusMsg(toolName, params))
    },

    // Observation: clean result — no raw output
    onObservation(obs) {
      spin.stop()
      const tool   = _lastTool
      const params = _lastParams
      const failed = obs.startsWith('ERROR') || obs.includes('COMMAND FAILED') || obs.startsWith('EXECUTOR ERROR')
      const cmd    = String(params?.command ?? '')

      if (tool === 'execute_command') {
        if (failed) {
          const errLine = obs.split('\n').map(l => l.trim())
            .filter(l => l && !/^(npm warn|>|\s*$)/.test(l)).find(l => l.length > 2) ?? 'Command failed'
          if (/npm (run )?build|tsc/.test(cmd)) ui.buildFail(errLine)
          else console.log(`\x1b[33m⚠\x1b[0m  \x1b[2m${errLine.slice(0, 100)}\x1b[0m`)
          console.log(`\x1b[36m↻\x1b[0m  Analyzing error… fixing automatically`)
          spin.start('Analyzing…')
        } else {
          if (/npm (run )?build|tsc/.test(cmd))        ui.buildSuccess()
          else if (/npm (run )?test|jest|vitest/.test(cmd)) console.log(`\x1b[32m✓\x1b[0m Tests passed`)
          else if (/npm install|pnpm install/.test(cmd))    console.log(`\x1b[32m✓\x1b[0m Dependencies installed`)
          else {
            const preview = obs.split('\n').filter(l => l.trim()).slice(0, 2).join(' ').slice(0, 100)
            if (preview) console.log(`\x1b[32m✓\x1b[0m \x1b[2m${preview}\x1b[0m`)
          }
        }
        return
      }

      const msg = cleanObservation(tool, params, obs)
      if (msg) console.log(msg)
    },

    onFinalAnswer(answer) { spin.stop(); ui.finalAnswer(answer) },

    onError(msg) {
      spin.stop()
      if (verbose) console.log(`\x1b[90m[debug] ${msg}\x1b[0m`)
    },
  })

  try {
    const result  = await agent.run(objective)
    spin.stop()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const mark    = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m⚠\x1b[0m'
    console.log(`${mark} \x1b[2mDone · ${result.iterations} steps · ${elapsed}s\x1b[0m\n`)
    if (!result.success) {
      console.log('\x1b[2mRun again to continue.\x1b[0m\n')
    }
    return result
  } catch (err) {
    spin.stop()
    ui.error(`Agent failed: ${err.message}`)
    const msg = (err.message ?? '').toLowerCase()
    if (msg.includes('session') || msg.includes('fetch') || msg.includes('enotfound')) {
      console.log(`\n\x1b[33mTip:\x1b[0m Sign in at \x1b[36mhttps://gemini.google.com\x1b[0m then retry.\n`)
    }
    if (verbose) console.error(err)
    process.exit(1)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toolStatusMsg(toolName, params) {
  const p = params ?? {}
  switch (toolName) {
    case 'read_file':        return `Reading ${p.path ?? 'file'}…`
    case 'write_file':       return `Writing ${p.path ?? 'file'}…`
    case 'edit_file':        return `Updating ${p.path ?? 'file'}…`
    case 'delete_file':      return `Deleting ${p.path ?? 'file'}…`
    case 'create_directory': return `Creating ${p.path ?? 'directory'}…`
    case 'list_directory':   return `Scanning ${p.path ?? '.'}…`
    case 'project_scan':     return `Scanning project…`
    case 'git_commit':       return `Committing…`
    case 'git_push':         return `Pushing…`
    default:                 return `Processing…`
  }
}

function cleanObservation(toolName, params, obs) {
  const p  = params ?? {}
  const ok = !obs.startsWith('ERROR') && !obs.includes('COMMAND FAILED') && !obs.startsWith('EXECUTOR ERROR')
  const G  = '\x1b[32m✓\x1b[0m'
  const E  = '\x1b[31m✗\x1b[0m'
  switch (toolName) {
    case 'write_file':       return ok ? `${G} Created:  \x1b[2m${p.path}\x1b[0m` : `${E} Failed: ${p.path}`
    case 'edit_file':
    case 'append_file':      return ok ? `${G} Updated:  \x1b[2m${p.path}\x1b[0m` : `${E} Failed: ${p.path}`
    case 'delete_file':      return ok ? `${G} Deleted:  \x1b[2m${p.path}\x1b[0m` : `${E} Delete failed`
    case 'create_directory': return ok ? `${G} Folder:   \x1b[2m${p.path}\x1b[0m` : `${E} Folder failed`
    case 'git_commit':       return ok ? `${G} Committed` : `${E} Commit failed`
    case 'git_push':         return ok ? `${G} Pushed`    : `${E} Push failed`
    case 'start_server': {
      if (!ok) return `${E} Server failed`
      const url = obs.match(/https?:\/\/localhost:\d+[^\s]*/i)?.[0]
      return url ? `${G} Server → \x1b[36m${url}\x1b[0m` : `${G} Server started`
    }
    case 'read_file': case 'list_directory': case 'search_files':
    case 'project_scan': case 'memory_read': case 'memory_write':
      return null
    default:
      return ok ? null : `${E} Error in ${toolName}`
  }
}

function progressBar(current, total, width) {
  const filled = Math.round(Math.min(current / total, 1) * width)
  return '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(width - filled) + '\x1b[0m'
}
