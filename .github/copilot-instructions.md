# ClubMusic — Copilot Instructions (concise)

Purpose: quickly orient AI coding agents to become productive in this repository.

Last Updated: 2025-12-30

Summary
- Full-stack single-process app: Browser (ES6 static files) ↔ FastAPI (`app.py`) ↔ in-process singletons in `app.py` (e.g. `PLAYER`, `PLAYLISTS_MANAGER`) ↔ MPV via IPC (`\\.\\pipe\\mpv-pipe`).
- Frontend static code lives under `static/js/*` and calls backend endpoints in `app.py` (see `static/js/api.js`).

Critical rules (must follow)
- API parity: any change to routes/payloads in `app.py` must be mirrored in `static/js/api.js` (method & payload type). Failure here is the most common silent bug.
- FormData vs JSON: player-control endpoints use FormData (`request.form()`): `/play`, `/seek`, `/volume`, `/playlist_remove`, `/playlists/{id}/add_next`.
- CRUD/search endpoints use JSON (`request.json()`): `/playlists` (create), `/playlist_reorder`, `/search_song`, `/play_youtube_playlist`.
- Singletons: use the global instances created in `app.py` (e.g. `PLAYER = MusicPlayer.initialize(...)`, `PLAYLISTS_MANAGER = Playlists()`). Do NOT instantiate duplicate players/managers.
- Persistence: always call `PLAYLISTS_MANAGER.save()` after mutating playlists (many APIs already do this).
- Default playlist: `default` must exist; do not delete it. Code assumes it in several places.
- UTF-8 stdout wrapper: entry modules and `models/__init__.py` configure stdout for Windows — preserve this pattern when adding entry scripts.
- PyInstaller resources: use `_get_resource_path()` in `app.py` and handle `sys._MEIPASS` when referencing bundled assets or `bin/` tools.

Where important behavior lives
- HTTP routing & singletons: [app.py](app.py)
- MPV integration, playback, history: [models/player.py](models/player.py)
- Playlist model & persistence: [models/playlists.py](models/playlists.py) and `playlists.json`
- Song metadata, yt-dlp helpers: [models/song.py](models/song.py)
- Frontend API wrapper: [static/js/api.js](static/js/api.js)
- i18n: [static/js/i18n.js](static/js/i18n.js) — add both `zh` and `en` keys for new UI text.
- Runtime settings: [settings.ini](settings.ini)

Developer workflows
- Run dev server (interactive audio device selection):
  - `python main.py` or `python app.py` (uvicorn run is in `__main__` block)
- Build Windows exe: run `build_exe.bat` (task in workspace: "Build").
- Logs & noisy endpoints: `settings.ini` contains logging controls (`filtered_paths`, `polling_sample_rate`). `/status` is polled frequently by the frontend.

Conventions & gotchas
- Playlist selection is client-local (localStorage `selectedPlaylistId`). Backend `playlists/{id}/switch` only validates existence and does NOT change server global playlist state.
- Auto-fill is backend-driven: `app.py:auto_fill_and_play_if_idle()` may mutate `default` playlist and call `PLAYER.play()`.
- When adding YouTube items, code often auto-generates thumbnails using the video id pattern — follow the same approach.
- Avoid mutating `PLAYER` or `PLAYLISTS_MANAGER` state incorrectly — prefer existing helper APIs (e.g., `playlist.add_song` or `PLAYLISTS_MANAGER` methods).

PR guidance
- If you change an endpoint, list the exact route/method/payload changes in the PR and update `static/js/api.js` and any frontend callers.
- When changing persistence shape (playlist/song dict fields), update `playlists.json` migration notes in the PR.

If you're missing something
- Ask for the intended user flow or point to the exact file you want to change; I will audit usages and produce a minimal patch and tests where applicable.

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