# Minecraft Channel for Claude Code

[Русская версия](README.md)

---

Bidirectional chat between Minecraft and Claude Code — players talk to Claude AI directly from in-game chat.

## Problem

Kids playing Minecraft on mobile (Bedrock via Geyser) can't easily switch to Telegram to talk to Claude — the game crashes or minimizes. They need a way to communicate with Claude without leaving Minecraft.

## Solution

A two-component system:

1. **Paper plugin** inside the Minecraft server captures `/claude <message>` commands and sends HTTP POST to the host
2. **MCP channel server** on the host pushes messages into Claude Code as channel notifications
3. Claude replies back through RCON `tellraw`

## Architecture

```
Player: /claude hello!
        │
   Paper Plugin (Java, inside Docker)
   HTTP POST → host:25589/message
        │
   MCP Channel Server (Bun, on host)
   mcp.notification("notifications/claude/channel")
        │
   Claude Code receives:
   <channel source="minecraft" player="Steve">hello!</channel>
        │
   Claude calls reply tool
        │
   MCP Server → RCON tellraw
        │
   [Claude] response in game chat
```

## Components

### 1. MCP Channel Server (`external_plugins/minecraft/`)

Bun/TypeScript MCP server that:
- Listens on HTTP port 25589 for POST `/message` from the Paper plugin
- Pushes `notifications/claude/channel` into Claude Code
- Exposes `reply` tool (sends `tellraw` via RCON) and `run_command` tool
- Declares `experimental: { 'claude/channel': {} }` capability

### 2. Paper Plugin (`paper-plugin/`)

Java Paper/Bukkit plugin that:
- Registers `/claude <message>` command
- Sends async HTTP POST to the MCP server
- Rate limiting: 3 messages per 30 seconds per player
- Player allowlist in `config.yml`

## Installation

### Prerequisites

- Minecraft Paper server (1.21+) running in Docker
- [Bun](https://bun.sh) runtime on the host
- [Claude Code](https://claude.ai/claude-code) CLI
- `sudo docker exec` access for RCON

### Step 1: Add marketplace

```bash
claude plugin marketplace add kzmx23/minecraft-claude-plugin
```

### Step 2: Install plugin

```bash
claude plugin install minecraft@minecraft-claude-plugin
```

### Step 3: Build Paper plugin

```bash
cd paper-plugin
docker run --rm -v .:/build -w /build maven:3-eclipse-temurin-21 mvn package -q
# Copy ClaudeChat-1.0.jar to your Minecraft server's plugins/ directory
```

### Step 4: Configure

Edit `plugins/ClaudeChat/config.yml` on the Minecraft server:

```yaml
mcp-server-url: "http://YOUR_HOST_IP:25589"
timeout-ms: 3000
rate-limit-count: 3
rate-limit-period: 30
allowed-players:
  - PlayerName1
  - PlayerName2
```

### Step 5: Launch Claude Code

```bash
claude --dangerously-skip-permissions \
  --dangerously-load-development-channels plugin:minecraft@minecraft-claude-plugin
```

> `--dangerously-load-development-channels` is required for custom (non-Anthropic) channel plugins.

## Configuration

### MCP Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINECRAFT_CHANNEL_PORT` | `25589` | HTTP server port |
| `MINECRAFT_CONTAINER_FILTER` | `name=minecraft` | Docker container filter for RCON |

### Plugin config.yml

| Parameter | Default | Description |
|-----------|---------|-------------|
| `mcp-server-url` | `http://YOUR_HOST_IP:25589` | MCP server URL on the host |
| `timeout-ms` | `3000` | HTTP timeout |
| `rate-limit-count` | `3` | Max messages per period |
| `rate-limit-period` | `30` | Period in seconds |
| `allowed-players` | `[]` | Empty = everyone allowed |

## Gotchas

- **Channel allowlist:** Custom channels require `--dangerously-load-development-channels` flag — without it Claude Code shows "not on the approved channels allowlist" and silently drops notifications.
- **Plugin reload:** The Paper plugin reads config on startup only. Server restart required after config changes.

## License

MIT
