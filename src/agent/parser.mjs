/**
 * Parser for agent responses.
 *
 * Gemini (via scraper) doesn't always follow the exact format we ask for,
 * so we try multiple patterns in order of preference.
 *
 * Possible outputs:
 *   { type: 'action',  toolName, params, thought }
 *   { type: 'final',   answer, thought }
 *   { type: 'unknown', raw }
 */
export function parseAgentResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { type: 'unknown', raw: String(raw) }
  }

  const text = raw.trim()

  // ── 1. Look for FINAL_ANSWER first ────────────────────────────────────────
  const finalAnswer = extractFinalAnswer(text)
  if (finalAnswer) {
    const thought = extractThought(text)
    return { type: 'final', answer: finalAnswer, thought }
  }

  // ── 2. Look for an ACTION ──────────────────────────────────────────────────
  const action = extractAction(text)
  if (action) return { type: 'action', ...action }

  // ── 3. Heuristic: does it look like a completed response? ─────────────────
  //    If the text is plain prose with no action markers, treat as final.
  const hasActionKeyword = /\b(I will|I'll|Next|Let me|First|Now|Step)/i.test(text)
  const hasToolHint = /\b(read_file|write_file|edit_file|execute_command|list_directory|git_|search_files|project_scan|memory_)/i.test(text)

  if (!hasActionKeyword && !hasToolHint) {
    // Looks like a conclusion
    return { type: 'final', answer: text, thought: '' }
  }

  // ── 4. Fallback — couldn't parse clearly ──────────────────────────────────
  return { type: 'unknown', raw: text }
}

// ─── Extract FINAL_ANSWER ─────────────────────────────────────────────────────
function extractFinalAnswer(text) {
  // XML: <FINAL_ANSWER>...</FINAL_ANSWER>
  let m = text.match(/<FINAL_ANSWER>([\s\S]*?)<\/FINAL_ANSWER>/i)
  if (m) return m[1].trim()

  // Markdown header
  m = text.match(/(?:##\s*)?FINAL[\s_]ANSWER:?\s*\n([\s\S]+?)(?:\n---|\n===|$)/i)
  if (m) return m[1].trim()

  // Bold markdown
  m = text.match(/\*\*(?:Final\s+Answer|FINAL\s+ANSWER)\*\*:?\s*([\s\S]+?)(?:\n---|\*\*|\n\n\n|$)/i)
  if (m) return m[1].trim()

  // Simple keyword on its own line
  m = text.match(/^FINAL[ _]ANSWER:\s*([\s\S]+)/im)
  if (m) return m[1].trim()

  // Task-completion signals — treat whole response as final answer
  const conclusionPhrases = [
    /^(?:I have|I've) (?:completed|finished|done|successfully)/im,
    /^The task (?:is|has been) (?:complete|finished|done)/im,
    /^All (?:tasks?|steps?) (?:are|have been) (?:complete|done|finished)/im,
    /^Everything (?:is|has been) (?:set up|done|configured|implemented)/im,
  ]
  if (conclusionPhrases.some(rx => rx.test(text))) {
    // Remove thought tag if present to get clean answer
    return text.replace(/<THOUGHT>[\s\S]*?<\/THOUGHT>/gi, '').trim()
  }

  return null
}

// ─── Extract THOUGHT ──────────────────────────────────────────────────────────
function extractThought(text) {
  let m = text.match(/<THOUGHT>([\s\S]*?)<\/THOUGHT>/i)
  if (m) return m[1].trim()

  m = text.match(/^THOUGHT:\s*(.+)$/im)
  if (m) return m[1].trim()

  return ''
}

// ─── Extract ACTION + PARAMS ──────────────────────────────────────────────────
function extractAction(text) {
  // ── Format A: XML tags (preferred) ────────────────────────────────────────
  const thought   = extractThought(text)
  const xmlAction = text.match(/<ACTION>([\s\S]*?)<\/ACTION>/i)
  if (xmlAction) {
    const toolName  = xmlAction[1].trim()
    const xmlParams = text.match(/<PARAMS>([\s\S]*?)<\/PARAMS>/i)
    const params    = parseJSON(xmlParams?.[1]?.trim() ?? '{}')
    return { toolName, params, thought }
  }

  // ── Format B: Line-based ───────────────────────────────────────────────────
  // ACTION: tool_name
  // PARAMS: {...}
  const lineAction = text.match(/^ACTION:\s*(\w+)/im)
  if (lineAction) {
    const toolName  = lineAction[1].trim()
    const lineParam = text.match(/^PARAMS:\s*(\{[\s\S]*?\})/im)
    const params    = parseJSON(lineParam?.[1] ?? '{}')
    const thought   = extractThought(text) || extractLineThought(text)
    return { toolName, params, thought }
  }

  // ── Format C: JSON code block containing action/tool ──────────────────────
  // ```json
  // {"action": "read_file", "params": {"path": "..."}}
  // ```
  const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (codeBlock) {
    try {
      const obj = JSON.parse(codeBlock[1])
      const toolName = (obj.action ?? obj.tool ?? obj.name ?? '').trim()
      if (toolName) {
        const params  = obj.params ?? obj.parameters ?? obj.args ?? {}
        return { toolName, params, thought: obj.thought ?? '' }
      }
    } catch {}
  }

  // ── Format D: Inline natural language with tool name ──────────────────────
  // "I'll use read_file with {"path": "foo.js"}"
  const TOOL_NAMES = [
    'read_file','write_file','edit_file','delete_file','move_file','copy_file',
    'list_directory','search_files','execute_command',
    'git_status','git_add','git_commit','git_push','git_pull','git_clone',
    'project_scan','memory_read','memory_write',
  ]
  for (const toolName of TOOL_NAMES) {
    const rx = new RegExp(`\\b${toolName}\\b[\\s\\S]*?(\\{[\\s\\S]*?\\})`, 'i')
    const m  = text.match(rx)
    if (m) {
      const params = parseJSON(m[1])
      return { toolName, params, thought: '' }
    }
  }

  // ── Format E: Backtick tool call ──────────────────────────────────────────
  // `read_file` with params: {...}
  const backtick = text.match(/`([\w_]+)`[\s\S]{0,60}?(\{[\s\S]*?\})/)
  if (backtick) {
    const toolName = backtick[1].trim()
    if (TOOL_NAMES.includes(toolName)) {
      const params = parseJSON(backtick[2])
      return { toolName, params, thought: '' }
    }
  }

  return null
}

// ─── Safe JSON parser ─────────────────────────────────────────────────────────
function parseJSON(str) {
  if (!str || str.trim() === '{}' || !str.trim()) return {}

  // Direct parse
  try { return JSON.parse(str) } catch {}

  // Strip trailing commas
  try {
    const fixed = str
      .replace(/,\s*([}\]])/g, '$1')   // trailing commas
      .replace(/'/g, '"')              // single → double quotes
    return JSON.parse(fixed)
  } catch {}

  // Extract key-value pairs manually (best-effort)
  const result = {}
  // "key": "value" or "key": 123 or "key": true
  const kvRx = /["`']?([\w_]+)["`']?\s*:\s*(?:"([^"\\]*(\\.[^"\\]*)*)"|'([^']*)'|(\d+(?:\.\d+)?)|(\btrue\b|\bfalse\b))/g
  let m
  while ((m = kvRx.exec(str)) !== null) {
    const key = m[1]
    const val = m[2] ?? m[4] ?? (m[5] !== undefined ? Number(m[5]) : undefined) ?? (m[6] === 'true')
    if (key && val !== undefined) result[key] = val
  }
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractLineThought(text) {
  const m = text.match(/^(?:THOUGHT|Thought|My thought):\s*(.+)$/im)
  return m ? m[1].trim() : ''
}
