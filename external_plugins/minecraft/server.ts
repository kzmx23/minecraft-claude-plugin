#!/usr/bin/env bun
/**
 * Minecraft channel for Claude Code.
 *
 * Paper plugin sends HTTP POST /message with { player, uuid, message }.
 * This server pushes it into Claude Code as a <channel> notification.
 * Claude replies via the "reply" tool, which sends tellraw via RCON.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const PORT = Number(process.env.MINECRAFT_CHANNEL_PORT ?? 25589)
const CONTAINER_FILTER = process.env.MINECRAFT_CONTAINER_FILTER ?? 'name=minecraft'

// ── RCON via docker exec ───────────────────────────────────────────

async function getContainerId(): Promise<string> {
  const proc = Bun.spawn(['sudo', 'docker', 'ps', '-q', '--filter', CONTAINER_FILTER])
  const text = await new Response(proc.stdout).text()
  const id = text.trim()
  if (!id) throw new Error('Minecraft container not found')
  return id
}

// Commands that can destroy the server or bypass security. Always denied here —
// Claude should not disable whitelist, grant OP, ban, or run destructive commands.
// If a player needs one of these, use AdminMode in-game (/adminmode <minutes>)
// with web-PIN confirmation instead.
const DENIED_COMMAND = new RegExp(
  [
    String.raw`^whitelist\s+(off|remove|clear)`,
    String.raw`^op(\s|$)`,
    String.raw`^deop(\s|$)`,
    String.raw`^ban(\s|$)`,
    String.raw`^ban-ip(\s|$)`,
    String.raw`^pardon(\s|$)`,
    String.raw`^pardon-ip(\s|$)`,
    String.raw`^kick(\s|$)`,
    String.raw`^stop(\s|$)`,
    String.raw`^restart(\s|$)`,
    String.raw`^reload(\s|$)`,
    String.raw`^gamerule\s+(mobGriefing|doFireTick|doDaylightCycle|keepInventory|commandBlockOutput)`,
    String.raw`^fill(\s|$)`,
    String.raw`^clone(\s|$)`,
    String.raw`^setblock(\s|$)`,
    String.raw`^summon\s+minecraft:(wither|ender_dragon|fireball)`,
    String.raw`^kill\s+@(e|a)`,
    String.raw`^clear\s+@(e|a)`,
    String.raw`^scoreboard\s+objectives\s+setdisplay`,
    String.raw`^team\s+(add|modify)`,
    String.raw`^tellraw\s+@(a|e)`,
    String.raw`^title\s+@(a|e)`,
    String.raw`^execute\s+(as|at)\s+@(a|e)`,
    String.raw`^lp\s+(group|user|track)`,
    String.raw`^luckperms\s+(group|user|track)`,
    String.raw`^datapack\s+disable`,
    String.raw`^worldborder`,
  ].join('|'),
  'i',
)

async function rconExec(command: string): Promise<string> {
  const trimmed = command.trim().replace(/^\//, '')
  if (DENIED_COMMAND.test(trimmed)) {
    process.stderr.write(`minecraft channel: DENIED command: ${trimmed}\n`)
    throw new Error(
      `command denied for safety: ${trimmed.split(/\s+/, 1)[0]}. ` +
        `Use AdminMode in-game (/adminmode <minutes>) to unlock.`,
    )
  }
  const cid = await getContainerId()
  const proc = Bun.spawn(['sudo', 'docker', 'exec', cid, 'rcon-cli', command])
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`rcon-cli exited ${code}`)
  return out.trim()
}

// ── MCP Server ─────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'minecraft', version: '0.0.1' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: [
      'The player reads Minecraft chat, not this session. Anything you want them to see must go through the reply tool — your transcript output never reaches the game.',
      '',
      'Messages from Minecraft arrive as <channel source="minecraft" player="..." uuid="..." ts="...">.',
      'Reply with the reply tool — pass player name back. Keep replies concise, Minecraft chat wraps at ~60 chars per line.',
      'Do not use markdown — it will not render in Minecraft. Use plain text.',
      'Be friendly and helpful to the player.',
    ].join('\n'),
  },
)

// ── Tools ──────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Send a message to a Minecraft player in-game via tellraw. Keep messages concise — Minecraft chat wraps at ~60 chars.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'The reply text' },
          player: {
            type: 'string',
            description: 'Player name to send to. Default: @a (all players)',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'run_command',
      description:
        'Execute a Minecraft server command via RCON (e.g. give, tp, time set, weather). No leading slash.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          command: { type: 'string', description: 'The server command without leading /' },
        },
        required: ['command'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const text = String(args.text ?? '')
        const player = String(args.player ?? '@a')
        const tellraw = JSON.stringify({
          text: '',
          extra: [
            { text: '[Claude] ', color: 'light_purple', bold: true },
            { text, color: 'white' },
          ],
        })
        await rconExec(`tellraw ${player} ${tellraw}`)
        return { content: [{ type: 'text', text: `sent to ${player}` }] }
      }
      case 'run_command': {
        const command = String(args.command ?? '')
        if (!command) throw new Error('empty command')
        const result = await rconExec(command)
        return { content: [{ type: 'text', text: result || 'ok' }] }
      }
      default:
        return {
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
    }
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `${req.params.name}: ${err instanceof Error ? err.message : err}` },
      ],
      isError: true,
    }
  }
})

// ── Connect MCP transport ──────────────────────────────────────────

await mcp.connect(new StdioServerTransport())

// ── Deliver inbound messages to Claude ─────────────────────────────

let seq = 0

function deliver(player: string, uuid: string, message: string): void {
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: message,
      meta: {
        player,
        uuid,
        message_id: `mc-${Date.now()}-${++seq}`,
        ts: new Date().toISOString(),
      },
    },
  })
}

// ── HTTP server (receives POSTs from Paper plugin) ─────────────────

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/message' && req.method === 'POST') {
      return (async () => {
        try {
          const body = (await req.json()) as { player: string; uuid: string; message: string }
          if (!body.player || !body.message) {
            return new Response('missing fields', { status: 400 })
          }
          deliver(body.player, body.uuid ?? '', body.message)
          return new Response('ok', { status: 200 })
        } catch {
          return new Response('bad request', { status: 400 })
        }
      })()
    }

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 })
    }

    return new Response('not found', { status: 404 })
  },
})

process.stderr.write(`minecraft channel: listening on http://0.0.0.0:${PORT}\n`)

// ── Graceful shutdown ──────────────────────────────────────────────

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('minecraft channel: shutting down\n')
  setTimeout(() => process.exit(0), 1000)
}

process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
