# Music Player AI Agent Guide

## Quick Start
Bilingual (zh/en) web music player: **FastAPI** + **ES6 modules** + **MPV audio engine** + **FFmpeg streaming**.

```bash
pip install -r requirements.txt
python main.py  # Interactive prompts for audio device + streaming
# → http://localhost:80
```

## ⚠️ Critical Rules

1. **API Sync**: Route changes require updating BOTH [app.py](../app.py) AND [static/js/api.js](../static/js/api.js)—field names must match exactly
2. **FormData not JSON**: Player routes (`/play`, `/seek`, `/volume`) use `await request.form()`, NOT JSON body
3. **Global Singletons**: Use `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` directly (line ~100 in app.py)—never instantiate new ones
4. **Config Reload**: `settings.ini` is cached at startup—restart `python main.py` for changes
5. **Path Detection**: All executable paths (ffmpeg, mpv, yt-dlp) must use `sys.frozen` check for PyInstaller support—never hardcode `__file__` paths
6. **UTF-8 Stdout**: Always wrap `sys.stdout` with UTF-8 encoding in entry points for Windows compatibility (see main.py lines 11-13)
7. **Module Init Order**: `models/__init__.py` prints load status—never change import order without testing

## Architecture

```
Browser ←500ms poll→ FastAPI (app.py) ←→ Global Singletons ←→ MPV (\\.\pipe\mpv-pipe)
    ↓                                           ↓                        ↓
StreamingResponse ←────── FFmpeg 3-thread ←── VB-Cable ←─────── Audio Output
```

| Layer | Key Files | Notes |
|-------|-----------|-------|
| Entry | [main.py](../main.py) | Uvicorn startup, audio device selection, `ENABLE_STREAMING` env var |
| Backend | [app.py](../app.py) | 60+ routes, global singletons initialized at import time |
| Player | [models/player.py](../models/player.py) | MPV IPC via named pipe, playback state, config from settings.ini |
| Stream | [models/stream.py](../models/stream.py) | FFmpeg broadcast: `read_stream` → `broadcast_worker` → `send_heartbeats` |
| Frontend | [static/js/main.js](../static/js/main.js) | `MusicPlayerApp` class, 500ms status polling, ES6 module imports |

### Frontend Module Structure
All frontend code uses ES6 modules with explicit exports/imports:
- **player.js**: `Player` class - playback control, stream management
- **api.js**: `MusicAPI` class - HTTP request wrapper matching backend routes
- **playlist.js**: `PlaylistManager` class - current playlist state
- **playlists-management.js**: `PlaylistsManagement` class - multi-playlist UI
- **i18n.js**: `i18n` object - bilingual zh/en translations (add BOTH languages when adding strings)
- **settingsManager.js**: User preferences stored in localStorage (not backend)
- **stream.js**: `streamManager` object - browser audio element lifecycle

## Adding Features

### New Backend Route
```python
# app.py - Player control routes use FormData
@app.post("/my-endpoint")
async def my_endpoint(request: Request):
    form = await request.form()          # FormData, NOT request.json()
    result = PLAYER.some_method()        # Use global singleton
    PLAYLISTS_MANAGER.save()             # Persist if modified
    return {"status": "OK", "data": result}
```

### Frontend API Wrapper
```javascript
// static/js/api.js - Add method to MusicAPI class
async myEndpoint(value) {
    const formData = new FormData();
    formData.append('value', value);
    return this.postForm('/my-endpoint', formData);  // NOT this.post()
}
```

### Playlist Persistence
```python
# Auto-saves to playlists.json after modification
playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
playlist.add_song({"url": path, "title": name, "type": "local"})  # or "youtube"
PLAYLISTS_MANAGER.save()  # Required to persist
```

### i18n Strings
Add to BOTH `zh` and `en` objects in [static/js/i18n.js](../static/js/i18n.js):
```javascript
// zh object
'myFeature.label': '我的功能',
// en object  
'myFeature.label': 'My Feature',
```

## Config Reference (`settings.ini`)

| Section | Key Settings |
|---------|-------------|
| `[paths]` | `bin_dir` - Relative or absolute path to executables (ffmpeg, mpv, yt-dlp) |
| `[app]` | `mpv_cmd` (with audio-device GUID), `music_dir`, `default_stream_format` (aac/mp3/flac), `audio_input_format` (wasapi/dshow) |
| `[stream]` | `broadcast_queue_maxsize`, `broadcast_executor_workers` (120 for ~20 clients) |
| `[browser_configs]` | Safari/Chrome/Firefox: `queue_blocks,heartbeat_ms,timeout,keepalive` |
| `[formats]` | Per-codec: `codec,bitrate,profile,chunk_kb,heartbeat,queue_mult` |
| `[logging]` | `level`, `polling_sample_rate` (0.1 = 10% of /status requests logged) |

**Important**: `enable_stream` removed from config—now controlled by interactive prompt at startup.

## Executable Path Detection

**PyInstaller Support**: All modules use `sys.frozen` detection:
```python
if getattr(sys, 'frozen', False):
    app_dir = os.path.dirname(sys.executable)  # Packaged exe
else:
    app_dir = os.path.dirname(os.path.abspath(__file__))  # Development
```

**Directory Structure**:
```
MusicPlayer.exe (or main.py)
settings.ini
bin/
  ├─ ffmpeg.exe
  ├─ mpv.exe
  └─ yt-dlp.exe
```

**Affected Files**: `models/stream.py`, `models/player.py`, `models/song.py`, `main.py`

All executables are expected in the `bin/` subdirectory relative to the main program directory.

## Debugging

```powershell
# Check MPV process and IPC pipe
Get-Process mpv; Test-Path "\\.\pipe\mpv-pipe"

# API diagnostics
curl http://localhost/status         # Player state (playing, volume, position)
curl http://localhost/stream/status  # FFmpeg process, client count, format
```

## Common Issues

| Symptom | Fix |
|---------|-----|
| Settings ignored after edit | Restart `python main.py` (INI cached at startup) |
| No audio output | Check `mpv_cmd` audio-device GUID in settings.ini |
| Safari stream disconnects | Increase `[browser_configs].safari` keepalive, verify 3-thread arch |
| Chinese text garbled | Ensure UTF-8 stdout wrapper in entry point (see main.py line ~13) |
| YouTube 403 errors | Update `yt-dlp.exe` in `bin/` directory |

## Data Files

| File | Purpose | Format |
|------|---------|--------|
| `playlists.json` | All playlists + songs | `{playlist_id: {name, songs: [{url, title, type}]}}` |
| `playback_history.json` | Play counts for ranking | `{url: {count, last_played, title}}` |
| `settings.ini` | Server/MPV/FFmpeg config | INI with sections: app, stream, formats |
| `user_settings.json` | Client preferences | `{theme, language, autoStream}` |

## Build EXE

```powershell
.\build_exe.bat  # PyInstaller → dist/app.exe
# Requires in PATH or bin/: mpv.exe, ffmpeg.exe, yt-dlp.exe
```