# Music Player AI Agent Guide

## Quick Start
Bilingual (Chinese/English) web music player: **FastAPI backend** + **vanilla ES6 frontend** + **MPV audio engine**.

```bash
pip install -r requirements.txt
python main.py  # Interactive prompts: audio device + streaming toggle
# Open http://localhost:80
```

## Critical Rules

1. **API Sync**: When modifying routes, update BOTH `app.py` AND `static/js/api.js`—field names must match exactly
2. **FormData not JSON**: Player routes (`/play`, `/seek`, `/volume`) use `request.form()`, not JSON body
3. **Global Singletons**: Use `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` directly—never instantiate new ones
4. **Config Reload**: `settings.ini` read once at startup—restart required for changes

## Architecture

```
Browser ←500ms poll→ FastAPI (app.py) ←→ Global Singletons ←→ MPV (\\.\pipe\mpv-pipe)
    ↓                                           ↓                        ↓
StreamingResponse ←────── FFmpeg 3-thread ←── VB-Cable ←─────── Audio Output
```

| Layer | Files | Notes |
|-------|-------|-------|
| Entry | `main.py` | Uvicorn, audio device selection, UTF-8 fix (Windows) |
| Backend | `app.py` | 60+ routes, `STREAMING_ENABLED` env toggles stream module |
| Player | `models/player.py` | MPV IPC commands, playback state, config loading |
| Stream | `models/stream.py` | FFmpeg broadcast: `read_stream` → `broadcast_worker` → `send_heartbeats` |
| Frontend | `static/js/main.js` | `MusicPlayerApp` class, ES6 modules, 500ms status polling |

## Adding Features

### New API Route
```python
# app.py
@app.post("/my-endpoint")
async def my_endpoint(request: Request):
    form = await request.form()  # FormData, not JSON
    result = PLAYER.some_method()  # Use global singleton
    return {"status": "OK", "data": result}
```
```javascript
// static/js/api.js
async myEndpoint(value) {
    const formData = new FormData();
    formData.append('value', value);
    return this.postForm('/my-endpoint', formData);
}
```

### Playlist Changes
```python
# Auto-saves to playlists.json
PLAYLISTS_MANAGER.add_song(playlist_id, {"url": path, "title": name, "type": "local"})
```

### i18n Strings
Add to both `zh` and `en` objects in `static/js/i18n.js`:
```javascript
'myFeature.label': '我的功能',  // zh
'myFeature.label': 'My Feature', // en
```

## Config Reference (`settings.ini`)

| Section | Key Settings |
|---------|-------------|
| `[app]` | `mpv_cmd`, `music_dir`, `default_stream_format` (aac/mp3/flac) |
| `[stream]` | `broadcast_queue_maxsize`, `broadcast_executor_workers` |
| `[browser_configs]` | Safari/Chrome/Firefox tuning: `queue_blocks,heartbeat_ms,timeout,keepalive` |
| `[formats]` | Audio codec params: `codec,bitrate,profile,chunk_kb,heartbeat,queue_mult` |

## Debugging (PowerShell)

```powershell
Get-Process mpv                      # MPV running?
Test-Path "\\.\pipe\mpv-pipe"        # IPC pipe exists?
curl http://localhost/status         # Player state
curl http://localhost/stream/status  # FFmpeg stream diagnostics
```

## Common Issues

| Symptom | Cause & Fix |
|---------|-------------|
| Settings ignored | Restart `python main.py` (INI cached) |
| No audio output | Check `[app].mpv_cmd` audio-device in settings.ini |
| Safari stream cuts | Verify 3 threads in stream.py, check `[browser_configs].safari` |
| Chinese garbled | UTF-8 wrapper missing—check `sys.stdout` reconfiguration |
| YouTube 403 | Update `yt-dlp.exe` in `bin/` or PATH |

## File Map

| Purpose | Path |
|---------|------|
| Persistent state | `playlists.json`, `playback_history.json` |
| Startup config | `settings.ini` |
| User prefs | `user_settings.json` |
| Styles | `static/css/base.css`, `theme-dark.css`, `theme-light.css` |
| Translations | `static/js/i18n.js` |

## Build EXE

```powershell
.\build_exe.bat  # PyInstaller → dist/app.exe
# Requires in PATH or bin/: mpv.exe, ffmpeg.exe, yt-dlp.exe
```