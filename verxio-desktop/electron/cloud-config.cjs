const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const COMPOSIO_PROMPT_START = '<!-- VERXIO_COMPOSIO_CONTEXT_START -->'
const COMPOSIO_PROMPT_END = '<!-- VERXIO_COMPOSIO_CONTEXT_END -->'

function parseSimpleYaml(text) {
  try {
    return JSON.parse(text)
  } catch {
    // fall through to a tiny YAML subset used by Hermes config
  }

  const root = {}
  let current = root
  let currentKey = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const nested = raw.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/)
    if (nested && currentKey) {
      if (typeof root[currentKey] !== 'object' || root[currentKey] === null) {
        root[currentKey] = {}
      }
      current = root[currentKey]
      current[nested[1]] = coerce(nested[2])
      continue
    }
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!top) continue
    currentKey = top[1]
    current = root
    root[currentKey] = top[2] ? coerce(top[2]) : {}
  }
  return root
}

function coerce(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function dumpSimpleYaml(value, indent = 0) {
  if (value == null) return ''
  if (typeof value !== 'object' || Array.isArray(value)) {
    return String(value)
  }
  const pad = '  '.repeat(indent)
  return Object.entries(value)
    .map(([key, nested]) => {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return `${pad}${key}:\n${dumpSimpleYaml(nested, indent + 1)}`
      }
      return `${pad}${key}: ${nested}`
    })
    .join('\n')
}

function mergeObject(target, patch) {
  const next = { ...(target && typeof target === 'object' ? target : {}) }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeObject(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

function mergeProviderConfig(config, { cloudUrl, deviceToken }) {
  const next = mergeObject(config, {
    model: {
      provider: 'custom',
      default: 'verxio-qwen'
    },
    custom_provider: {
      name: 'verxio',
      base_url: `${String(cloudUrl || '').replace(/\/$/, '')}/api/inference/v1`,
      api_key: deviceToken
    }
  })
  return next
}

function spliceComposioPrompt(current, block) {
  const existing = typeof current === 'string' ? current : ''
  const managed = String(block || '').trim()

  if (!managed) {
    return existing
  }

  const start = existing.indexOf(COMPOSIO_PROMPT_START)
  const end = existing.indexOf(COMPOSIO_PROMPT_END)

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start).trimEnd()
    const after = existing.slice(end + COMPOSIO_PROMPT_END.length).trimStart()

    return [before, managed, after].filter(Boolean).join('\n\n')
  }

  if (!existing.trim()) {
    return managed
  }

  return `${existing.trimEnd()}\n\n${managed}`
}

function mergeComposioMcp(config, { enabled, mcpUrl, prompt }) {
  const next = mergeObject(config, {})
  const active = enabled !== false && Boolean(mcpUrl)

  if (active) {
    next.mcp_servers = mergeObject(next.mcp_servers, {
      composio: {
        enabled: true,
        url: mcpUrl,
        headers: { 'x-api-key': '${COMPOSIO_API_KEY}' },
        connect_timeout: 30,
        timeout: 120,
        supports_parallel_tool_calls: false
      }
    })
  } else if (next.mcp_servers && next.mcp_servers.composio) {
    delete next.mcp_servers.composio
  }

  if (prompt) {
    const current = next.agent && typeof next.agent.system_prompt === 'string' ? next.agent.system_prompt : ''
    next.agent = mergeObject(next.agent, { system_prompt: spliceComposioPrompt(current, prompt) })
  }

  return next
}

function readConfig(hermesHome) {
  const file = path.join(hermesHome, 'config.yaml')
  if (!fs.existsSync(file)) {
    return {}
  }
  return parseSimpleYaml(fs.readFileSync(file, 'utf8'))
}

function writeConfig(hermesHome, config) {
  fs.mkdirSync(hermesHome, { recursive: true })
  const file = path.join(hermesHome, 'config.yaml')
  const rendered = dumpSimpleYaml(config).trimEnd() + '\n'
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, rendered, 'utf8')
  fs.renameSync(tmp, file)
  return file
}

function hasRuntimeToken(hermesHome) {
  const envPath = path.join(hermesHome, '.env')

  if (!fs.existsSync(envPath)) {
    return false
  }

  return fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .some(line => {
      const trimmed = line.trim()
      const prefix = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed

      return prefix.startsWith('VERXIO_RUNTIME_TOKEN=') && prefix.slice('VERXIO_RUNTIME_TOKEN='.length).trim()
    })
}

function applyCloudConfig(hermesHome, payload) {
  const current = readConfig(hermesHome)
  const withProvider = mergeProviderConfig(current, payload)
  const next = mergeComposioMcp(withProvider, payload)
  writeConfig(hermesHome, next)
  return next
}

const COMPOSIO_WRITER = `
import json, sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write("PyYAML is required to update the Verxio agent config\\n")
    sys.exit(2)

home = Path(sys.argv[1])
payload = json.load(sys.stdin)
path = home / "config.yaml"
home.mkdir(parents=True, exist_ok=True)
config = {}
if path.exists():
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if isinstance(loaded, dict):
        config = loaded

START = "<!-- VERXIO_COMPOSIO_CONTEXT_START -->"
END = "<!-- VERXIO_COMPOSIO_CONTEXT_END -->"
prompt = str(payload.get("prompt") or "").strip()
agent = config.get("agent") if isinstance(config.get("agent"), dict) else {}
current = agent.get("system_prompt") if isinstance(agent.get("system_prompt"), str) else ""
if prompt:
    start = current.find(START)
    end = current.find(END)
    if start != -1 and end != -1 and end > start:
        before = current[:start].rstrip()
        after = current[end + len(END):].lstrip()
        merged = "\\n\\n".join(part for part in (before, prompt, after) if part)
    elif current.strip():
        merged = current.rstrip() + "\\n\\n" + prompt
    else:
        merged = prompt
    agent["system_prompt"] = merged
    config["agent"] = agent

VOICE = "<!-- verxio-voice -->"
voice = str(payload.get("agentPrompt") or "").strip()
current = agent.get("system_prompt") if isinstance(agent.get("system_prompt"), str) else ""
if voice:
    marker = current.find(VOICE)
    if marker != -1:
        composio_at = current.find(START, marker + len(VOICE))
        current = (current[:marker] + (current[composio_at:] if composio_at != -1 else "")).strip()
    composio_at = current.find(START)
    if composio_at != -1:
        before = current[:composio_at].strip()
        composio = current[composio_at:].strip()
        current = "\\n\\n".join(part for part in (before, voice, composio) if part)
    elif current.strip():
        current = current.rstrip() + "\\n\\n" + voice
    else:
        current = voice
    agent["system_prompt"] = current
    config["agent"] = agent

soul = str(payload.get("soulPrompt") or "").strip()
if soul:
    soul_path = home / "SOUL.md"
    current_soul = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
    stock_hermes = "You are Hermes Agent" in current_soul and "Nous Research" in current_soul
    if not current_soul.strip() or (stock_hermes and "Verxio Notepad" not in current_soul):
        soul_path.write_text(soul if soul.endswith("\\n") else soul + "\\n", encoding="utf-8")

servers = config.get("mcp_servers") if isinstance(config.get("mcp_servers"), dict) else {}
enabled = bool(payload.get("enabled")) and bool(payload.get("mcpUrl"))
if enabled:
    servers["composio"] = {
        "enabled": True,
        "url": payload.get("mcpUrl"),
        "headers": {"x-api-key": "\${COMPOSIO_API_KEY}"},
        "connect_timeout": 30,
        "timeout": 120,
        "supports_parallel_tool_calls": False,
    }
    config["mcp_servers"] = servers
else:
    servers.pop("composio", None)
    if servers:
        config["mcp_servers"] = servers
    else:
        config.pop("mcp_servers", None)

tmp = path.with_suffix(".yaml.tmp")
tmp.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
tmp.replace(path)

def upsert_env(env_path, updates):
    pending = {key: str(value).strip() for key, value in updates.items() if str(value or "").strip()}
    if not pending:
        return
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    next_lines = []
    seen = set()
    for line in lines:
        stripped = line.strip()
        matched = None
        for key in pending:
            prefix = key + "="
            if stripped.startswith(prefix) or stripped.startswith("export " + prefix):
                matched = key
                break
        if matched:
            next_lines.append(matched + "=" + pending[matched])
            seen.add(matched)
        else:
            next_lines.append(line)
    for key, value in pending.items():
        if key not in seen:
            next_lines.append(key + "=" + value)
    env_path.write_text("\\n".join(next_lines).rstrip() + "\\n", encoding="utf-8")

upsert_env(home / ".env", {
    "COMPOSIO_API_KEY": payload.get("apiKey") or "",
    "VERXIO_API_URL": payload.get("apiUrl") or "",
    "VERXIO_PUBLIC_WEB_URL": payload.get("publicWebUrl") or "",
    "VERXIO_RUNTIME_TOKEN": payload.get("runtimeToken") or "",
})

json.dump({"ok": True, "enabled": enabled}, sys.stdout)
`

function applyComposioBridge(hermesHome, payload, python) {
  const binary = python || (process.platform === 'win32' ? 'python' : 'python3')
  const result = spawnSync(binary, ['-c', COMPOSIO_WRITER, hermesHome], {
    encoding: 'utf8',
    input: JSON.stringify({
      agentPrompt: payload.agentPrompt || '',
      apiKey: payload.apiKey || '',
      apiUrl: payload.apiUrl || '',
      enabled: Boolean(payload.enabled),
      mcpUrl: payload.mcpUrl || '',
      prompt: payload.prompt || '',
      publicWebUrl: payload.publicWebUrl || '',
      runtimeToken: payload.runtimeToken || '',
      soulPrompt: payload.soulPrompt || ''
    }),
    timeout: 15000
  })

  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || 'Could not write the Composio bridge').trim()
    throw new Error(detail.split('\n')[0])
  }

  return JSON.parse(result.stdout || '{"ok":true,"enabled":false}')
}

module.exports = {
  applyCloudConfig,
  applyComposioBridge,
  dumpSimpleYaml,
  hasRuntimeToken,
  mergeComposioMcp,
  mergeProviderConfig,
  parseSimpleYaml,
  readConfig,
  writeConfig
}
