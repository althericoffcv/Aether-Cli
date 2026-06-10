import readline          from 'readline'
import { existsSync }    from 'fs'
import { join }          from 'path'
import { AetherAgent }   from '../agent/index.mjs'
import { ui, spin, smartStatus, thoughtToStatus } from './ui.mjs'
import { initWorkspace } from '../config/index.mjs'

const BUILD_CMDS   = /npm run build|pnpm build|yarn build|vite build|tsc |next build|bun run build/
const SERVER_CMDS  = /npm run dev|pnpm dev|yarn dev|vite$|next dev|bun dev|npm (run )?start/
const TEST_CMDS    = /npm run test|jest |vitest|mocha |pytest/
const INSTALL_CMDS = /npm install|pnpm install|yarn install|bun install/
const BUILD_DIRS   = ['dist','build','.next','out','.output']

export async function runCode(task, options = {}) {
  ui.banner()

  let objective = task?.trim()
  if (!objective) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    objective = await new Promise(resolve => {
      rl.question('\x1b[1m\x1b[33m⚡ What should AETHER do?\x1b[0m\n\x1b[2m(e.g. "create a REST API", "fix TypeScript errors")\x1b[0m\n\n\x1b[1m› \x1b[0m',
        ans => { rl.close(); resolve(ans.trim()) })
    })
  }
  if (!objective) { ui.error('No task provided.'); process.exit(1) }

  const workingDir    = options.workingDir    ?? process.cwd()
  const maxIterations = options.maxIterations ?? 25
  const verbose       = options.verbose       ?? false

  await initWorkspace(workingDir)

  console.log(`\x1b[1m\x1b[33m⚡ Task\x1b[0m\n  ${objective}\n`)
  console.log(`\x1b[2m  📁 ${workingDir}  ·  max ${maxIterations} steps\x1b[0m`)
  console.log('\x1b[90m' + '─'.repeat(54) + '\x1b[0m\n')

  let _lastTool = null, _lastParams = null, _lastCmd = ''
  let filesCreated = 0, filesUpdated = 0
  const startTime = Date.now()

  spin.set('⏳ Understanding Request...')

  const agent = new AetherAgent({
    workingDir, maxIterations, verbose,

    onStatus() {},                    // silent — we control the status line
    onIteration() {},                 // no step counter

    onThought(thought) {
      spin.set(thoughtToStatus(thought))
    },

    onAction(toolName, params) {
      _lastTool = toolName; _lastParams = params
      _lastCmd  = String(params?.command ?? '').toLowerCase()
      spin.set(smartStatus(toolName, params))
    },

    onObservation(obs) {
      const tool   = _lastTool
      const params = _lastParams
      const cmd    = _lastCmd
      const failed = obs.startsWith('ERROR') || obs.includes('COMMAND FAILED') || obs.startsWith('EXECUTOR ERROR')

      if (tool === 'execute_command') {
        if (failed) {
          const reason = extractFirstError(obs)
          if (BUILD_CMDS.test(cmd))  ui.buildFail(reason)
          else if (SERVER_CMDS.test(cmd)) ui.serverFail(reason)
          else if (TEST_CMDS.test(cmd))   ui.testFail(reason)
          else { spin.stop(); console.log(`\x1b[31m✗\x1b[0m Command Failed\n\n  \x1b[1mReason:\x1b[0m\n  ${reason ?? ''}\n`) }
          spin.set('🔧 Analyzing error...')
        } else {
          if (BUILD_CMDS.test(cmd)) {
            const hasOut = BUILD_DIRS.some(d => existsSync(join(workingDir, d)))
            if (hasOut) ui.buildSuccess()
            else        ui.buildNoOutput()
          } else if (SERVER_CMDS.test(cmd)) {
            const url = obs.match(/https?:\/\/localhost:\d+/i)?.[0]
            if (url) ui.serverReady(url, null)
            else     ui.cmdSuccess('Server started')
          } else if (TEST_CMDS.test(cmd)) {
            ui.testPass(extractTestSummary(obs))
          } else if (INSTALL_CMDS.test(cmd)) {
            ui.cmdSuccess('Dependencies Installed')
          } else {
            const line = obs.split('\n').filter(l => l.trim() && !l.startsWith('>')).slice(0,1).join('').slice(0,80)
            if (line) { spin.stop(); console.log(`\x1b[32m✓\x1b[0m \x1b[2m${line}\x1b[0m`) }
          }
        }
        return
      }

      if (tool === 'start_server') {
        if (failed || obs.startsWith('ERROR'))       ui.serverFail(obs)
        else if (obs.includes('WARNING'))            ui.serverNotAccessible(obs.match(/URL tried: (\S+)/)?.[1])
        else {
          const localUrl = obs.match(/LOCAL: (\S+)/)?.[1]
          const netUrl   = obs.match(/NETWORK: (\S+)/)?.[1]
          ui.serverReady(localUrl, netUrl)
        }
        return
      }

      if (tool === 'write_file')                      { filesCreated++; spin.set(`📝 Writing files... [${filesCreated}]`); return }
      if (tool === 'edit_file' || tool === 'append_file') { filesUpdated++; spin.set(`✏️ Updating files... [${filesUpdated}]`); return }
      // Everything else: silent
    },

    onFinalAnswer(answer) {
      spin.stop()
      ui.finalAnswer(answer)
    },

    onError(msg) {
      if (verbose) { spin.stop(); console.log(`\x1b[90m[debug] ${msg}\x1b[0m`) }
    },
  })

  try {
    const result  = await agent.run(objective)
    spin.stop()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const mark    = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m⚠️\x1b[0m'
    console.log(`${mark} \x1b[2mDone in ${elapsed}s\x1b[0m\n`)
    if (!result.success) console.log('\x1b[2mRun again to continue.\x1b[0m\n')
    return result
  } catch (err) {
    spin.stop()
    ui.error(`Agent failed: ${err.message}`)
    const m = (err.message ?? '').toLowerCase()
    if (m.includes('session') || m.includes('fetch') || m.includes('enotfound'))
      console.log(`\n\x1b[33mTip:\x1b[0m Sign in at \x1b[36mhttps://gemini.google.com\x1b[0m then retry.\n`)
    if (verbose) console.error(err)
    process.exit(1)
  }
}

function extractFirstError(obs) {
  return obs.split('\n').map(l => l.trim())
    .filter(l => l && !/^(npm warn|>|npm notice)/.test(l) && !/^\s*at /.test(l))
    .find(l => /error|failed|cannot|not found|invalid|missing/i.test(l))
    ?? obs.split('\n').find(l => l.trim().length > 5)
    ?? obs.slice(0, 120)
}

function extractTestSummary(obs) {
  return obs.match(/(\d+ (test|spec|suite).{0,40})/i)?.[1] ?? null
}
