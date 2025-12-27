# 🎵 ClubMusic

A full-featured web-based music player supporting local files and YouTube streaming, with playlist management, playback history tracking, ranking statistics, and **browser audio streaming**.

[中文文档](README.md)

## ✨ Core Features

### 🎼 Music Playback
- **Local Playback**: Support for MP3, WAV, FLAC, AAC, M4A and more
- **YouTube Streaming**: Search and play YouTube music directly
- **Playback Controls**: Pause/resume, progress bar, volume control
- **Playback History**: Automatic recording of all played songs

### 🎙️ Browser Streaming (v6.0 New)
- **VB-Cable + FFmpeg**: Stream local audio to browser playback
- **Multi-format Support**: AAC, MP3, FLAC audio encoding
- **Low Latency Optimization**: 70% latency reduction with optimized FFmpeg parameters
- **Safari Compatible**: 3-thread async broadcast architecture for Safari
- **Stream Status Indicator**: Real-time status display (playing/buffering/closed/disabled)

### 📋 Playlist Management
- **Multiple Playlists**: Create, edit, delete custom playlists
- **Playlist Persistence**: Automatic saving of all playlist data
- **Drag & Drop Sorting**: Desktop and mobile drag-to-reorder support

### 🏆 Ranking Statistics
- **Play Count Tracking**: Record play count for each song
- **Time Period Stats**: All time / This week / This month rankings
- **Quick Play**: Click ranking songs to play directly

### 🎨 User Interface
- **Responsive Design**: Adapts to desktop, tablet, and mobile
- **Light/Dark Theme**: Theme switching support
- **Multi-language**: Chinese/English interface
- **Toast Notifications**: Centered feedback display

## 🚀 Quick Start

### System Requirements
- Python 3.8+
- mpv player
- FFmpeg (for streaming)
- VB-Cable (for streaming)
- yt-dlp (for YouTube)

### Installation

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure settings.ini**
   ```ini
   [app]
   music_dir=Z:\                      # Local music directory
   allowed_extensions=.mp3,.wav,.flac,.aac,.m4a
   server_host=0.0.0.0
   server_port=80
   enable_stream=true                 # Enable streaming
   default_stream_format=aac          # Default stream format
   ```

3. **Start Application**
   ```bash
   python main.py
   ```

4. **Access Player**
   Open browser: `http://localhost:80`

### Build to EXE
```bash
.\build_exe.bat
```
Output `app.exe` in `dist/` directory.

## 📁 Project Structure

```
ClubMusic/
├── app.py                 # FastAPI main app (2300+ lines, 60+ routes)
├── main.py                # Entry point
├── settings.ini           # Configuration
├── models/
│   ├── player.py          # MPV player control (1500+ lines)
│   ├── stream.py          # FFmpeg streaming module (1500+ lines)
│   ├── song.py            # Song data model
│   ├── playlist.py        # Playlist management
│   ├── playlists.py       # Multi-playlist management
│   ├── rank.py            # Playback history and rankings
│   ├── settings.py        # User settings
│   └── logger.py          # Logging module
├── static/
│   ├── js/                # Frontend JavaScript modules
│   └── css/               # Style files
├── templates/
│   └── index.html         # Main page
├── bin/                   # Executables (ffmpeg, yt-dlp)
├── doc/                   # Documentation
├── playlists.json         # Playlist data
├── playback_history.json  # Playback history
└── requirements.txt       # Python dependencies
```

## 🎮 User Guide

### Playing Local Music
1. Ensure `music_dir` in `settings.ini` points to correct directory
2. Click "Local" tab in bottom navigation
3. Browse folder tree, click song name to play
4. Local songs display in fullscreen modal

### Playing YouTube Music
1. Click "Search" tab in bottom navigation
2. Enter song name or URL
3. Select from search results
4. Song auto-adds to queue and plays

### Managing Playlists
1. **Create**: Click "+" button in playlist management
2. **Add Songs**: Select songs from queue to add
3. **Switch**: Click playlist name to switch
4. **Delete**: (Default playlist cannot be deleted)

### Queue Operations
- **Drag Sort**: Mouse drag or touch handle (☰) to reorder
- **Swipe Delete**: Swipe right on mobile to show delete
- **Current Song**: Supports drag sorting and swipe delete

### Playback Controls
- **Pause/Resume**: Click center play button
- **Seek**: Click or drag progress bar
- **Volume**: Use volume controller
- **Quick Search**: Click search button

### Rankings
1. Click "Ranking" tab in bottom navigation
2. Switch time period: "All", "Week", or "Month"
3. Songs sorted by play count (up to 100)
4. Click song to play directly

### Bottom Navigation
- **📚 Playlist**: View and manage queue
- **🎵 Local**: Browse local music (fullscreen)
- **🏆 Ranking**: View play rankings (fullscreen)
- **🔍 Search**: Search YouTube and local music

## 🔧 API Endpoints

### Playback Control
- `POST /play` - Play song (`insert_front=1` to insert before current)
- `POST /toggle_pause` - Toggle pause state
- `POST /ensure_playing` - Ensure playing (resume if paused)
- `GET /status` - Get playback status

### Queue Management
- `GET /play_queue` - Get play queue
- `GET /combined_queue` - Get combined queue (local + YouTube)
- `POST /play_song` - Add song to queue
- `POST /play_queue_remove` - Remove from queue
- `POST /play_queue_play` - Play song in queue
- `POST /play_queue_reorder` - Reorder queue

### Playback History
- `GET /playback_history` - Get history (with play_count)
- `POST /song_add_to_history` - Add to history

### Playlist Management
- `GET /playlists` - Get all playlists
- `POST /playlist_create` - Create new playlist
- `POST /playlist_delete` - Delete playlist
- `POST /playlist_add_song` - Add song to playlist
- `POST /playlist_remove_song` - Remove song from playlist

### Search
- `POST /search_song` - **Unified search API**
  - Params: `query`, `type` ('youtube', 'local', 'all')
  - Supports YouTube, local, or both sources
- `POST /search_youtube` - Search YouTube
- `GET /local_songs` - Get local music list

### Streaming
- `GET /stream/play` - Audio stream endpoint
- `POST /stream/control` - Start/stop streaming
- `GET /stream/status` - Stream status

## 📊 Data Storage

### JSON Data Files
- **playlists.json** - All playlists and songs
- **playlist.json** - Current play queue
- **playback_history.json** - Playback history
  - Fields: `url`, `name`, `type`, `ts`, `thumbnail_url`, `play_count`
  - Managed by `HitRank` class in `models/rank.py`

### Data Persistence
- All operations auto-save to local JSON files
- App restart restores previous playback state
- Play count auto-increments
- Rankings update in real-time

## 🌐 Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari, Chrome Mobile)

## 🔐 Security

- POST method validation for all API requests
- YouTube URL normalization to prevent duplicates
- File path security checks against directory traversal
- Queue URL tracking to prevent duplicate additions

## 🐛 Known Limitations

- YouTube streaming depends on yt-dlp, may be subject to YouTube restrictions
- Some region-restricted YouTube content may be inaccessible
- Local music directory must be configured before app startup

## 📦 Dependencies

See `requirements.txt` for full list

Key dependencies:
- **FastAPI** - Web framework
- **yt-dlp** - YouTube downloader
- **uvicorn** - ASGI server
- **python-multipart** - Form data handling

## 🎁 Feature Highlights

✅ Complete playback controls (progress, volume, pause)  
✅ Local + YouTube dual-source playback  
✅ Multi-playlist management with persistence  
✅ Advanced rankings (time periods, play count tracking)  
✅ Drag sorting including current song  
✅ Swipe delete with unified logic  
✅ Complete playback history with play counts  
✅ Responsive design for all devices  
✅ Real-time local and YouTube search  
✅ Browser audio streaming (VB-Cable + FFmpeg)  
✅ Safari-optimized 3-thread broadcast architecture  
✅ Low-latency FFmpeg parameter optimization  
✅ Stream status indicator  
✅ Light/Dark theme support  
✅ Chinese/English interface  

## 📜 License

MIT License

## 🤝 Contributing

Issues and Pull Requests welcome!

## 📞 Support

Having issues? Check:
1. Is `settings.ini` configured correctly?
2. Does the local music directory exist?
3. Are mpv and yt-dlp installed correctly?
4. Any errors in browser console?

---

**Version**: 6.0.0  
**Updated**: December 2025  
**License**: MIT License
