# ClubMusic — AI Agent Guide

**Full-stack web music player**: FastAPI backend + ES6 frontend + MPV IPC engine.  
**Key distinction**: Bilingual (zh/en), user-isolation via localStorage, event-driven auto-play, Windows/PyInstaller-optimized.

> **Last Updated**: 2026-01-03 | **Focus**: Backend-controlled auto-play, API parity patterns, singleton architecture, deployment workflows, ES6 module system

## ⚠️ Critical Rules (Must Follow)

| Rule | Why & Example |
|------|---------------|
| **API Sync** | Backend [app.py](../app.py) + Frontend [static/js/api.js](../static/js/api.js) must match exactly. New route? Update BOTH. Field rename? Check both. Missing sync = silent failures. |
| **FormData vs JSON** | **Player control** (`/play`, `/seek`, `/volume`, `/playlist_remove`): use `await request.form()`. **Data CRUD** (`/playlists`, `/playlist_reorder`, `/search_song`): use `await request.json()`. Wrong type = 400 errors. |
| **Global Singletons** | `PLAYER`, `PLAYLISTS_MANAGER`, `RANK_MANAGER` initialized in [app.py L70-80](../app.py#L70-L80). Access directly—never create new instances. Duplication = state corruption. |
| **Persistence** | Call `PLAYLISTS_MANAGER.save()` after ANY playlist mutation. Forgetting = data loss on restart. |
| **User Isolation** | Playlist selection stored in browser `localStorage.selectedPlaylistId`, NOT backend. Each tab/browser independent. Backend only validates existence via `/playlists/{id}/switch`. |
| **UTF-8 Windows** | Every `.py` entry point needs UTF-8 wrapper (see [models/__init__.py#L6-11](../models/__init__.py)). Missing = Chinese chars garbled in logs. |
| **i18n Completeness** | Always add BOTH `zh` and `en` keys in [static/js/i18n.js](../static/js/i18n.js) when adding UI text. Missing lang = undefined strings. |
| **Default Playlist** | Never delete or rename the `default` playlist (ID: `"default"`). Backend assumes it always exists for auto-play logic. |

## Architecture & Data Flow

```
Browser ←1s poll /status→ FastAPI (app.py) ←→ Singletons ←→ MPV (\\.\pipe\mpv-pipe)
   │                           │                                ↑
   ├── ES6 modules ────────────┴── models/*.py                 │
   └── localStorage                    ├── player.py (event listener thread)
       (selectedPlaylistId,            │   └─ Detects MPV "end-file" event
        theme, language)                │      └─ Calls handle_playback_end()
                                        │         └─ Deletes current song + plays next
                                        │            (NO frontend involvement)
                                        └── playlists.json, playback_history.json
```

**Key Insight**: Auto-next is 100% backend-driven via MPV event listener thread in [models/player.py#L569-636](../models/player.py#L569-L636). Frontend only reflects state via `/status` polling.

## Critical Patterns & Gotchas

### Auto-Play Mechanism (Backend-Controlled)
**Location**: [models/player.py#L637-720](../models/player.py#L637-L720) — `handle_playback_end()`

1. MPV event listener thread detects `end-file` event
2. Backend automatically:
   - Deletes current song from default playlist (by URL match)
   - Plays next song in queue (index 0 after deletion)
   - Updates `PLAYER.current_index` and `PLAYER.current_meta`
3. Frontend reads state changes via `/status` polling (1s interval)

**Rule**: Never implement auto-next logic in frontend. Backend owns this completely.

### Song Insertion Pattern ("Add Next" feature)
**Location**: [app.py#L851-917](../app.py#L851-L917) — `/playlist_add` endpoint

```python
# Calculate insert position: don't interrupt current song, add to "next" position
current_index = PLAYER.current_index  # Maintained by /play endpoint
insert_index = current_index + 1 if current_index >= 0 else 1
playlist.songs.insert(insert_index, song_dict)
```

**Invariants**:
- Position 0 = currently playing (never modify unless stopping playback)
- `current_index` updated by `/play` endpoint, NOT by add/remove operations
- After deletion: if `current_index >= len(songs)`, reset to `max(-1, len(songs) - 1)`

### PyInstaller Resource Access
**Pattern**: Use `_get_resource_path()` wrapper in [app.py#L38-51](../app.py#L38-L51)

```python
# Development: uses source directory
# Packaged: uses sys._MEIPASS temp directory
static_dir = _get_resource_path("static")
app.mount("/static", StaticFiles(directory=static_dir))
```

**External tools** (`mpv.exe`, `yt-dlp.exe`) live next to exe, NOT in `_MEIPASS`.

### Cover Art Retrieval
**Endpoint**: `/cover/{file_path:path}` in [app.py#L258-310](../app.py#L258-L310)

Priority order:
1. Embedded cover (extracted via `mutagen`, returned as bytes)
2. Directory cover files (`cover.jpg`, `folder.jpg`, `albumart.jpg`)
3. Placeholder (`static/images/preview.png`)

**Note**: Never saves extracted covers to disk—streams bytes directly to avoid temp file clutter.

### YouTube Thumbnail Generation
**Pattern**: Auto-generate from video ID when missing

```python
if song_type == "youtube" and not thumbnail_url:
    # Extract video ID from URL
    video_id = extract_video_id(url)  # Regex match
    thumbnail_url = f"https://img.youtube.com/vi/{video_id}/default.jpg"
```

Applies to: `/playlist_add`, `/playlists/{id}/add_next`, YouTube search results.

### Frontend State Management
**Location**: [static/js/main.js#L23-42](../static/js/main.js#L23-L42)

```javascript
class MusicPlayerApp {
    constructor() {
        // User-isolated: each browser/tab maintains own playlist selection
        this.currentPlaylistId = localStorage.getItem('selectedPlaylistId') || 'default';
        
        // State tracking: only log when values change (reduce log spam)
        this.lastLoopMode = null;
        this.lastVolume = null;
        this.lastPlaybackStatus = null;
    }
}
```

**Rule**: All user preferences (theme, language, volume) stored in `localStorage`, NOT backend.

## ES6 Module System & Frontend Architecture

### Module Structure
**Location**: [static/js/](../static/js/) — All frontend code uses ES6 modules with explicit exports

**Pattern**: Each module exports singleton instances or utility functions:

```javascript
// api.js - API client
export class MusicAPI { /* ... */ }
export const api = new MusicAPI();

// player.js - Player state & controls
export class Player { /* ... */ }
export const player = new Player();

// playlist.js - Playlist management
export class PlaylistManager { /* ... */ }
export const playlistManager = new PlaylistManager();
export function renderPlaylistUI({ container, onPlay, currentMeta }) { /* ... */ }
```

**Key Modules** (always import from these):

| Module | Export | Purpose |
|--------|--------|---------|
| [api.js](../static/js/api.js) | `api` | All backend API calls—**must mirror app.py** |
| [player.js](../static/js/player.js) | `player` | Playback state, controls, event emitter |
| [playlist.js](../static/js/playlist.js) | `playlistManager`, `renderPlaylistUI` | Current playlist CRUD |
| [playlists-management.js](../static/js/playlists-management.js) | `playlistsManagement` | Multi-playlist UI modal |
| [i18n.js](../static/js/i18n.js) | `i18n` | Translation system—auto-detects browser language |
| [themeManager.js](../static/js/themeManager.js) | `themeManager` | Theme switching (dark/light) |
| [settingsManager.js](../static/js/settingsManager.js) | `settingsManager` | Settings panel & localStorage persistence |
| [volume.js](../static/js/volume.js) | `volumeControl` | Volume slider with backend sync |
| [search.js](../static/js/search.js) | `searchManager` | Search UI (local + YouTube) |
| [local.js](../static/js/local.js) | `localFiles` | Local file tree browser |
| [ui.js](../static/js/ui.js) | `Toast`, `loading`, `formatTime` | UI utilities |

**Import Pattern**:
```javascript
// main.js - Entry point
import { api } from './api.js';
import { player } from './player.js';
import { playlistManager, renderPlaylistUI } from './playlist.js';
import { i18n } from './i18n.js';
// ... use singleton instances directly
```

**Critical Rule**: Never instantiate classes directly—always use exported singletons. Multiple instances = state desync.

## Developer Workflows

### Development Server
```powershell
# Interactive audio device selection + starts FastAPI
python run.py

# Direct start (uses device from settings.ini)
python app.py
```

**Port**: 80 (requires admin on Windows). Change in [settings.ini](../settings.ini) if needed.

**What happens**:
- `run.py`: Enumerates audio devices → updates `settings.ini` → launches `app.py`
- `app.py`: Initializes singletons → starts MPV event listener → runs Uvicorn on port 80
- Frontend: Polls `/status` every 1s for playback state updates

### VS Code Tasks (Available)

| Task | Command | Purpose |
|------|---------|---------|
| **Build** | `.\build_exe.bat` | 📦 Creates `dist/ClubMusic.exe` (local build only) |
| **Deploy Remote** | `.\.vscode\deploy.ps1` | 🚀 Deploys exe to `\\B560\code\ClubMusic` (with backup) |
| **Build & Deploy** | Sequential combo | 🔨➡️🚀 Builds then deploys (default task: `Ctrl+Shift+B`) |

**Access**: `Ctrl+Shift+P` → "Run Task" → Select task name

### Build Windows Executable
```powershell
# Via VS Code task (recommended)
# Ctrl+Shift+P → "Run Task" → "Build"

# Or manual
.\build_exe.bat
```

**Output**: `dist/ClubMusic.exe` (single-file bundle, ~150MB).  
**Spec file**: [app.spec](../app.spec) — controls PyInstaller bundling.

**Build process** ([build_exe.bat](../build_exe.bat)):
1. Validates PyInstaller installation (`pip install pyinstaller` if missing)
2. Cleans `build/` and `dist/` directories
3. Installs/verifies `requirements.txt` dependencies
4. Runs `python -m PyInstaller app.spec --clean --noconfirm`
5. Bundles all Python code, dependencies, and static assets into `_MEIPASS` temp dir

**Critical**: External tools (`bin/mpv.exe`, `bin/yt-dlp.exe`) must exist alongside the exe—they're NOT bundled into `_MEIPASS`. These are resolved via `_get_app_dir()` in [models/player.py](../models/player.py).

**Entry Point**: [main.py](../main.py) (not app.py) — wraps UTF-8 encoding setup for Windows console.

### Deploy to Remote Server
```powershell
# Via VS Code task
# Ctrl+Shift+P → "Run Task" → "Deploy Remote"

# Or manual
.\.vscode\deploy.ps1
```

**Target**: `\\B560\code\ClubMusic` (network share)  
**Backup**: Auto-creates timestamped backups in `\\B560\code\ClubMusic_backup` before deployment

**Process** ([.vscode/deploy.ps1](../.vscode/deploy.ps1)):
1. Verifies `dist/ClubMusic.exe` exists (fails if not built)
2. Creates backup directory if missing: `\\B560\code\ClubMusic_backup`
3. Backs up existing exe with timestamp: `ClubMusic_20260103_143022.exe`
4. Copies new exe to remote: `\\B560\code\ClubMusic\ClubMusic.exe`
5. Prints deployment summary with paths and status

**Error Handling**: Uses PowerShell `$ErrorActionPreference = 'Stop'` — fails fast on any error.

**Build & Deploy (Sequential)**:
```powershell
# Via VS Code task (runs Build → Deploy in order)
# Ctrl+Shift+P → "Run Task" → "Build & Deploy"
```

### Configuration
**File**: [settings.ini](../settings.ini)

Key settings:
- `music_dir`: Root for local music library
- `mpv_cmd`: Full command with IPC pipe path (`\\.\pipe\mpv-pipe`)
- `allowed_extensions`: `.mp3,.wav,.flac,.aac,.m4a`
- `local_volume`: Default volume (0-100)
- `playback_history_max`: Max history entries before trimming

**Reload**: Requires app restart. No hot-reload.

### Debugging
**Console**: [static/js/debug.js](../static/js/debug.js) — press `` ` `` (backtick) to toggle debug panel.  
**Logs**: stdout (dev) or use Windows Event Viewer (packaged exe).

## High-Value Files (Read These First)

| File | Purpose |
|------|---------|
| [app.py](../app.py) | FastAPI routing, singletons, auto-fill thread, all endpoints |
| [models/player.py](../models/player.py) | MPV lifecycle, event listener, playback history, auto-next logic |
| [models/playlists.py](../models/playlists.py) | Multi-playlist model, persistence (`playlists.json`) |
| [models/song.py](../models/song.py) | Song classes (LocalSong, StreamSong), yt-dlp wrappers |
| [static/js/api.js](../static/js/api.js) | Frontend API wrapper—**must mirror app.py** |
| [static/js/main.js](../static/js/main.js) | App initialization, state management, polling loop |
| [static/js/i18n.js](../static/js/i18n.js) | Translations (zh/en)—add both languages for new strings |

## Common Mistakes & How to Avoid

| Mistake | How to Detect | Fix |
|---------|---------------|-----|
| API mismatch | 400 errors, missing fields in response | Compare [app.py](../app.py) route with [static/js/api.js](../static/js/api.js) method |
| Forgot `save()` | Playlist changes lost on restart | Add `PLAYLISTS_MANAGER.save()` after mutation |
| Wrong payload type | "form required" or empty request body | Check endpoint in [app.py](../app.py): FormData vs JSON |
| Duplicated singleton | State out of sync, missing songs | Always use `app.PLAYER`, `app.PLAYLISTS_MANAGER` |
| Frontend auto-next | Double-play, skipped songs | Remove frontend logic; backend owns auto-next |
| Missing i18n key | "undefined" in UI | Add to both `zh` and `en` in [static/js/i18n.js](../static/js/i18n.js) |
| PyInstaller path issue | FileNotFoundError in packaged exe | Use `_get_resource_path()` for bundled assets |

## API Design Conventions

### FormData Endpoints (Player Control)
```python
@app.post("/play")
async def play(request: Request):
    form = await request.form()
    url = form.get("url")
    # ...
```

**Frontend**:
```javascript
async play(url, title, type = 'local') {
    const formData = new FormData();
    formData.append('url', url);
    formData.append('title', title);
    formData.append('type', type);
    return this.postForm('/play', formData);
}
```

### JSON Endpoints (Data CRUD)
```python
@app.post("/playlist_add")
async def add_to_playlist(request: Request):
    data = await request.json()
    playlist_id = data.get("playlist_id")
    # ...
```

**Frontend**:
```javascript
async addToPlaylist(data) {
    return this.post('/playlist_add', data);
}
```

## Code Examples

### Adding a New Endpoint

**1. Backend** ([app.py](../app.py)):
```python
@app.post("/my_endpoint")
async def my_endpoint(request: Request):
    data = await request.json()  # or request.form()
    # ... logic ...
    return {"status": "OK", "data": result}
```

**2. Frontend** ([static/js/api.js](../static/js/api.js)):
```javascript
async myEndpoint(data) {
    return this.post('/my_endpoint', data);
}
```

**3. Usage** (in UI module):
```javascript
import { api } from './api.js';

const result = await api.myEndpoint({ key: value });
if (result.status === "OK") {
    // handle success
}
```

### Modifying Playlist
```python
playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
playlist.songs.append(song_dict)
playlist.updated_at = time.time()
PLAYLISTS_MANAGER.save()  # ← CRITICAL: don't forget
```

### Adding i18n String
**File**: [static/js/i18n.js](../static/js/i18n.js)

```javascript
const translations = {
    zh: {
        'my.new.key': '我的新文本',
        // ...
    },
    en: {
        'my.new.key': 'My New Text',
        // ...
    }
};
```

**Usage**:
```javascript
import { i18n } from './i18n.js';
const text = i18n.t('my.new.key');
```

## Testing & Verification

### Quick Checks After Changes
1. **API change**: Test both endpoints (curl/Postman) AND frontend UI
2. **Playlist mutation**: Restart app → verify `playlists.json` persisted
3. **Auto-next**: Play song to end → verify next song plays automatically
4. **Multi-language**: Switch language in settings → all text updates
5. **PyInstaller**: Build exe → run → verify paths resolve correctly

### Manual Test Scenarios
- **User isolation**: Open two browser tabs → select different playlists → verify independent
- **YouTube search**: Search "test" → add to playlist → verify thumbnail shows
- **Cover art**: Play local MP3 → verify cover displays (embedded or folder)
- **Loop modes**: Toggle loop (0→1→2→0) → verify behavior matches mode

## Dependencies & External Tools

### Python Requirements ([requirements.txt](../requirements.txt))
```
fastapi         # Web framework
uvicorn         # ASGI server
python-multipart # FormData support
psutil          # Process management
yt-dlp          # YouTube download
mutagen         # Audio metadata extraction
pyinstaller     # Exe packaging
```

### External Binaries (required in production)
- **MPV** (`bin/mpv.exe`): Media player with IPC support
- **yt-dlp** (`bin/yt-dlp.exe`): YouTube video extraction
- Must exist alongside `ClubMusic.exe` in deployment

## Questions & Feedback

If any section is unclear or you need more detail on:
- Specific endpoint patterns (e.g., YouTube playlist extraction)
- Frontend module interactions (e.g., player ↔ playlist manager)
- MPV IPC command examples
- Error handling conventions
- Logging patterns

...please ask! I'll expand those sections with concrete examples from the codebase.
