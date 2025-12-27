# ClubMusic AI Agent Guide

Bilingual (zh/en) web music player: **FastAPI** + **ES6 modules** + **MPV audio engine** + **WebRTC/HTTP browser streaming**.

## ⚠️ Critical Rules

| Rule | Details |
|------|---------|
| **API Sync** | Route changes require updating BOTH [app.py](../app.py) AND [static/js/api.js](../static/js/api.js)—field names must match exactly |
| **FormData vs JSON** | Player routes (`/play`, `/seek`, `/volume`, `/playlist_remove`, `/search_youtube`) use `await request.form()`; CRUD routes (`/playlists`, `/playlist_reorder`, `/search_song`) use `await request.json()` |
| **Global Singletons** | Use `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` directly ([app.py#L70-80](../app.py))—never instantiate new |
| **Config Reload** | `settings.ini` is cached at startup—restart `python main.py` for changes |
| **UTF-8 Windows** | Every Python entry point needs UTF-8 stdout wrapper (see [models/__init__.py#L6-11](../models/__init__.py)) |
| **i18n Sync** | Add strings to BOTH `zh` and `en` objects in [static/js/i18n.js](../static/js/i18n.js) |
| **Persistence** | Call `PLAYLISTS_MANAGER.save()` after any playlist modification |
| **User Isolation** | Playlist selection stored in browser `localStorage` (`selectedPlaylistId`), not backend global state |
| **PyInstaller Paths** | External tools (`mpv.exe`, `yt-dlp.exe`) → `sys.executable` dir; bundled resources → `sys._MEIPASS` |
| **Singleton Pattern** | Use `MusicPlayer.initialize()` not constructor; returns cached instance |

## Architecture

```
Browser ←poll /status→ FastAPI (app.py) ←→ Singletons ←→ MPV (\\.\pipe\mpv-pipe)
   │                         │
   ├── ES6 modules ──────────┴── models/*.py (Song, Playlist, Player, Rank)
   ├── WebRTC signaling (/ws/signaling) ←→ models/webrtc.py (sounddevice + aiortc)
   └── localStorage (selectedPlaylistId, streamFormat, theme, language)
                                    └── playlists.json, playback_history.json
```

### Data Flow: Playback
1. User clicks song → `player.js:play()` → `api.js:play()` → POST `/play`
2. Backend: `app.py` → `PLAYER.play(song)` → MPV IPC `loadfile` command
3. Frontend polls `/status` every 2s → updates UI via `player.js:updateStatus()`
4. Auto-next: When `timeRemaining < 2.5s`, `main.js` triggers next song

### Data Flow: WebRTC Streaming
1. User enables streaming → `player.js:startBrowserStream()` → WebSocket `/ws/signaling`
2. Backend: `webrtc.py:VirtualAudioTrack` captures from VB-Cable via `sounddevice`
3. aiortc creates peer connection, sends audio track to browser
4. Fallback: If WebRTC fails, degrades to HTTP streaming

### Key Files & Responsibilities

| File | Purpose |
|------|---------|
| [main.py](../main.py) | Uvicorn startup, interactive audio device selection (MPV output + WebRTC input) |
| [app.py](../app.py) | 60+ routes, global singletons, WebSocket `/ws/signaling` for WebRTC |
| [models/player.py](../models/player.py) | `MusicPlayer` class: MPV IPC via `\\.\pipe\mpv-pipe`, config loading, yt-dlp integration |
| [models/webrtc.py](../models/webrtc.py) | `VirtualAudioTrack`: sounddevice audio capture, aiortc WebRTC signaling |
| [models/playlists.py](../models/playlists.py) | `Playlists` manager: multi-playlist CRUD, auto-save to `playlists.json` |
| [models/song.py](../models/song.py) | `Song`, `LocalSong`, `StreamSong`; YouTube metadata/search via yt-dlp |
| [static/js/api.js](../static/js/api.js) | `MusicAPI` class—**must mirror backend routes exactly** |
| [static/js/main.js](../static/js/main.js) | `MusicPlayerApp`: init sequence, status polling, auto-next logic |
| [static/js/playlist.js](../static/js/playlist.js) | `PlaylistManager`: frontend playlist state, `localStorage` persistence |
| [static/js/webrtc.js](../static/js/webrtc.js) | WebRTC client signaling, peer connection management |
| [static/js/i18n.js](../static/js/i18n.js) | Translations—always add both `zh` and `en` keys |

## Adding a New Feature

### 1. Backend Route ([app.py](../app.py))
```python
@app.post("/my-endpoint")
async def my_endpoint(request: Request):
    # Choose ONE based on frontend call pattern:
    form = await request.form()       # For FormData (simple values)
    # data = await request.json()     # For JSON (complex objects)
    
    result = PLAYER.some_method()     # Use global singleton
    PLAYLISTS_MANAGER.save()          # Persist if modified
    return {"status": "OK", "data": result}
```

### 2. Frontend API ([static/js/api.js](../static/js/api.js))
```javascript
// Add method to MusicAPI class - match backend data format exactly
async myEndpoint(value) {
    const formData = new FormData();
    formData.append('value', value);
    return this.postForm('/my-endpoint', formData);
    // OR: return this.post('/my-endpoint', { value });  // for JSON
}
```

### 3. i18n ([static/js/i18n.js](../static/js/i18n.js))
```javascript
zh: { 'myFeature.label': '我的功能' },
en: { 'myFeature.label': 'My Feature' }
```

## PyInstaller Path Patterns

```python
# External executables (mpv.exe, yt-dlp.exe) → exe directory
if getattr(sys, 'frozen', False):
    app_dir = os.path.dirname(sys.executable)
else:
    app_dir = os.path.dirname(os.path.abspath(__file__))

# Bundled resources (templates/, static/) → _MEIPASS temp dir
if getattr(sys, 'frozen', False):
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
else:
    base_path = os.path.dirname(os.path.abspath(__file__))
```

## Data Files

| File | Schema |
|------|--------|
| [settings.ini](../settings.ini) | `[app]` music_dir, mpv_cmd (with WASAPI device GUID), enable_stream, startup_timeout; `[logging]` level |
| `playlists.json` | `{"order": [...], "playlists": [{id, name, songs: [{url, title, type, thumbnail_url?}], created_at, updated_at}]}` |
| `playback_history.json` | `[{url, title, type, timestamps, thumbnail_url}]` for ranking |

## Development Commands

```powershell
python main.py              # Start server (interactive audio device selection)
.\build_exe.bat             # Build to dist/ClubMusic.exe via PyInstaller (reads app.spec)
Get-Process mpv             # Verify MPV is running
Test-Path "\\.\pipe\mpv-pipe"  # Verify MPV IPC pipe exists
```

### VS Code Tasks (`.vscode/tasks.json`)
Available via `Ctrl+Shift+B` or Terminal → Run Task:
- **Build Only** - PyInstaller build to `dist/ClubMusic.exe` (no deployment)
- **Deploy to B560** - Copy exe to `\\b560\code\ClubMusic` (network share)
- **Deploy to Local** - Copy exe to `D:\Code\ClubMusic-Deploy`
- **Build & Deploy to All** - Sequential: build → B560 → local
- **Clean Build** - Remove `build/`, `dist/`, `__pycache__/` before building
- **启动音乐播放器** - Launch dev server (`python main.py`)
- **安装依赖** - `pip install -r requirements.txt`

## Debugging Tips

| Symptom | Cause & Fix |
|---------|-------------|
| Settings not applied | INI cached at startup—restart server |
| No audio output | Check `mpv_cmd` audio-device GUID in [settings.ini](../settings.ini) |
| Chinese text garbled | Add UTF-8 stdout wrapper at Python entry point |
| YouTube 403 errors | Update `bin/yt-dlp.exe` to latest version |
| Frontend API fails | Verify FormData vs JSON matches backend `request.form()` vs `request.json()` |
| WebRTC no audio | Ensure VB-Cable installed, check `WEBRTC_AUDIO_DEVICE` env var |
| Playlist not syncing | Check `localStorage.selectedPlaylistId`, each browser is independent |

## Frontend Module System

ES6 modules in [static/js/](../static/js/):
- **Entry**: [main.js](../static/js/main.js) → imports all modules, `MusicPlayerApp` class
- **Core**: `api.js` (HTTP), `player.js` (playback + WebRTC), `playlist.js` (queue state)
- **Features**: `search.js`, `ranking.js`, `local.js`, `playlists-management.js`
- **Streaming**: `stream.js`, `webrtc.js` (signaling client)
- **UI**: `ui.js` (Toast, loading), `themeManager.js`, `navManager.js`, `settingsManager.js`
- **State**: `localStorage` keys: `selectedPlaylistId`, `streamFormat`, `theme`, `language`, `streamActive`

## Backend Model Hierarchy

[models/__init__.py](../models/__init__.py) exports all models:
- `Song`, `LocalSong`, `StreamSong` – song data classes with `play()` methods
- `Playlist`, `Playlists` – playlist management with JSON persistence
- `MusicPlayer` – MPV control singleton (IPC, volume, seek, playback, yt-dlp)
- `HitRank`, `PlayHistory` – play count tracking for ranking feature
- `VirtualAudioTrack` (webrtc.py) – sounddevice audio capture for WebRTC

## Audio Device Selection (Startup)

[main.py](../main.py) provides interactive device selection:
1. **MPV Output**: `interactive_select_audio_device()` → sets `MPV_AUDIO_DEVICE` env var
2. **WebRTC Input**: `interactive_select_webrtc_device()` → sets `WEBRTC_AUDIO_DEVICE` env var
3. Both use `startup_timeout` from settings.ini (default 15s, auto-selects VB-Cable)