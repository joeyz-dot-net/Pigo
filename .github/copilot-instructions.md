# ClubMusic — Copilot Instructions (concise)

Purpose: Help AI coding agents become productive quickly in this repository.

Last updated: 2025-12-30

Key architecture
- Single-process server: Browser (ES6 static files) ↔ FastAPI app (`app.py`) ↔ in-process singletons (`PLAYER`, `PLAYLISTS_MANAGER`) ↔ MPV via IPC pipe (`\\.\\pipe\\mpv-pipe`).
- Frontend <-> backend contract is thin and explicit: UI calls endpoints in `app.py`; the frontend wrapper is [static/js/api.js](static/js/api.js).

Critical rules (must follow)
- Keep API parity: any route/method/payload changed in [app.py](app.py) must be mirrored in [static/js/api.js](static/js/api.js). Mismatches are the most common silent bug.
- Payload type conventions:
  - Player-control endpoints use FormData and `await request.form()` (examples: `/play`, `/seek`, `/volume`, `/playlist_remove`, `/playlists/{id}/add_next`).
  - CRUD/search endpoints use JSON and `await request.json()` (examples: `POST /playlists`, `/playlist_reorder`, `/search_song`, `/play_youtube_playlist`).
- Use the global singletons from `app.py` (do NOT create new `MusicPlayer`/`Playlists`). Examples: `PLAYER = MusicPlayer.initialize(...)`, `PLAYLISTS_MANAGER = Playlists()`.
- Always call `PLAYLISTS_MANAGER.save()` after mutating playlists.
- Never delete or rename the `default` playlist — code assumes `DEFAULT_PLAYLIST_ID = "default"`.

Project-specific patterns & gotchas
- UTF-8 stdout wrapper: entry modules and `models/__init__.py` rewrap stdout for Windows — preserve this when adding CLI entrypoints.
- PyInstaller resource helper: use `_get_resource_path()` in `app.py` to access bundled assets; handle `sys._MEIPASS`.
- Playback model: backend controls auto-next and auto-fill.
  - See `app.py:auto_fill_and_play_if_idle()` — it may append network (YouTube/stream) items into the default playlist and call `PLAYER.play()`.
- Indexing and current track: `PLAYER.current_index` and `PLAYER.current_meta` are used across controllers — update `current_index` only via existing helpers or API-consistent code paths.
- Thumbnail generation for YouTube: code extracts video id and uses `https://img.youtube.com/vi/{id}/default.jpg` when missing.

Where to look first (high-value files)
- Routing & singletons: [app.py](app.py)
- MPV and playback logic: [models/player.py](models/player.py)
- Playlist model & persistence: [models/playlists.py](models/playlists.py) and `playlists.json`
- Song metadata & yt-dlp helpers: [models/song.py](models/song.py)
- Frontend API wrapper: [static/js/api.js](static/js/api.js) (mirror changes here)
- i18n strings: [static/js/i18n.js](static/js/i18n.js) — add both `zh` and `en` keys when adding UI text.
- Runtime configs: [settings.ini](settings.ini)

Developer workflows (quick)
- Dev server (interactive audio device selection): `python main.py` or `python app.py` (uvicorn run present).
- Build Windows exe: run `build_exe.bat` (workspace task "Build").
- Tests: check `test/` for small utilities; run targeted tests manually as needed.

PR checklist (include in PR description)
- List exact route/method/payload changes and updated frontend calls in `static/js/api.js`.
- If playlist/song dict fields changed, describe migration and update `playlists.json` if needed.
- Note any changes to `PLAYER` or `PLAYLISTS_MANAGER` usage and why duplicating singletons was avoided.

If anything is unclear, point me to the file or endpoint you want modified and I will produce a minimal, safe patch.

Please review this and tell me which areas to expand (examples, specific endpoints, or developer scripts).
# ClubMusic AI Agent Guide

**Full-stack web music player**: FastAPI + ES6 modules + MPV IPC engine.  
**Key distinction**: Bilingual (zh/en), user-isolation via localStorage, multi-singleton architecture, Windows/PyInstaller-optimized.

> **Last Updated**: 2025-12-27 | **Focus**: Production-ready patterns, user-isolation architecture, ES6 module state management, backend event listening

## ⚠️ Critical Rules (Must-Know)

| Rule | Impact & Example |
|------|---------|
| **API Sync** | Backend [app.py](../app.py) + Frontend [static/js/api.js](../static/js/api.js) must match exactly. New route? Update BOTH. Field rename? Check both files. Missing sync = silent failures. |
| **FormData vs JSON** | **Player control** (`/play`, `/seek`, `/volume`, `/playlist_remove`): `await request.form()`. **Data CRUD** (`/playlists`, `/playlist_reorder`, `/search_song`): `await request.json()`. Wrong type = "form required" errors. |
| **POST vs PUT vs DELETE** | **Creating**: POST `/playlists`. **Updating**: PUT `/playlists/{id}`. **Removing**: DELETE `/playlists/{id}`. Follow REST semantics strictly for frontend routing. |
| **Global Singletons** | `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` initialized in [app.py#L70-80](../app.py). Access directly—never create new instances. State corruption if duplicated. |
| **Config Reload** | [settings.ini](../settings.ini) parsed once at startup. Audio device change? Music dir? **Requires restart** `python main.py`. |
| **UTF-8 Windows** | Every `.py` entry point needs UTF-8 wrapper (see [models/__init__.py#L6-11](../models/__init__.py)). Chinese chars garbled = missing wrapper. |
| **i18n Sync** | Always add BOTH `zh` and `en` keys in [static/js/i18n.js](../static/js/i18n.js). Missing lang = undefined UI text. |
| **Persistence** | Call `PLAYLISTS_MANAGER.save()` after ANY playlist modification. Forgetting it = data loss. |
| **User Isolation** | Playlist selection in browser `localStorage` (`selectedPlaylistId`), NOT backend global state. Each browser/tab independent. |
| **PyInstaller Paths** | External tools (`mpv.exe`, `yt-dlp.exe`) live next to exe. Bundled assets (`static/`, `templates/`) in temp `_MEIPASS` dir. |
| **Singleton Pattern** | Use `MusicPlayer.initialize()` classmethod, not `__init__()`. Returns cached instance across app lifetime. |

## Architecture

```
Browser ←poll /status→ FastAPI (app.py) ←→ Singletons ←→ MPV (\\.\pipe\mpv-pipe)
   │                         │                              ↑
   ├── ES6 modules ──────────┴── models/*.py               │
   └── localStorage                  └─ Backend event listener (detects end-file)
       (selectedPlaylistId,                 └─ Auto-deletes current song + plays next
        theme, language)                       (NO frontend intervention needed)
                                    └── playlists.json, playback_history.json
````instructions
# ClubMusic AI Agent Guide

Concise, actionable instructions for AI coding agents working on ClubMusic (FastAPI backend + ES6 frontend + MPV IPC).

Last updated: 2025-12-29

## Critical Rules (must follow)
- API surface parity: update both `app.py` and `static/js/api.js` for any endpoint changes (method, payload type, field names).
- Form vs JSON: Player-control endpoints use FormData (`/play`, `/seek`, `/volume`, `/playlist_remove`); CRUD/search endpoints use JSON (`/playlists`, `/playlist_reorder`, `/search_song`).
- Singletons: use the global `PLAYER = MusicPlayer.initialize()` and `PLAYLISTS_MANAGER` from `app.py` — do not instantiate duplicates.
- Persistence: call `PLAYLISTS_MANAGER.save()` after any playlist mutation so `playlists.json` is updated.

## Architecture & Dataflow (short)
- Browser ↔ FastAPI (`/status` polls every ~1s) ↔ Singletons ↔ MPV IPC (pipe: `\\.\pipe\mpv-pipe`).
- Auto-next is 100% backend-controlled: `models/player.py` listens for MPV `end-file` and runs `handle_playback_end()` (deletes current item, plays next). Frontend only reflects `/status`.
- Playlist selection is client-local: `localStorage.selectedPlaylistId` determines UI; backend only validates via `/playlists/{id}/switch`.

## Project-specific patterns & gotchas
- UTF-8 wrappers: entry scripts set stdout encoding for Windows (see `models/__init__.py`). Keep that pattern when adding CLI entrypoints.
- MPV startup: `main.py` interactively selects audio device and updates `mpv_cmd`. During runtime the environment var `MPV_AUDIO_DEVICE` may be used.
- yt-dlp integration: `models/song.py` and `models/player.py` call `yt-dlp` (prefer `bin/yt-dlp.exe` when present).
- Event-driven auto-fill: `app.py:auto_fill_and_play_if_idle()` can auto-fill default playlist after idle; review before changing default-queue behavior.

## Developer workflows (quick)
- Run dev server (interactive device select):
  ```powershell
  ClubMusic — Copilot instructions (concise)

  Purpose
  - Quick, actionable guidance for AI coding agents contributing to ClubMusic (FastAPI backend + ES6 frontend + MPV IPC on Windows).

  Key architecture (one-line)
  - Browser polls `/status` → FastAPI (`app.py`) → in-process singletons (`PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER`) → MPV via IPC (`\\.\pipe\mpv-pipe`).

  Critical rules (must follow)
  - API parity: always update both `app.py` and `static/js/api.js` when changing an endpoint (method, payload type or field names).
  - Payload types: Player-control endpoints expect FormData (use `request.form()`): `/play`, `/seek`, `/volume`, `/playlist_remove`, `/playlists/{id}/add_next`, etc. CRUD/search endpoints expect JSON (`request.json()`): `/playlists` (create), `/playlist_reorder`, `/search_song`, `/play_youtube_playlist`.
  - Singletons: use the global instances exported/created in `app.py` — `PLAYER = MusicPlayer.initialize(data_dir=".")`, `PLAYLISTS_MANAGER = Playlists()`; do NOT instantiate additional MusicPlayer/Playlists objects.
  - Persistence: call `PLAYLISTS_MANAGER.save()` after any playlist mutation to persist `playlists.json`.
  - Entrypoint pattern: use `MusicPlayer.initialize()` (not `__init__()`) and keep the UTF-8 stdout wrapper used in `models/__init__.py` for Windows.

  Important files to read/modify
  - `app.py` — central routing, singletons, auto-fill thread, MPV wrappers (`mpv_command`, `mpv_get`).
  - `models/player.py` — MPV lifecycle, play/stop/loop, playback history add, end-file handling.
  - `models/playlists.py` and `playlists.json` — playlist model & persistence; `PLAYLISTS_MANAGER.save()` required.
  - `models/song.py` — StreamSong / LocalSong helpers and `yt-dlp` wrappers.
  - `static/js/api.js` — frontend API glue; shows which endpoints use FormData vs JSON. Keep it in sync with `app.py`.
  - `static/js/i18n.js` — confirm both `zh` and `en` translations are present when adding UI strings.
  - `settings.ini` — runtime configuration (music_dir, bin_dir, mpv_cmd, allowed_extensions, local/youtube search limits).

  Build & run (developer commands)
  - Dev server (interactive audio-device selection):
  ```powershell
  python main.py
  ```
  - Run directly (app exports uvicorn in __main__):
  ```powershell
  python app.py
  ```
  - Build Windows executable (PyInstaller wrapper):
  ```powershell
  .\build_exe.bat
  ```

  Conventions and gotchas (project-specific)
  - MPV and helpers live under `bin/` (e.g., `bin\\mpv.exe`, `bin\\yt-dlp.exe`) — PyInstaller bundles assets into `_MEIPASS` at runtime; use `_get_resource_path()` in `app.py` when referencing static assets.
  - Default playlist ID: `default`. Do not delete it. Many routines (auto-fill, playlist APIs) assume a `default` playlist exists.
  - User-isolation: frontend stores selected playlist in localStorage; backend `playlists/{id}/switch` only validates existence and does NOT change server global state.
  - Auto-fill behavior: `app.py:auto_fill_and_play_if_idle()` runs in a background thread and may add network (YouTube/stream) items to the default playlist; be careful when changing queue semantics.
  - Cover retrieval: use `/cover/{file_path:path}` which prefers embedded cover bytes, then directory cover files, then placeholder.

  Quick examples (copyable)
  - Play from frontend (FormData): see `static/js/api.js` → `play()` uses `postForm('/play', formData)`.
  - Add to playlist as JSON: `POST /playlist_add` with `{ playlist_id, song: {url,title,type}, insert_index? }` (frontend calls `addToPlaylist`).
  - Reorder playlist (JSON): `POST /playlist_reorder` with `{ playlist_id, from_index, to_index }`.

  If you modify endpoints, list exact changes in the PR description and update `static/js/api.js` and any frontend callers. Ask for manual verification when changes affect MPV args, device selection or `settings.ini` keys.

  Questions / feedback
  - I updated [.github/copilot-instructions.md](.github/copilot-instructions.md). Tell me if you want more examples (route+payload snippets), add CI/test commands, or include contributor conventions (commit message style, PR checks).