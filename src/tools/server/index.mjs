import { spawn }     from 'child_process'
import { existsSync } from 'fs'
import { join }      from 'path'

// Track running servers in memory
const runningServers = new Map()

async function detectDevCommand(cwd) {
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const { readFile } = await import('fs/promises')
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      const scripts = pkg.scripts ?? {}
      const priorities = ['dev', 'start', 'serve', 'preview', 'develop']
      for (const name of priorities) {
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
    /listening[^:]*:\s*(https?:\/\/\S+)/i,
    /running[^:]*:\s*(https?:\/\/\S+)/i,
    /(https?:\/\/localhost:\d+[^\s,)"']*)/i,
  ]
  for (const rx of patterns) {
    const m = text.match(rx)
    if (m) return m[1].replace(/\/$/, '')
  }
  return null
}

export const serverTools = [

  {
    name: 'start_server',
    description: 'Start a development server (npm run dev / pnpm dev / python http.server etc.). Auto-detects command. Returns URL when ready.',
    parameters: {
      command: { type: 'string', required: false, description: 'Override start command (auto-detected if omitted)' },
      port:    { type: 'number', required: false, description: 'Expected port (for fallback URL suggestion)' },
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
        if (!cmd) return 'Could not detect start command.\nSpecify it: start_server {"command": "npm run dev"}'
      }

      return new Promise((resolve) => {
        const chunks = []
        let url = null, resolved = false

        const proc = spawn(cmd, { shell: true, cwd, env: { ...process.env, FORCE_COLOR: '0' } })

        const onData = (chunk) => {
          const text = chunk.toString()
          chunks.push(text)
          if (!url) url = extractUrl(chunks.join(''))
          if (url && !resolved) {
            resolved = true
            runningServers.set('default', { process: proc, url, command: cmd })
            resolve(`SUCCESS\nURL: ${url}\nCommand: ${cmd}\nPID: ${proc.pid}`)
          }
        }

        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)
        proc.on('error', err => { if (!resolved) { resolved = true; resolve(`COMMAND FAILED: ${err.message}`) } })
        proc.on('exit', code => {
          runningServers.delete('default')
          if (!resolved) { resolved = true; resolve(`Server exited (code ${code}).\n${chunks.join('').slice(0, 600)}`) }
        })

        setTimeout(() => {
          if (resolved) return
          resolved = true
          runningServers.set('default', { process: proc, url, command: cmd })
          const fallback = `http://localhost:${port || 3000}`
          resolve(url
            ? `SUCCESS\nURL: ${url}\nCommand: ${cmd}`
            : `Server started (URL not detected).\nTry: ${fallback}\nCommand: ${cmd}`
          )
        }, 15000)
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
    description: 'Check if a development server is running. Returns URL if available.',
    parameters: {},
    async execute(_, cwd) {
      if (!runningServers.has('default')) return 'No server is running.'
      const { url, command } = runningServers.get('default')
      return `✓ Server is running\nURL:     ${url ?? 'unknown'}\nCommand: ${command}`
    }
  },

]

export default serverTools
