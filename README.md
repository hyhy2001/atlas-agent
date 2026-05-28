# atlas-agent

AI Coding Assistant CLI cho team nội bộ — giống Claude Code nhưng dùng API proxy của công ty.

## Tính năng

- Leader/executor architecture: model mạnh plan, model rẻ execute
- 33 tools: file, shell, git, web, MCP code intelligence
- Subagents: atlas-mech, atlas-coder, atlas-rescue
- Session persistence, memory, telemetry
- Portable: không cần root, không ghi ra home dir
- Multi-platform: Linux, macOS, Windows

## Cài đặt

### Yêu cầu

- Node.js >= 20: https://nodejs.org
- Bun: https://bun.sh (chạy `curl -fsSL https://bun.sh/install | bash`)
- Git

### Clone và install

```bash
git clone https://github.com/hyhy2001/atlas-agent.git
cd atlas-agent
make install
```

`make install` sẽ tự động:
1. Kiểm tra Node.js và Bun (tự download vào `./deps/` nếu chưa có)
2. Cài npm dependencies
3. Build TypeScript
4. Compile binary cho OS hiện tại
5. Symlink vào `~/.local/bin/atlas-agent`

### Cấu hình

Lần đầu chạy `atlas-agent`, sẽ hiện màn hình login:

```
╔══════════════════════════════════════╗
║        Welcome to atlas-agent        ║
╚══════════════════════════════════════╝

  1. API Key + Base URL
  2. [Coming soon] OAuth
  3. [Coming soon] Enterprise SSO

Select [1]: 1
Base URL: http://your-proxy:port/v1
API Key: sk-...
Save to config/settings.json? [Y/n]: y
```

Hoặc set env vars:
```bash
export ATLAS_AUTH_TOKEN="your-token"
export ATLAS_BASE_URL="http://your-proxy:port/v1"
```

### Model configuration

```bash
export ATLAS_MODEL="all"              # Main model (leader)
export ATLAS_FAST_MODEL="all"         # Fast model (atlas-coder, atlas-mech)
export ATLAS_REASONING_MODEL="all"    # Reasoning model (atlas-rescue)
```

## Sử dụng

```bash
atlas-agent                          # Interactive REPL
atlas-agent -p "review src/main.py"  # Headless one-shot
atlas-agent --continue               # Resume last session
atlas-agent --plan                   # Start in plan mode
```

## Commands trong REPL

| Command | Mô tả |
|---------|-------|
| `/help` | Xem tất cả commands |
| `/plan` | Chế độ read-only (chỉ phân tích) |
| `/execute` | Thoát plan mode |
| `/agent <name>` | Gọi subagent cụ thể |
| `/agents` | Xem danh sách subagents |
| `/diff` | Xem git diff |
| `/undo` | Hoàn tác thay đổi cuối |
| `/cost` | Xem token usage |
| `/stats` | Xem session statistics |
| `/model <name>` | Đổi model |
| `/doctor` | Kiểm tra setup |
| `/init` | Generate ATLAS.md cho project |
| `/compact` | Nén conversation history |
| `/save` | Lưu session |
| `/sessions` | Xem sessions đã lưu |

## Custom commands

Tạo file `.atlas/commands/ten-command.md`:

```markdown
---
name: review-rtl
description: Review RTL code
---

Review Verilog/SystemVerilog files for synthesis issues...
```

Dùng: `/review-rtl src/top.sv`

## Project context

Tạo `ATLAS.md` ở root project để agent tự load context:

```bash
atlas-agent
> /init   # tự generate ATLAS.md
```

## Hooks

Tạo `.atlas/settings.json`:

```json
{
  "allowedTools": ["bash", "edit_file", "write_file"],
  "hooks": {
    "PostToolUse": [
      { "matcher": "edit_file", "command": "npx prettier --write $TOOL_PATH" }
    ]
  }
}
```

## Build từ source

```bash
make build          # TypeScript only
make build-all      # Tất cả 5 platforms
make test           # Chạy tests
make clean          # Dọn dẹp
make clean-all      # Dọn dẹp kể cả deps/
```

## Cấu trúc thư mục (portable)

```
atlas-agent/
├── atlas-agent         Binary
├── config/
│   └── settings.json   Config
├── sessions/           Conversation history
├── telemetry/          Usage stats
├── cache/              MCP knowledge graph
├── bin/                codebase-memory-mcp
└── .atlas/
    ├── memory/         Persistent memory
    ├── commands/       Custom commands
    └── agents/         Custom subagents
```
