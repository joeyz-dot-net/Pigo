# ClubMusic AI Agent Guide

**Full-stack web music player**: FastAPI + ES6 modules + MPV IPC engine + WebRTC/HTTP streaming.  
**Key distinction**: Bilingual (zh/en), user-isolation via localStorage, multi-singleton architecture, Windows/PyInstaller-optimized.

## ⚠️ Critical Rules (Must-Know)

| Rule | Impact & Example |
|------|---------|
| **API Sync** | Backend [app.py](../app.py) + Frontend [static/js/api.js](../static/js/api.js) must match exactly. New route? Update BOTH. Field rename? Check both files. Missing sync = silent failures. |
| **FormData vs JSON** | **Player control** (`/play`, `/seek`, `/volume`, `/playlist_remove`): `await request.form()`. **Data CRUD** (`/playlists`, `/playlist_reorder`, `/search_song`): `await request.json()`. Wrong type = "form required" errors. |
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

## Essential Workflows

### 1. Development Server
```powershell
python main.py              # Starts Uvicorn + interactive audio device selection dialog
                             # Will prompt for MPV output device (defaults to VB-Cable)
                             # Will prompt for WebRTC input device if streaming enabled
```

### 2. Building & Deployment
```powershell
.\build_exe.bat             # PyInstaller → dist/ClubMusic.exe (reads app.spec)
                             # Bundles: bin/ (mpv.exe, yt-dlp.exe), static/, templates/
```

### 3. Verification Commands
```powershell
Get-Process mpv             # Confirm MPV process running
Test-Path "\\.\pipe\mpv-pipe"  # Confirm MPV IPC pipe exists
$env:MPV_AUDIO_DEVICE       # Check selected audio device UUID
```

### 4. VS Code Tasks (`Ctrl+Shift+B`)
- **Build Only** → `dist/ClubMusic.exe` (no network deploy)
- **Build & Deploy to All** → build + copy to B560 + copy to local
- **Clean Build** → remove `build/`, `dist/`, `__pycache__/` then rebuild
- **启动音乐播放器** → `python main.py` (dev server)
- **安装依赖** → `pip install -r requirements.txt`

## Common Pitfalls & Debugging

| Symptom | Root Cause | Fix |
|---------|---------|------|
| Settings changes ignored | Config cached on startup | Restart `python main.py` |
| No audio output | Wrong WASAPI device GUID in `mpv_cmd` | Re-run startup device selection or edit `settings.ini` |
| Chinese text garbled | Missing UTF-8 wrapper in entry point | Add wrapper in [models/__init__.py#L6](../models/__init__.py) |
| YouTube videos 403 | yt-dlp outdated | `pip install --upgrade yt-dlp` or replace `bin/yt-dlp.exe` |
| Frontend API 400 errors | FormData/JSON mismatch (POST `/play` expects form, not JSON) | Check [api.js](../static/js/api.js) calls vs [app.py](../app.py) route handler |
| WebRTC has no audio | VB-Cable missing OR wrong device selected | Install VB-Cable, re-run startup dialog |
| Playlist changes lost | Code forgot `PLAYLISTS_MANAGER.save()` | Add call after [models/playlists.py](../models/playlists.py) modifications |
| Playlist appears empty in another browser | Each browser has independent `localStorage.selectedPlaylistId` | This is intentional—user isolation feature |
| MPV won't start | IPC pipe busy OR mpv.exe path wrong | Kill lingering processes: `taskkill /IM mpv.exe /F`, check [settings.ini](../settings.ini) |

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

## Device Selection & Environment Variables

[main.py](../main.py) orchestrates two interactive prompts at startup:

### MPV Output Device
```python
interactive_select_audio_device()  # Prompts for WASAPI output
                                   # Populates mpv_cmd with audio-device GUID
                                   # Auto-selects "CABLE-A Input" if found
                                   # Timeout: settings.ini [app] startup_timeout (default 15s)
                                   # Sets env var: MPV_AUDIO_DEVICE
```

### WebRTC Input Device (if `enable_stream = true`)
```python
interactive_select_webrtc_device()  # Prompts for sounddevice input
                                    # Used by models/webrtc.py:VirtualAudioTrack
                                    # Auto-selects 2-channel CABLE Output if found
                                    # Sets env var: WEBRTC_AUDIO_DEVICE
                                    # Also sets: WEBRTC_AUDIO_DEVICE_INDEX (0-based int)
```

**Key insight**: Device selection dialog appears BEFORE Uvicorn starts. If user doesn't input within timeout, uses defaults.