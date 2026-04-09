# Minecraft Channel for Claude Code

[English version](README_EN.md)

---

Двусторонний канал между Minecraft и Claude Code — игроки общаются с Claude AI прямо из игрового чата.

## Проблема

Дети, играющие в Minecraft на телефоне (Bedrock через Geyser), не могут переключиться в Telegram для общения с Claude — игра вылетает. Нужен способ общаться с Claude, не выходя из Minecraft.

## Решение

Двухкомпонентная система:

1. **Paper плагин** внутри Minecraft сервера перехватывает команду `/claude <сообщение>` и отправляет HTTP POST на хост
2. **MCP channel server** на хосте пушит сообщение в Claude Code как channel notification
3. Claude отвечает обратно через RCON `tellraw`

## Архитектура

```
Игрок: /claude привет!
        │
   Paper плагин (Java, в Docker)
   HTTP POST → хост:25589/message
        │
   MCP Channel Server (Bun, на хосте)
   mcp.notification("notifications/claude/channel")
        │
   Claude Code получает:
   <channel source="minecraft" player="Steve">привет!</channel>
        │
   Claude вызывает tool reply
        │
   MCP-сервер → RCON tellraw
        │
   [Claude] ответ в игровом чате
```

## Компоненты

### 1. MCP Channel Server (`external_plugins/minecraft/`)

Bun/TypeScript MCP-сервер:
- HTTP-сервер на порту 25589, принимает POST `/message` от плагина
- Пушит `notifications/claude/channel` в Claude Code
- Tool `reply` — отправляет `tellraw` через RCON
- Tool `run_command` — выполняет любую серверную команду

### 2. Paper плагин (`paper-plugin/`)

Java Paper/Bukkit плагин:
- Команда `/claude <сообщение>`
- Асинхронный HTTP POST на MCP-сервер
- Rate limit: 3 сообщения за 30 секунд
- Allowlist игроков в `config.yml`

## Установка

### Требования

- Minecraft Paper сервер (1.21+) в Docker
- [Bun](https://bun.sh) на хосте
- [Claude Code](https://claude.ai/claude-code) CLI
- Доступ к `sudo docker exec` для RCON

### Шаг 1: Добавить marketplace

```bash
claude plugin marketplace add kzmx23/minecraft-claude-plugin
```

### Шаг 2: Установить плагин

```bash
claude plugin install minecraft@minecraft-claude-plugin
```

### Шаг 3: Собрать Paper плагин

```bash
cd paper-plugin
docker run --rm -v .:/build -w /build maven:3-eclipse-temurin-21 mvn package -q
# Скопировать ClaudeChat-1.0.jar в plugins/ директорию Minecraft сервера
```

### Шаг 4: Настроить

Отредактировать `plugins/ClaudeChat/config.yml` на сервере:

```yaml
mcp-server-url: "http://IP_ХОСТА:25589"
timeout-ms: 3000
rate-limit-count: 3
rate-limit-period: 30
allowed-players:
  - PlayerName1
  - PlayerName2
```

### Шаг 5: Запустить Claude Code

```bash
claude --dangerously-skip-permissions \
  --dangerously-load-development-channels plugin:minecraft@minecraft-claude-plugin
```

> `--dangerously-load-development-channels` обязателен для кастомных (не от Anthropic) channel-плагинов.

## Конфигурация

### Переменные окружения MCP-сервера

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `MINECRAFT_CHANNEL_PORT` | `25589` | Порт HTTP-сервера |
| `MINECRAFT_CONTAINER_FILTER` | `name=minecraft` | Фильтр Docker-контейнера для RCON |

### config.yml плагина

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `mcp-server-url` | `http://YOUR_HOST_IP:25589` | URL MCP-сервера на хосте |
| `timeout-ms` | `3000` | Таймаут HTTP |
| `rate-limit-count` | `3` | Макс сообщений за период |
| `rate-limit-period` | `30` | Период в секундах |
| `allowed-players` | `[]` | Пустой = все могут использовать |

## Подводные камни

- **Channel allowlist:** Кастомные каналы требуют флаг `--dangerously-load-development-channels` — без него Claude Code показывает "not on the approved channels allowlist" и тихо дропает notifications.
- **Перезагрузка плагина:** Paper плагин читает конфиг только при запуске. После изменений нужен рестарт сервера.

## Лицензия

MIT
