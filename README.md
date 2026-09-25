# Hestia

**A desktop harness for local open-weights models — built for everyday office work.**

Hestia connects a local language model with what you actually need at the office:
chat, documents (PDF, Word, Markdown), projects with their own knowledge, a memory,
web search, and a work mode that reads and writes files in a folder you share with
it. None of it needs the cloud: the models run on your own machine, and your data
stays there.

The project is under continuous development.

Developed by **ScaleWise** — [www.scalewise-ai.de](https://www.scalewise-ai.de)

The name: **Hestia** is the Greek goddess of the hearth and home.

## Origin

Hestia was developed with a local open-weights model: **Qwen3.8 Flash-Next** —
from the first line of code to the complete, working app, entirely on a local
machine. The app runs on the same system in daily use:

| | |
| --- | --- |
| Machine | GEEKOM A9 Mega |
| CPU | AMD Ryzen AI MAX+ 395 (16 cores / 32 threads) |
| GPU | Radeon 8060S (integrated, Vulkan) |
| Memory | 128 GB unified memory |
| OS | Ubuntu 26.04 LTS |
| Main model | **Qwen3.8 Flash-Next** (open weights), via llama.cpp or Ollama |
| Speed | **17–35 tokens/s** when generating, depending on context length and task |

Other models work just as well — anything served by Ollama or an OpenAI-compatible
server (`/v1`, e.g. llama.cpp / llama-swap).

## Features

**Conversations**
- Chat with streamed answers, visible reasoning and Markdown
- Regenerate answers, edit your own messages, browse between versions
- Attachments by pasting or dragging: images, PDF, Word, text
- Reasoning level per model (off, low, medium, high) with a real thinking budget
- Search past chats — the model can draw on them

**Documents**
- Create PDF, Word and Markdown files straight from the chat
- Keep editing them in the conversation: "add another line", "make it look more
  modern", "undo the last change" — every version is kept
- Templates: plain document, letter (cover letters are detected), report, book
- Preview next to the conversation, PDFs page by page

**Projects and memory**
- Projects with their own instructions and files (e.g. a CV for job applications)
- Memory: general and per project, kept separate, always visible and deletable

**Agent mode (working in a folder)**
- The model reads, searches, writes and edits files in a folder you share
- Access levels: ask every time, allow writes, allow everything
- Tool steps shown as a traceable timeline

**Research**
- Web search and page reading in normal chat, plus a more thorough research mode
- Private network addresses are blocked for the tools

**More**
- Scheduled tasks (once, daily, weekly, at intervals)
- Skills in the open `SKILL.md` format
- Artifacts, full-text search, keyboard shortcuts, light and dark theme
- Access from a phone or a second computer on your home network (QR code)
- Dictation via a locally installed Whisper / whisper.cpp / Parakeet
- Interface in German and English

## Security — please read

- **Agent mode can run commands if you allow it.** Paths are confined to the shared
  folder (realpath checks against `..` and symlinks), but commands themselves are
  not sandboxed. The approval prompt is the safety layer — only choose "allow
  everything" deliberately.
- **Remote access uses unencrypted HTTP** on the local network, with an access code
  in the URL that does not expire. It is meant for your own home network, not for
  public Wi-Fi. If the port is published with `tailscale serve`, Hestia shows the
  HTTPS address in your tailnet instead. You can generate a new code at any time
  under "Remote".

## Requirements

- Linux (developed on Ubuntu 26.04, GNOME/Wayland), Node ≥ 22, pnpm
- A model provider, e.g. [Ollama](https://ollama.com) at `http://127.0.0.1:11434`
  or an OpenAI-compatible server

## Development

```bash
pnpm install
pnpm dev                 # development with hot reload
```

Without hot reload (the way the app ships):

```bash
pnpm build
./node_modules/.bin/electron . --no-sandbox
```

`--no-sandbox` is needed if `chrome-sandbox` is not installed setuid.

## Checks

```bash
pnpm typecheck           # main and renderer checked separately, strict
pnpm test                # Vitest
pnpm lint
node tests/e2e/drive.mjs <devtools-port>   # UI checks via the DevTools protocol
```

App state lives in `~/.config/hestiadesk` (database `hestia.db`, log).

## Build

```bash
pnpm dist:linux          # → release/hestiadesk_<version>_amd64.deb
                         # → release/Hestia-<version>.AppImage
```

## Structure

```
src/
  main/            main process (Electron)
    providers/     providers: Ollama, OpenAI-compatible, registry
    agent/         agent mode: sandbox, tools, approvals
    documents/     PDF, Word and Markdown generation
    chat.ts        run loop with tool calls
    db.ts          SQLite (node:sqlite) with migrations
    ipc.ts         IPC contract, inputs validated with zod
  preload/         contextBridge → window.desk
  renderer/        React UI
  shared/          types, IPC channels, branding.ts
```

Custom branding: [`src/shared/branding.ts`](src/shared/branding.ts)
(display name, app ID, accent color, greeting).

## License

MIT — see [LICENSE.txt](LICENSE.txt). © 2026 [ScaleWise](https://www.scalewise-ai.de)
