import { readFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'

/**
 * Scan a project directory and return a structured description.
 * @param {string} path   - relative path from cwd
 * @param {string} cwd    - working directory
 */
export async function scanProject(path = '.', cwd = process.cwd()) {
  const root = resolve(cwd, path)
  const info = {
    root,
    type:           'unknown',
    language:       null,
    framework:      null,
    packageManager: null,
    moduleSystem:   null,
    name:           null,
    version:        null,
    description:    null,
    dependencies:   [],
    devDependencies:[],
    scripts:        {},
    hasGit:         false,
    hasTests:       false,
    hasTypeScript:  false,
    hasDocker:      false,
    hasCI:          false,
    structure:      [],
    configFiles:    [],
  }

  // ── Git ──────────────────────────────────────────────────────────────────
  info.hasGit    = existsSync(join(root, '.git'))
  info.hasDocker = existsSync(join(root, 'Dockerfile')) || existsSync(join(root, 'docker-compose.yml'))
  info.hasCI     = existsSync(join(root, '.github/workflows')) ||
                   existsSync(join(root, '.gitlab-ci.yml')) ||
                   existsSync(join(root, 'Jenkinsfile'))

  // ── Node / JS / TS ───────────────────────────────────────────────────────
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      info.type        = 'node'
      info.language    = 'javascript'
      info.name        = pkg.name        ?? null
      info.version     = pkg.version     ?? null
      info.description = pkg.description ?? null
      info.scripts     = pkg.scripts     ?? {}
      info.moduleSystem = pkg.type === 'module' ? 'ESM' : 'CommonJS'

      info.dependencies    = Object.keys(pkg.dependencies    ?? {})
      info.devDependencies = Object.keys(pkg.devDependencies ?? {})
      const allDeps = [...info.dependencies, ...info.devDependencies].map(d => d.toLowerCase())

      // TypeScript
      if (allDeps.includes('typescript') || existsSync(join(root, 'tsconfig.json'))) {
        info.language     = 'typescript'
        info.hasTypeScript = true
      }

      // Framework detection
      const fw = detectFramework(allDeps)
      if (fw) info.framework = fw

    } catch (err) {
      info.parseError = err.message
    }
  }

  // ── Python ───────────────────────────────────────────────────────────────
  if (info.type === 'unknown') {
    if (existsSync(join(root, 'requirements.txt')) ||
        existsSync(join(root, 'pyproject.toml'))   ||
        existsSync(join(root, 'setup.py'))) {
      info.type = 'python'; info.language = 'python'
    }
    // Rust
    else if (existsSync(join(root, 'Cargo.toml'))) {
      info.type = 'rust'; info.language = 'rust'
    }
    // Go
    else if (existsSync(join(root, 'go.mod'))) {
      info.type = 'go'; info.language = 'go'
    }
    // Java / Kotlin
    else if (existsSync(join(root, 'pom.xml')) || existsSync(join(root, 'build.gradle'))) {
      info.type = 'jvm'; info.language = 'java'
    }
  }

  // ── Package manager ───────────────────────────────────────────────────────
  if (existsSync(join(root, 'bun.lockb')))        info.packageManager = 'bun'
  else if (existsSync(join(root, 'pnpm-lock.yaml')))   info.packageManager = 'pnpm'
  else if (existsSync(join(root, 'yarn.lock')))        info.packageManager = 'yarn'
  else if (existsSync(join(root, 'package-lock.json'))) info.packageManager = 'npm'
  else if (info.type === 'node')                        info.packageManager = 'npm'

  // ── Test detection ────────────────────────────────────────────────────────
  info.hasTests = existsSync(join(root, '__tests__'))  ||
                  existsSync(join(root, 'tests'))       ||
                  existsSync(join(root, 'test'))        ||
                  existsSync(join(root, 'spec'))        ||
                  !!(info.scripts?.test)

  // ── Directory structure ───────────────────────────────────────────────────
  const SKIP = new Set(['.git','node_modules','.next','dist','build','.cache'])
  try {
    const entries = await readdir(root, { withFileTypes: true })
    info.structure = entries
      .filter(e => !SKIP.has(e.name))
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .sort()
  } catch {}

  // ── Config files ──────────────────────────────────────────────────────────
  const CONFIG_FILES = [
    'tsconfig.json','jsconfig.json','.eslintrc.json','.eslintrc.js',
    '.prettierrc','prettier.config.js','vite.config.js','vite.config.ts',
    'next.config.js','next.config.mjs','astro.config.mjs','nuxt.config.ts',
    'tailwind.config.js','tailwind.config.ts','webpack.config.js',
    '.env','.env.example','.env.local','Dockerfile','docker-compose.yml',
  ]
  info.configFiles = CONFIG_FILES.filter(f => existsSync(join(root, f)))

  return formatScan(info)
}

// ─── Framework detector ───────────────────────────────────────────────────────
function detectFramework(deps) {
  const checks = [
    [['next'],                            'Next.js'],
    [['nuxt'],                            'Nuxt.js'],
    [['astro'],                           'Astro'],
    [['@sveltejs/kit'],                   'SvelteKit'],
    [['svelte'],                          'Svelte'],
    [['@remix-run/node'],                 'Remix'],
    [['gatsby'],                          'Gatsby'],
    [['react'],                           'React'],
    [['vue'],                             'Vue.js'],
    [['angular', '@angular/core'],        'Angular'],
    [['solid-js'],                        'SolidJS'],
    [['@nestjs/core'],                    'NestJS'],
    [['fastify'],                         'Fastify'],
    [['express'],                         'Express.js'],
    [['koa'],                             'Koa.js'],
    [['hono'],                            'Hono'],
    [['@hapi/hapi'],                      'Hapi.js'],
    [['electron'],                        'Electron'],
  ]
  for (const [names, label] of checks) {
    if (names.some(n => deps.includes(n))) return label
  }
  return null
}

// ─── Formatter ────────────────────────────────────────────────────────────────
function formatScan(info) {
  const lines = ['╔══ PROJECT SCAN ══╗']

  const row = (icon, label, value) => {
    if (!value && value !== 0) return
    lines.push(`  ${icon} ${label.padEnd(18)}: ${value}`)
  }

  row('📁', 'Path',           info.root)
  row('🏷', 'Project',        [info.name, info.version].filter(Boolean).join(' v') || '(unnamed)')
  if (info.description) row('📝', 'Description', info.description.slice(0, 80))
  row('💻', 'Type',           info.type)
  row('🔤', 'Language',       info.language)
  if (info.framework)      row('⚡', 'Framework',    info.framework)
  if (info.moduleSystem)   row('📦', 'Modules',      info.moduleSystem)
  if (info.packageManager) row('🔧', 'Pkg Manager',  info.packageManager)
  row('🔀', 'Git',            info.hasGit ? 'Yes' : 'No')
  row('🧪', 'Tests',          info.hasTests ? 'Yes' : 'No')
  row('🐳', 'Docker',         info.hasDocker ? 'Yes' : 'No')
  row('⚙', 'CI/CD',          info.hasCI ? 'Yes' : 'No')

  if (info.dependencies.length) {
    lines.push(`\n  📚 Dependencies (${info.dependencies.length}):`)
    lines.push(`  ${info.dependencies.slice(0, 24).join(', ')}${info.dependencies.length > 24 ? ` ...+${info.dependencies.length - 24} more` : ''}`)
  }

  if (info.devDependencies.length) {
    lines.push(`\n  🛠  Dev dependencies (${info.devDependencies.length}):`)
    lines.push(`  ${info.devDependencies.slice(0, 16).join(', ')}${info.devDependencies.length > 16 ? ` ...+${info.devDependencies.length - 16} more` : ''}`)
  }

  if (Object.keys(info.scripts).length) {
    lines.push('\n  🏃 Scripts:')
    Object.entries(info.scripts).forEach(([k, v]) => {
      lines.push(`    ${k}: ${v}`)
    })
  }

  if (info.configFiles.length) {
    lines.push(`\n  📋 Config files: ${info.configFiles.join(', ')}`)
  }

  if (info.structure.length) {
    lines.push('\n  📂 Root structure:')
    info.structure.slice(0, 30).forEach(f => lines.push(`    ${f}`))
    if (info.structure.length > 30) lines.push(`    ...and ${info.structure.length - 30} more`)
  }

  lines.push('╚═════════════════╝')
  return lines.join('\n')
}
