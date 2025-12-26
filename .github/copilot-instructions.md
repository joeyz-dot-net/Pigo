# Music Player AI Agent Guide

## Quick Start
Bilingual (zh/en) web music player: **FastAPI** + **ES6 modules** + **MPV audio engine** + **WebRTC streaming**.

```bash
pip install -r requirements.txt
python main.py  # Interactive prompts: (1) audio device (2) streaming mode → http://localhost:80
```

## ⚠️ Critical Rules

| Rule | Details |
|------|---------|
| **API Sync** | Route changes require updating BOTH `app.py` AND `static/js/api.js`—field names must match exactly |
| **FormData not JSON** | Player routes (`/play`, `/seek`, `/volume`) use `await request.form()`, NOT `request.json()` |
| **Global Singletons** | Use `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` directly (app.py:70-80)—never instantiate new |
| **Config Reload** | `settings.ini` is cached at startup—restart `python main.py` for changes |
| **PyInstaller Paths** | Use `sys.frozen` check for paths; bundled resources use `sys._MEIPASS` |
| **UTF-8 Windows** | Wrap `sys.stdout` with UTF-8 encoding in entry points (main.py:11-13) |
| **Module Init Order** | `models/__init__.py` prints load status—never change import order without testing |
| **User Isolation** | Frontend uses `localStorage` for per-browser settings—never sync to backend global state |
| **WebRTC Priority** | Streaming tries WebRTC first (aiortc + sounddevice), falls back to HTTP |

## Architecture

```
Browser ←2s poll→ FastAPI (app.py) ←→ Singletons ←→ MPV (\\.\pipe\mpv-pipe)
    ↓                                      ↓                   ↓
WebRTC Audio ←─── aiortc + sounddevice ←── VB-Cable ←── Audio Output
```

### Key Components

| Layer | File | Purpose |
|-------|------|---------|
| Entry | `main.py` | Uvicorn startup, audio device selection, `ENABLE_STREAMING` env |
| Backend | `app.py` | 60+ routes, singletons init at import |
| Player | `models/player.py` | MPV IPC via named pipe, config from settings.ini |
| WebRTC | `models/webrtc.py` | aiortc signaling, VB-Cable audio capture |
| Frontend | `static/js/main.js` | `MusicPlayerApp` class, status polling, module coordinator |

### Frontend ES6 Modules
- `api.js`: `MusicAPI` class wrapping HTTP requests (must match backend routes)
- `player.js`: `Player` class - playback control, WebRTC with HTTP fallback
- `playlist.js`: `PlaylistManager` - current playlist (localStorage-backed)
- `i18n.js`: Translations - **add BOTH `zh` and `en` keys** when adding strings
- `settingsManager.js`: User preferences in localStorage (not backend)

### Data Models (`models/`)
- `Song`, `LocalSong`, `StreamSong` - song types with `to_dict()`/`from_dict()`
- `Playlist`, `Playlists` - multi-playlist management with JSON persistence
- `PlayHistory`, `HitRank` - playback tracking for ranking feature

## Adding Features

### New Backend Route
```python
# app.py - Player routes use FormData
@app.post("/my-endpoint")
async def my_endpoint(request: Request):
    form = await request.form()          # FormData, NOT request.json()
    result = PLAYER.some_method()        # Use global singleton
    PLAYLISTS_MANAGER.save()             # Persist if modified
    return {"status": "OK", "data": result}
```

### Frontend API Wrapper
```javascript
// static/js/api.js - Add to MusicAPI class
async myEndpoint(value) {
    const formData = new FormData();
    formData.append('value', value);
    return this.postForm('/my-endpoint', formData);  // NOT this.post()
}
```

### i18n Strings
```javascript
// static/js/i18n.js - Add to BOTH objects
zh: { 'myFeature.label': '我的功能' },
en: { 'myFeature.label': 'My Feature' },
```

### Song/Playlist Operations
```python
# Playlist persistence (auto-saves to playlists.json)
playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
playlist.add_song({"url": path, "title": name, "type": "local"})
PLAYLISTS_MANAGER.save()  # Required to persist
```

## PyInstaller Path Detection

```python
# External executables (mpv, yt-dlp) - use sys.executable directory
if getattr(sys, 'frozen', False):
    app_dir = os.path.dirname(sys.executable)
else:
    app_dir = os.path.dirname(os.path.abspath(__file__))
bin_path = os.path.join(app_dir, "bin", "mpv.exe")

# Bundled resources (templates, static) - use sys._MEIPASS
if getattr(sys, 'frozen', False):
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
else:
    base_path = os.path.dirname(os.path.abspath(__file__))
```

## MPV IPC Commands
```python
# models/player.py - Windows named pipe communication
PIPE_NAME = r"\\.\pipe\mpv-pipe"
mpv_command(["loadfile", url, "replace"])    # Play file
mpv_command(["set_property", "pause", True]) # Pause
mpv_get("time-pos")                          # Get position
mpv_get("duration")                          # Get duration
```

## Debugging

```powershell
Get-Process mpv; Test-Path "\\.\pipe\mpv-pipe"  # Check MPV
curl http://localhost/status                     # Player state
curl http://localhost/webrtc/status              # WebRTC clients
```

```javascript
// Browser console
localStorage.setItem('DEBUG_MODE', 'true');      // Verbose logs
app.diagnose.stream();                           // Stream diagnostics
```

## Common Issues

| Symptom | Fix |
|---------|-----|
| Settings ignored | Restart `python main.py` (INI cached) |
| No audio | Check `mpv_cmd` audio-device GUID in settings.ini |
| WebRTC no audio | Verify VB-Cable installed, `sounddevice` sees device |
| Chinese garbled | Add UTF-8 stdout wrapper in entry point |
| YouTube 403 | Update `yt-dlp.exe` in `bin/` |

## Data Files

| File | Format |
|------|--------|
| `playlists.json` | `{playlist_id: {name, songs: [{url, title, type}]}}` |
| `playback_history.json` | `[{url, title, type, timestamps}]` |
| `settings.ini` | INI sections: `[app]`, `[logging]` |

## Build EXE
```powershell
.\build_exe.bat  # PyInstaller → dist/app.exe
# Requires bin/: mpv.exe, yt-dlp.exe; VB-Cable on target system
```