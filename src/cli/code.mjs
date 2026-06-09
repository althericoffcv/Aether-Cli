/**
 * code.mjs — Autonomous code mode (aether code <task>)
 * Uses the updated agent with workspace-local memory and clean output.
 */
import readline        from 'readline'
import { AetherAgent } from '../agent/index.mjs'
import { ui, spin }    from './ui.mjs'
import { initWorkspace } from '../config/index.mjs'

export async function runCode(task, options = {}) {
  ui.banner()

  // ── Get objective ──────────────────────────────────────────────────────────
  let objective = task?.trim()

  if (!objective) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    objective = await new Promise(resolve => {
      rl.question(
        '\x1b[1m\x1b[33m⚡ What should AETHER do?\x1b[0m\n' +
        '\x1b[2m(e.g. "add error handling to routes", "create a React todo app")\x1b[0m\n\n' +
        '\x1b[1m› \x1b[0m',
        ans => { rl.close(); resolve(ans.trim()) }
      )
    })
  }

  if (!objective) {
    ui.error('No task provided.')
    process.exit(1)
  }

  const workingDir    = options.workingDir    ?? process.cwd()
  const maxIterations = options.maxIterations ?? 25
  const verbose       = options.verbose       ?? false

  // ── Init workspace .aether/ silently ──────────────────────────────────────
  await initWorkspace(workingDir)

  // ── Print header ───────────────────────────────────────────────────────────
  console.log(`\x1b[1m\x1b[33m⚡ Objective\x1b[0m`)
  console.log(`  ${objective}\n`)
  console.log(`\x1b[2m  📁 ${workingDir}`)
  console.log(`  🔄 Max ${maxIterations} iterations\x1b[0m\n`)
  console.log('\x1b[90m' + '─'.repeat(56) + '\x1b[0m')

  const startTime = Date.now()

  // ── Build agent ────────────────────────────────────────────────────────────
  const agent = new AetherAgent({
    workingDir,
    maxIterations,
    verbose,

    onStatus(text)    { ui.status(text) },

    onIteration(i, max) {
      spin.stop()
      const bar = progressBar(i, max, 20)
      console.log(`\n\x1b[90m─── Step ${String(i).padStart(2)} / ${max}  ${bar} ───\x1b[0m`)
    },

    onThought(thought) { ui.thought(thought) },

    onAction(toolName, params) {
      ui.action(toolName, params)
      spin.start(`Executing ${toolName}…`)
    },

    onObservation(obs) {
      spin.stop()
      ui.observation(obs)
    },

    onFinalAnswer(answer) {
      spin.stop()
      ui.finalAnswer(answer)
    },

    onError(msg) {
      spin.stop()
      ui.warn(msg)
    },
  })

  // ── Run ────────────────────────────────────────────────────────────────────
  try {
    const result  = await agent.run(objective)
    spin.stop()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const status  = result.success ? '\x1b[32m✓ Done\x1b[0m' : '\x1b[33m⚠ Partial\x1b[0m'
    console.log(`\x1b[2m${status} · ${result.iterations} steps · ${elapsed}s\x1b[0m\n`)

    if (!result.success) {
      ui.warn('Max iterations reached. Task may be partially complete.')
      console.log('\x1b[2mRun again to continue.\x1b[0m\n')
    }
    return result
  } catch (err) {
    spin.stop()
    ui.error(`Agent failed: ${err.message}`)
    printConnectionHint(err)
    if (verbose) console.error(err)
    process.exit(1)
  }
}

function progressBar(current, total, width) {
  const pct    = Math.min(current / total, 1)
  const filled = Math.round(pct * width)
  return '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(total - filled) + '\x1b[0m'
}

function printConnectionHint(err) {
  const msg = (err.message ?? '').toLowerCase()
  if (msg.includes('session') || msg.includes('fetch') || msg.includes('enotfound') || msg.includes('initialize')) {
    console.log(`
\x1b[33mConnection issue:\x1b[0m
  1. Open \x1b[36mhttps://gemini.google.com\x1b[0m and sign in
  2. Ensure internet access is available
  3. Run \x1b[36maether doctor\x1b[0m for full diagnostics
`)
  }
}
