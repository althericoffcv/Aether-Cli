/**
 * gemini.mjs
 * Scraper Gemini tanpa API key — berdasarkan traffic NetHawk
 *
 * DEBUG: AETHER_DEBUG=1 aether
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TTL = 6 * 60 * 60 * 1000  // re-init tiap 6 jam
const MIN_DELAY   = 3000                  // ms min antar request
const MAX_RETRY   = 3

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let session = null
let reqId      = 1000
let lastReqAt  = 0
let reqLock    = false

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER — silent unless AETHER_DEBUG=1
// ─────────────────────────────────────────────────────────────────────────────

const DEBUG = () => !!process.env.AETHER_DEBUG

function log(tag, msg) {
  if (!DEBUG()) return
  const t = new Date().toISOString().slice(11, 23)
  console.log(`\x1b[36m[${t}]\x1b[0m \x1b[33m[${tag}]\x1b[0m ${msg}`)
}

function logOk(msg)  { if (DEBUG()) console.log(`\x1b[32m✓\x1b[0m ${msg}`) }
function logErr(msg) { if (DEBUG()) console.log(`\x1b[31m✗\x1b[0m ${msg}`) }

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: INIT SESSION
// ─────────────────────────────────────────────────────────────────────────────

async function initSession() {
  log('INIT', 'Fetching gemini.google.com ...')

  const res = await fetch('https://gemini.google.com/', {
    headers: {
      'User-Agent':      UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    redirect: 'follow',
  })

  if (!res.ok) throw new Error(`Init failed: HTTP ${res.status}`)

  const setCookies = res.headers.getSetCookie?.() ?? []
  const cookieStr  = setCookies.map(c => c.split(';')[0]).join('; ')

  const html = await res.text()

  log('INIT', `HTML size: ${html.length} chars`)
  log('INIT', `Cookies: ${cookieStr.slice(0, 80)}...`)

  let bl = html.match(/"cfb2h":"([^"]+)"/)?.[1]
           || html.match(/boq_assistant-bard-web-server_[\w.]+/)?.[0]
           || html.match(/"SNlM0e":"[^"]*".*?"cfb2h":"([^"]+)"/s)?.[1]

  let sid = html.match(/"FdrFJe":"(-?\d+)"/)?.[1]
            || html.match(/"f\.sid"\s*:\s*"(-?\d+)"/)?.[1]

  let at = html.match(/"SNlM0e":"([^"]+)"/)?.[1]

  log('INIT', `bl  = ${bl || 'NOT FOUND'}`)
  log('INIT', `sid = ${sid || 'NOT FOUND'}`)
  log('INIT', `at  = ${at ? at.slice(0, 20) + '...' : 'NOT FOUND'}`)

  if (!bl || !sid) {
    log('INIT', 'Primary regex failed, trying fallback...')
    const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || []
    for (const block of scriptBlocks) {
      if (!bl)  bl  = block.match(/boq_assistant-bard-web-server_[\w.]+/)?.[0]
      if (!sid) sid = block.match(/"f\.sid"\s*:\s*"(-?\d+)"/)?.[1]
      if (!at)  at  = block.match(/"SNlM0e":"([^"]+)"/)?.[1]
      if (bl && sid) break
    }
    log('INIT', `[fallback] bl=${bl || 'NOT FOUND'} sid=${sid || 'NOT FOUND'}`)
  }

  if (!bl || !sid) {
    throw new Error(
      'Could not initialize Gemini session.\n' +
      'Please open https://gemini.google.com in your browser and sign in with Google,\n' +
      'then try again. Run with AETHER_DEBUG=1 for more details.'
    )
  }

  session = {
    bl,
    sid,
    at:      at || '',
    cookies: cookieStr,
    initAt:  Date.now(),
  }

  reqId = Math.floor(Math.random() * 900000) + 100000
  logOk(`Session OK → bl=${bl} | sid=${sid.slice(0, 8)}...`)
}

async function ensureSession() {
  const expired = !session || (Date.now() - session.initAt > SESSION_TTL)
  if (expired) await initSession()
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: RATE LIMIT
// ─────────────────────────────────────────────────────────────────────────────

async function waitDelay() {
  while (reqLock) await new Promise(r => setTimeout(r, 100))
  reqLock = true
  const wait = MIN_DELAY - (Date.now() - lastReqAt)
  if (wait > 0) {
    log('RATE', `Waiting ${wait}ms...`)
    await new Promise(r => setTimeout(r, wait))
  }
}

function releaseDelay() {
  lastReqAt = Date.now()
  reqLock   = false
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: PARSE RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

function parseGeminiResponse(raw) {
  let finalText = null

  for (const line of raw.split('\n')) {
    if (!line.startsWith('[["wrb.fr"')) continue

    try {
      const outer = JSON.parse(line)
      const inner = outer?.[0]?.[2]
      if (!inner) continue

      const data = JSON.parse(inner)
      const candidates = data?.[4]
      if (!candidates) continue

      for (const cand of candidates) {
        const id   = cand[0]
        const segs = cand[1]
        const done = cand[8]

        if (!id?.startsWith('rc_') || !Array.isArray(segs)) continue

        const text = segs.join('')
        if (!text) continue

        if (Array.isArray(done) && done[0] === 2) {
          finalText = text
        } else if (!finalText || text.length > finalText.length) {
          finalText = text
        }
      }
    } catch (_) {}
  }

  return finalText
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: CALL StreamGenerate
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  await waitDelay()

  try {
    await ensureSession()

    const { bl, sid, at, cookies } = session
    const curReqId = reqId
    reqId += 100000

    const url = new URL('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate')
    url.searchParams.set('bl',      bl)
    url.searchParams.set('f.sid',   sid)
    url.searchParams.set('hl',      'en-US')
    url.searchParams.set('_reqid',  String(curReqId))
    url.searchParams.set('rt',      'c')

    const payload = JSON.stringify([
      null,
      JSON.stringify([[prompt, 0, null, null, null, null, 0]]),
    ])

    const body = new URLSearchParams()
    body.set('f.req', payload)
    if (at) body.set('at', at)

    log('REQ', `POST StreamGenerate | reqId=${curReqId} | prompt="${prompt.slice(0, 60)}..."`)

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type':    'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent':      UA,
        'Origin':          'https://gemini.google.com',
        'Referer':         'https://gemini.google.com/',
        'X-Same-Domain':   '1',
        'Accept':          '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      body: body.toString(),
    })

    releaseDelay()
    log('RES', `HTTP ${res.status} | ${res.headers.get('content-type')}`)

    if (res.status === 401 || res.status === 403) {
      session = null
      throw new Error(`Auth error ${res.status} — session reset, try again`)
    }

    if (res.status === 429) {
      const wait = 35000 + Math.random() * 15000
      log('RATE', `429 Rate limited. Waiting ${(wait / 1000).toFixed(0)}s...`)
      await new Promise(r => setTimeout(r, wait))
      session = null
      throw new Error('Rate limited (429) — please wait a moment')
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const raw    = await res.text()
    const result = parseGeminiResponse(raw)

    if (!result) {
      log('PARSE', `Parse failed. Raw (300 chars):\n${raw.slice(0, 300)}`)
      session = null
      throw new Error('Failed to parse Gemini response. Session reset.')
    }

    logOk(`Reply OK (${result.length} chars)`)
    return result

  } catch (err) {
    releaseDelay()
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — with retry
// ─────────────────────────────────────────────────────────────────────────────

export async function askGemini(prompt) {
  let lastErr

  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      return await callGemini(prompt)
    } catch (err) {
      lastErr = err
      if (i < MAX_RETRY - 1) {
        const wait = 4000 * (i + 1)
        log('RETRY', `${i + 1}/${MAX_RETRY - 1}: ${err.message} — retry in ${wait / 1000}s`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }

  throw lastErr
}

export function resetSession() {
  session = null
}
