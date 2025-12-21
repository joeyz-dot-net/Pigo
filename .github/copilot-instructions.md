# Music Player AI Agent Guide

## Quick Start for AI Agents
**This project is a bilingual (Chinese/English) web-based music player with FastAPI backend and vanilla ES6 frontend.**
- **Immediate context**: Read [Architecture snapshot](#architecture-snapshot) first, then check specific concerns in subsections below.
- **Making changes**: Always update both frontend (FormData field names in [static/js/api.js](static/js/api.js)) and backend (route handlers in [app.py](app.py)). Run `python main.py` to test locally.
- **Streaming issues**: 90% of audio dropout/quality problems are in [models/stream.py](models/stream.py) thread architecture—refer to [doc/SAFARI_STREAMING_FIX_COMPLETE.md](doc/SAFARI_STREAMING_FIX_COMPLETE.md) lines 1-197 before making changes.
- **Settings changes**: Always restart app (reload=False in uvicorn) after editing [settings.ini](settings.ini). Changes to [models/settings.py](models/settings.py) take effect immediately.
- **Testing**: Use `python main.py`, navigate to http://0.0.0.0:80, open browser DevTools (F12) for network/console diagnostics. PowerShell for system checks: `Get-Process mpv`, `Test-Path "\\.\pipe\mpv-pipe"`.

## Architecture snapshot
- **Backend**: FastAPI in [app.py](app.py) (2104 lines, 60+ routes) built around module-level singletons: `PLAYER = MusicPlayer.initialize()`, `PLAYLISTS_MANAGER = Playlists()`, `RANK_MANAGER = HitRank()`, `SETTINGS = initialize_settings()`, `CURRENT_PLAYLIST_ID`. Business logic lives in [models/](models/) (player.py 1597 lines, song.py, stream.py 1235 lines). No dependency injection—all state is global and auto-persisted.
- **Entry**: `python main.py` boots uvicorn (reload=False), forces UTF-8 stdout/stderr for Windows compatibility, imports [app.py](app.py) which auto-initializes MPV subprocess + FFmpeg streaming process, loads playback_history.json, playlists.json on import. No hot-reload of settings.ini—restart required for config changes.
- **Frontend**: [templates/index.html](templates/index.html) + modular ES6 in [static/js/](static/js/): main.js wires MusicPlayerApp class coordinating PlayerManager/PlaylistManager/SearchManager/RankingManager/VolumeControl/ThemeManager/SettingsManager modules via ES6 imports, polls /status ~500ms, uses FormData POSTs. Bilingual UI (Chinese in response strings, English in code/comments).
- **Audio playback (MPV)**: External mpv.exe process spawned via subprocess.Popen with named pipe IPC (Windows: `\\.\pipe\mpv-pipe`). All communication through [models/player.py](models/player.py) methods `mpv_command(cmd_list)` and `mpv_get(prop)`. Pipe/command path from settings.ini `[app].mpv_cmd`. Supports local files (.mp3, .wav, .flac, .aac, .m4a) and YouTube URLs via yt-dlp.
- **Audio streaming (FFmpeg)**: [models/stream.py](models/stream.py) (1235 lines) provides browser audio stream via /stream/play endpoint. **Critical 2024 optimization**: 3-thread async non-blocking broadcast (read_stream + broadcast_worker + send_heartbeats threads) with ClientPool management, BROADCAST_QUEUE, and sequence numbers for packet loss detection. FFmpeg parameters optimized for low-latency (rtbufsize 32M for safety, thread_queue_size 1024). Browser-specific queue sizing (Safari 512 blocks = 128MB, Chrome/Edge 64 blocks = 16MB). Keepalive via sequence-numbered packets (seq_id < 0). See [doc/SAFARI_STREAMING_FIX_COMPLETE.md](doc/SAFARI_STREAMING_FIX_COMPLETE.md) for complete optimization details.
- **User settings**: Settings now split: [models/settings.py](models/settings.py) handles server-side settings (deprecated; use user_settings.json), [static/js/settingsManager.js](static/js/settingsManager.js) manages client-side localStorage. Frontend calls /settings endpoints for validation but settings persist in browser. Settings.ini [app] section is read once at startup (no hot-reload).

## Start & debug
- **Install/run**: `pip install -r requirements.txt; python main.py` (restart after any settings.ini change). Requires mpv.exe in project root or `C:\mpv\` + FFmpeg in PATH. Frontend at http://0.0.0.0:80 (default, configurable via settings.ini [app] server_host/server_port). Build standalone exe with `build_exe.bat` (uses PyInstaller, bundles mpv.exe but requires yt-dlp.exe and ffmpeg.exe manually).
- **Config**: settings.ini read once at startup in [models/player.py](models/player.py) via `MusicPlayer.ensure_ini_exists()` and `from_ini_file()`. Fallback to `MusicPlayer.DEFAULT_CONFIG`. Key fields: `[app]` music_dir (Z:), allowed_extensions (.mp3,.wav,.flac,.aac,.m4a), server_host/server_port, debug, mpv_cmd. Optional [paths] audio_input_device for FFmpeg (e.g., "CABLE Output (VB-Audio Virtual Cable)"). Changes require full restart (reload=False in uvicorn).
- **State loading**: On import, [app.py](app.py) initializes singletons which auto-load playback_history.json (array of {url, title, type, timestamps}), playlists.json (dict {playlist_id → {id, name, songs:[], created_at, updated_at}}) and build local file tree from music_dir. All mutations auto-save via `PLAYLISTS_MANAGER.save()`.
- **MPV diagnostics**: PowerShell `Test-Path "\\.\pipe\mpv-pipe"` and `Get-Process mpv` for IPC troubleshooting. Check `PLAYER.pipe_name` vs settings.ini `[app].mpv_cmd` match. See [models/player.py](models/player.py) `ensure_mpv()` and `_init_mpv_ipc()` for pipe creation. Named pipe path: `\\.\pipe\mpv-pipe` (hardcoded, matches MPV_CMD args).
- **FFmpeg/Stream diagnostics**: GET /stream/status returns running status, format, active_client count, total bytes transferred. GET /stream/debug/browser shows browser-specific config (queue size, heartbeat, timeout). FFmpeg spawned with audio device auto-detection via dshow: checks [paths] audio_input_device, then auto-discovers available devices. See [models/stream.py](models/stream.py) `find_available_audio_device()` and `start_ffmpeg_stream()`. If no audio device found, startup provides device list and configuration instructions.
- **Client Pool diagnostics**: [models/stream.py](models/stream.py) `ClientPool` class manages per-browser queue sizing—Safari 512 blocks (128MB), Chrome/Edge/Firefox 64 blocks (16MB). Handles queue overflow by dropping oldest chunks and inserting new ones. Register via `register_client(client_id, browser_name)`. Unregister on client timeout (40s default) or explicit cleanup. Stats via `CLIENT_POOL.get_stats()`.
- **Build**: `build_exe.bat` uses PyInstaller with app.spec; includes mpv.exe in bundle alongside [main.py](main.py) entry point. yt-dlp.exe and ffmpeg.exe must be downloaded separately and placed in bundle or PATH. Entry via [main.py](main.py) (not app.py for PyInstaller compat).

## Client Pool & Broadcasting Architecture (2024)
- **ClientPool** in [models/stream.py](models/stream.py): Per-client queue.Queue with browser-specific maxsize via `QUEUE_SIZE_CONFIG` dict. `register(client_id, audio_format, browser_name)` returns client queue; `broadcast(chunk)` sends to all active clients in parallel (non-blocking, drops oldest if full). Stats tracked: bytes_sent, chunks_received, uptime per client; pool-wide peak_concurrent, total_clients_ever.
- **Sequence-numbered broadcasts**: Each chunk gets seq_id via `add_to_retransmit_buffer(chunk)`. Clients receive (seq_id, chunk) tuples. Sequence numbers < 0 indicate keepalive packets (no audio data). Retransmit buffer (deque maxlen=2000) stores {seq_id, chunk, timestamp} for packet loss recovery. GET /stream/resend/{seq_id} retrieves cached chunks.
- **BROADCAST_QUEUE**: Global queue.Queue(maxsize=8192) bridges read_stream → broadcast_worker. Non-blocking put avoids read_stream stalls. Broadcast worker drains queue using ThreadPoolExecutor(120) with one task per client, applying browser-specific timeouts.
- **Browser-specific configs** (QUEUE_SIZE_CONFIG, CHUNK_SIZE_CONFIG, HEARTBEAT_CONFIG): Safari gets 32KB chunks, 512-block queue (128MB), 50ms heartbeat. Firefox/Chrome/Edge get 192KB chunks, 64-block queue (16MB), 1s heartbeat. Timeout 20s for Safari, 40s for others. Configure via [models/stream.py](models/stream.py) dicts or override in [app.py](app.py) `detect_browser_and_apply_config()`.

## Data contracts & conventions
- **Song dicts** must include url, title, type (local/youtube), duration, thumbnail_url; song objects (LocalSong/StreamSong in [models/song.py](models/song.py)) expose to_dict(), is_local(), is_stream(). StreamSong auto-derives thumbnail via YouTube's img.youtube.com/vi/{video_id}/default.jpg.
- **Playlist IDs**: "default" is system reserved (cannot delete); others are str(int(time.time()*1000)). Current playlist tracked via `CURRENT_PLAYLIST_ID` global var syncing frontend selection.
- **API responses**: Always `{"status": "OK"|"ERROR", "message": "...", "data": {...}}`; errors often include "error" field. Preserve Chinese UI strings (e.g., "加载中…", "播放失败", "1小时前") for bilingual support.
- **JSON state files**: playback_history.json (array of {url, title, type, ts/timestamp}), playlists.json (dict {playlist_id → {id, name, songs:[], created_at, updated_at}}). Auto-saved on mutations via PLAYLISTS_MANAGER.save().

## Adding/using routes
- Define in [app.py](app.py) with FastAPI decorators (@app.post, @app.get, @app.delete); call global singletons (PLAYER, PLAYLISTS_MANAGER, RANK_MANAGER, SETTINGS). Keep field names sync'd with frontend FormData calls in [static/js/api.js](static/js/api.js).
- **Streaming routes**: /stream/play (audio to browser), /stream/aac (AAC-specific), /stream/control (start/stop), /stream/status (diagnostics). All support async generators with queue-per-client architecture.
- **Settings routes**: /settings (GET returns all settings, POST updates batch), /settings/{key} (POST to set single key), /settings/reset (POST to reset to defaults). All validate key against SETTINGS.DEFAULT_SETTINGS before applying.
- /status endpoint returns combined MPV properties (paused, time_pos, duration, volume) + current_meta snapshot for ~500ms polling.

## Frontend patterns
- [static/js/api.js](static/js/api.js) centralizes fetch helpers with error handling; [static/js/main.js](static/js/main.js) MusicPlayerApp class initializes via ES6 imports (PlayerManager via player.js, PlaylistManager via playlist.js, SearchManager via search.js, RankingManager via ranking.js, VolumeControl via volume.js, ThemeManager via themeManager.js, SettingsManager via settingsManager.js).
- **Settings UI** in [static/js/settingsManager.js](static/js/settingsManager.js): manages theme (light/dark/auto), language (auto/zh/en), auto_stream (bool), stream_volume (0-100). Settings sync with /settings endpoints; all values auto-persist in user_settings.json. Theme changes apply immediately; language changes require reload.
- **Queue dedup**: Frontend tracks playlistUrlSet to prevent duplicate entries.
- **Ranking UI** in [static/js/ranking.js](static/js/ranking.js); formats dates as Chinese relative time (e.g., "1小时前", "3天前").
- **Search** uses debounced input (300ms) with localStorage history; drag-drop reordering in [static/js/playlist.js](static/js/playlist.js) supports mobile touch events; local song tree browsing in [static/js/local.js](static/js/local.js).

## Ranking & history specifics
- **Endpoint**: GET /ranking?period=all|week|month returns {status, period, ranking:[{url,title,type,thumbnail_url,play_count,last_played}]}.
- **History tracking**: All plays recorded to playback_history.json with timestamp on each play() call. HitRank filters by time period (7/30 days or all-time).

## User Settings & Persistence
- **UserSettings class** ([models/settings.py](models/settings.py)): singleton managing theme, language, auto_stream, stream_volume via user_settings.json. Keys auto-validated against DEFAULT_SETTINGS—invalid keys removed on load. Methods: get(key, default), set(key, value), update(dict), get_all(), reset().
- **Backend endpoints** (/settings, /settings/{key}, /settings/reset): validate key before applying changes; return 400 if invalid key. Always preserve valid keys only (see line ~1319 in app.py for validation pattern).
- **Frontend sync**: SettingsManager loads at app init, listens to POST /settings responses, applies theme/language immediately. Changes logged; no full reload needed except language changes (i18n).
- **Common pattern**: Frontend calls POST /settings/{key} with {value: ...}; backend validates key, calls SETTINGS.set(key, value), returns updated settings. Always check SETTINGS.DEFAULT_SETTINGS before adding new keys.

## Testing & validation
- Manual checks: /stream/status for streaming health, /ranking?period=all for history data, browser Network tab for audio chunks.
- YouTube tests require yt-dlp.exe available; see test/test_youtube_*.py. Bilingual: ensure str() doesn't break UTF-8 formatting.

## Common pitfalls
- **Safari audio dropout** (2024 CRITICAL FIX): Only occurs if stream.py thread architecture is broken. Symptoms: audio works 3-5 sec then cuts out. Verify: (1) three threads running in start_stream_reader_thread() (read_stream, broadcast_worker, send_heartbeats); (2) broadcast is non-blocking (AsyncQueue/async-safe); (3) sequence-numbered keepalive packets maintain connection; (4) browser detection in app.py applies queue_size_for_browser(). See [doc/SAFARI_STREAMING_FIX_COMPLETE.md](doc/SAFARI_STREAMING_FIX_COMPLETE.md) for complete optimization details.
- **MPV path/pipe mismatch** causes silent failures—verify settings.ini `[app].mpv_cmd` and PLAYER.pipe_name match. If both correct but MPV still won't spawn: check if mpv.exe already running with same pipe name (Get-Process mpv).
- **FFmpeg audio device missing** (CRITICAL): If /stream/play shows "音频设备名称为空" error, FFmpeg cannot find audio input device. Verify: (1) VB-Cable installed (https://vb-audio.com/Cable/); (2) [paths] audio_input_device in settings.ini matches system device name; (3) use `ffmpeg -list_devices true -f dshow -i dummy` to list available devices. Startup logs provide device list automatically.
- **FFmpeg not in PATH**: /stream endpoints silently fail if FFmpeg unavailable. Use GET /stream/status to diagnose. find_ffmpeg() in stream.py checks PATH, C:\ffmpeg\*, Program Files.
- **Async title arrival**: YouTube titles arrive asynchronously; UI falls back to current_title → media_title → title → name → url.
- **Config not hot-reloaded**: Restart after settings.ini edits (main.py reads it once at startup).
- **Song dict validation**: Always validate song.get("type") is "local"|"youtube" and thumbnail_url exists before display.
- **Import-time state**: app.py loads JSON state on module import—state mutations during testing can leak between tests. Use fresh Python process for each test run.
- **UTF-8 encoding**: Windows PowerShell may corrupt Chinese strings if logging module not set to UTF-8. Always check encoding at module startup.
- **Streaming disabled**: Setting enable_stream=false in settings.ini [app] section disables all /stream endpoints (returns 403). Check [models/stream.py](models/stream.py) start_ffmpeg_stream() for enable_stream validation.

## Windows-specific & logging patterns
- **UTF-8 handling**: Both [main.py](main.py) and [models/player.py](models/player.py) force UTF-8 on stdout/stderr at startup. Any new module handling bilingual strings must replicate this check. Failures cause Chinese UI text corruption on Windows console.
- **Logging filters**: [main.py](main.py) defines `PollingRequestFilter` class to suppress high-frequency /status requests (samples 1/10) while preserving /stream diagnostic logs. Add path to `FILTERED_PATHS` set to mute new endpoints.
- **Process management**: MPV spawned via `subprocess.Popen(..., stdin=subprocess.PIPE, ...)` with automatic restart on crash (see `ensure_mpv()` in player.py). FFmpeg spawned similarly in stream.py with thread-safe queue management. Use CREATE_NEW_PROCESS_GROUP flag on Windows to isolate processes from parent console.
- **Named pipe IPC**: Windows-only mechanism via `\\.\pipe\mpv-pipe`. Commands sent as JSON lines; responses parsed synchronously. Pipe creation fails silently if mpv.exe not in PATH or already running with same pipe name.

## Key API patterns & request flow
- **Unified play() method**: [models/player.py](models/player.py) `play(song, ...)` dispatches to `song.play()` which branches on song type (LocalSong vs StreamSong). Always call through unified interface, not individual play_index()/play_url() methods.
- **FormData posting**: Frontend uses FormData for multipart uploads; backend receives via `await request.form()`. Field names must match exactly (e.g., "url", "title", "type", "stream_format"). See [static/js/api.js](static/js/api.js) and [app.py](app.py) /play route.
- **Playlist mutations**: All playlist operations (add, remove, reorder) go through PLAYLISTS_MANAGER singleton. After mutation, always call `PLAYLISTS_MANAGER.save()` to persist. Frontend polls /playlist endpoint (~500ms) to reflect UI changes.
- **Current playlist switching**: CURRENT_PLAYLIST_ID global variable tracks active playlist. Updated via /playlists/{id}/switch endpoint. Frontend syncs on startup and after each playlist selection.
- **YouTube metadata extraction**: Async process via mpv's media-title polling (20 retries × 0.5s = 10 sec timeout). Fallback chain: media_title → name → "加载中…". See [models/player.py](models/player.py) play_url() for implementation.

## State mutations & file I/O
- All state changes auto-save: PLAYLISTS_MANAGER.save() called after create/update/delete. Never manually edit JSON—use API/model methods only.
- Thread-safe access: MPV commands are sequential (pipe is non-blocking); file I/O wrapped in try-except with fallback to in-memory state if write fails.

## YouTube/stream specifics
- YouTube playback uses yt-dlp for URL extraction; [models/player.py](models/player.py) play() method caches metadata asynchronously. Streams have type="youtube" and no local path.
- FFmpeg streaming: start_ffmpeg_stream(device_name, audio_format) spawns FFmpeg subprocess with queue.Queue per client. Clients registered via register_client(client_id); data flows client_queue → async generator → browser.

## Dependencies & external tools
- **Python**: fastapi, uvicorn[standard], python-multipart, yt-dlp, Pillow, psutil, requests, pyinstaller (see [requirements.txt](requirements.txt))
- **External executables**: mpv.exe (required, audio/video playback), yt-dlp.exe (optional, YouTube), ffmpeg.exe (optional, browser streaming). Only mpv.exe bundled in PyInstaller; others must be downloaded/installed separately.
- **Windows-specific**: UTF-8 stdout forced in [main.py](main.py) and [models/player.py](models/player.py); named pipe IPC via `\\.\pipe\mpv-pipe`; FFmpeg audio capture via dshow (-f dshow -i audio="...").

## Quick Debugging Checklist
- **Settings changes not persisting**: Check user_settings.json exists in project root; verify SETTINGS.save() called after update (should be automatic via endpoint). Restart required for settings.ini changes (not user_settings.json).
- **Playback fails silently**: Check MPV: `Get-Process mpv` and `Test-Path "\\.\pipe\mpv-pipe"`. Verify settings.ini `[app].mpv_cmd` path exists. Check PLAYER.pipe_name matches MPV_CMD args. See [models/player.py](models/player.py) `ensure_mpv()`.
- **Streaming audio cuts out (Safari/Chrome)**: Verify three threads in stream.py (read_stream, broadcast_worker, send_heartbeats) active. Check get_keepalive_chunk() format support (MP3/AAC/FLAC). See [doc/SAFARI_STREAMING_FIX_COMPLETE.md](doc/SAFARI_STREAMING_FIX_COMPLETE.md).
- **YouTube fails**: Check yt-dlp.exe in PATH. Verify YouTube URL extraction in PLAYER.play(). See [test/test_youtube_simple.py](test/test_youtube_simple.py). Titles arrive async—UI falls back: current_title → media_title → title → name → url.
- **Settings UI not loading**: Check SettingsManager.init() called in main.js; verify /settings endpoint returns valid schema. Check browser console for fetch errors.
- **High CPU from /status polling**: Already filtered in [main.py](main.py) (PollingRequestFilter samples 1/10). Add new high-frequency paths to FILTERED_PATHS set to reduce logging noise.

## More references
- See [README.md](README.md) for feature overview and setup instructions. Detailed issue tracking and optimization history in [doc/](doc/) folder (SAFARI_STREAMING_FIX_COMPLETE.md covers 2024 critical streaming fixes).