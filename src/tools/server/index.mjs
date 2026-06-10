import { spawn }      from 'child_process'
import { existsSync } from 'fs'
import { join }       from 'path'
import { networkInterfaces } from 'os'

const runningServers = new Map()

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function detectDevCommand(cwd) {
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const { readFile } = await import('fs/promises')
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      const scripts = pkg.scripts ?? {}
      for (const name of ['dev', 'start', 'serve', 'preview', 'develop']) {
        if (scripts[name]) {
          const pm = existsSync(join(cwd, 'bun.lockb'))       ? 'bun'
                   : existsSync(join(cwd, 'pnpm-lock.yaml'))  ? 'pnpm'
                   : existsSync(join(cwd, 'yarn.lock'))        ? 'yarn'
                   : 'npm'
          return `${pm} run ${name}`
        }
      }
    } catch {}
  }
  if (existsSync(join(cwd, 'app.py')) || existsSync(join(cwd, 'main.py')))
    return 'python -m http.server 8000'
  if (existsSync(join(cwd, 'index.html')))
    return 'python -m http.server 8000'
  return null
}

function extractUrl(text) {
  const patterns = [
    /Local:\s+(https?:\/\/\S+)/i,
    /started[^:]*:\s*(https?:\/\/localhost:\d+[^\s]*)/i,
    /listening[^:]*[:\s]+(https?:\/\/\S+)/i,
    /running[^:]*[:\s]+(https?:\/\/\S+)/i,
    /(https?:\/\/localhost:\d+[^\s,)"']*)/i,
    /localhost:(\d+)/i,
  ]
  for (const rx of patterns) {
    const m = text.match(rx)
    if (m) {
      const raw = m[1]
      if (raw.match(/^\d+$/)) return `http://localhost:${raw}`   // just a port
      return raw.replace(/\/$/, '')
    }
  }
  return null
}

function getNetworkIP() {
  try {
    const ifaces = networkInterfaces()
    for (const addrs of Object.values(ifaces)) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) return a.address
      }
    }
  } catch {}
  return null
}

async function httpHealthCheck(url, attempts = 6, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        redirect: 'follow',
      })
      if (res.status < 500) return { ok: true, status: res.status }
    } catch {}
    await new Promise(r => setTimeout(r, delayMs))
  }
  return { ok: false }
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const serverTools = [

  {
    name: 'start_server',
    description: [
      'Start a development server (npm run dev / pnpm dev / python http.server etc.).',
      'Auto-detects the start command. Waits for the server to be ready.',
      'Performs an HTTP health check to verify the server is actually accessible.',
      'Returns LOCAL and NETWORK URLs when verified, or an error if the server is not accessible.',
    ].join(' '),
    parameters: {
      command: { type: 'string', required: false, description: 'Override start command (auto-detected if omitted)' },
      port:    { type: 'number', required: false, description: 'Expected port number (optional hint)' },
    },
    async execute({ command, port }, cwd) {
      // Kill existing
      if (runningServers.has('default')) {
        try { runningServers.get('default').process.kill() } catch {}
        runningServers.delete('default')
      }

      let cmd = command
      if (!cmd) {
        cmd = await detectDevCommand(cwd)
        if (!cmd) return [
          'ERROR: Could not detect a start command.',
          'Specify it explicitly: start_server {"command": "npm run dev"}',
        ].join('\n')
      }

      return new Promise((resolve) => {
        const chunks  = []
        let url       = null
        let resolved  = false

        const proc = spawn(cmd, {
          shell: true, cwd,
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        })

        const onData = (chunk) => {
          const text = chunk.toString()
          chunks.push(text)
          if (!url) url = extractUrl(chunks.join(''))
          if (url && !resolved) {
            resolved = true
            finishWithHealthCheck(url, cmd, port, proc, resolve)
          }
        }

        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)

        proc.on('error', err => {
          if (!resolved) {
            resolved = true
            resolve(`ERROR: Command failed to start.\nCommand: ${cmd}\nReason: ${err.message}`)
          }
        })

        proc.on('exit', code => {
          runningServers.delete('default')
          if (!resolved) {
            resolved = true
            const out = chunks.join('').slice(0, 600)
            resolve(`ERROR: Server exited unexpectedly (code ${code}).\n\nOutput:\n${out}`)
          }
        })

        // Timeout: 18s to detect URL
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            if (url) {
              finishWithHealthCheck(url, cmd, port, proc, resolve)
            } else {
              const fallback = `http://localhost:${port || 3000}`
              runningServers.set('default', { process: proc, url: null, command: cmd })
              resolve([
                'WARNING: Server process started but URL not detected.',
                `Try manually: ${fallback}`,
                `Command: ${cmd}`,
                `Output:\n${chunks.join('').slice(0, 400)}`,
              ].join('\n'))
            }
          }
        }, 18000)
      })
    }
  },

  {
    name: 'stop_server',
    description: 'Stop the running development server.',
    parameters: {},
    async execute(_, cwd) {
      if (!runningServers.has('default')) return 'No server is currently running.'
      const { process: proc, url, command } = runningServers.get('default')
      try { proc.kill('SIGTERM') } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, 3000)
      runningServers.delete('default')
      return `✓ Server stopped.\nWas running: ${command}\nURL was: ${url ?? 'N/A'}`
    }
  },

  {
    name: 'server_status',
    description: 'Check if a server is running and whether it is accessible.',
    parameters: {},
    async execute(_, cwd) {
      if (!runningServers.has('default')) return 'No AETHER-managed server is running.'
      const { url, command } = runningServers.get('default')
      if (url) {
        const check = await httpHealthCheck(url, 1, 500)
        return [
          `✓ Server is running`,
          `  URL:        ${url}`,
          `  HTTP check: ${check.ok ? `${check.status} OK` : 'Not responding'}`,
          `  Command:    ${command}`,
        ].join('\n')
      }
      return `✓ Server is running (URL unknown)\nCommand: ${command}`
    }
  },

]

// ─── Post-start health check ──────────────────────────────────────────────────
async function finishWithHealthCheck(url, cmd, port, proc, resolve) {
  runningServers.set('default', { process: proc, url, command: cmd })

  const check = await httpHealthCheck(url)

  if (check.ok) {
    const netIp   = getNetworkIP()
    const netPort = url.match(/:(\d+)/)?.[1]
    const netUrl  = netIp && netPort ? `http://${netIp}:${netPort}` : null

    const lines = [
      `SUCCESS`,
      `LOCAL: ${url}`,
    ]
    if (netUrl) lines.push(`NETWORK: ${netUrl}`)
    lines.push(`HTTP: ${check.status}`)
    lines.push(`Command: ${cmd}`)
    resolve(lines.join('\n'))
  } else {
    // Server process is running but not responding to HTTP
    resolve([
      `WARNING: Server process is running but application is not accessible.`,
      `URL tried: ${url}`,
      `Command: ${cmd}`,
      `The server may need more time, or there may be a startup error.`,
    ].join('\n'))
  }
}

export default serverTools
