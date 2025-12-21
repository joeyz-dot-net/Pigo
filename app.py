# -*- coding: utf-8 -*-
"""
FastAPI Music Player - 纯FastAPI实现，彻底移除Flask依赖
"""

import os
import sys
import json
import time
import logging
import hashlib
import random
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
import uuid
import asyncio
import queue

# ============================================
# 初始化模块
# ============================================

print("\n" + "="*50)
print("初始化 FastAPI 音乐播放器...")
print("="*50 + "\n")

# 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from models import (
    Song,
    LocalSong,
    StreamSong,
    Playlist,
    LocalPlaylist,
    MusicPlayer,
    Playlists,
    HitRank,
)



from models.settings import initialize_settings

print("\n✓ 所有模块初始化完成！\n")

# ============================================
# 资源路径辅助函数
# ============================================

def _get_resource_path(relative_path):
    """获取资源文件的绝对路径，支持打包后的环境"""
    if getattr(sys, "frozen", False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

# ============================================
# 创建全局播放器实例
# ============================================

PLAYER = MusicPlayer.initialize(data_dir=".")
PLAYLISTS_MANAGER = Playlists(data_file="playlists.json")
RANK_MANAGER = HitRank(max_size=100)
SETTINGS = initialize_settings()

DEFAULT_PLAYLIST_ID = "default"
CURRENT_PLAYLIST_ID = DEFAULT_PLAYLIST_ID
PLAYBACK_HISTORY = PLAYER.playback_history

# 初始化默认歌单
def _init_default_playlist():
    """初始化系统默认歌单"""
    default_pl = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
    if not default_pl:
        default_pl = PLAYLISTS_MANAGER.create_playlist("我的音乐")
        default_pl.id = DEFAULT_PLAYLIST_ID
        PLAYLISTS_MANAGER._playlists[DEFAULT_PLAYLIST_ID] = default_pl
        PLAYLISTS_MANAGER.save()
        print(f"[DEBUG] 创建默认歌单: {DEFAULT_PLAYLIST_ID}")
    return default_pl

# 确保默认歌单存在
_init_default_playlist()

# ============================================
# 创建 FastAPI 应用
# ============================================

app = FastAPI(
    title="MusicPlayer",
    description="FastAPI 音乐播放器",
    version="2.0.0"
)

# 添加 CORS 中间件（允许跨域请求）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """应用启动时的初始化事件"""
    logger.info("[APP] 应用启动完成")

# ============================================
# 挂载静态文件
# ============================================

try:
    static_dir = _get_resource_path("static")
    if os.path.isdir(static_dir):
        print(f"[DEBUG] 静态文件目录: {static_dir}")
        app.mount("/static", StaticFiles(directory=static_dir, check_dir=True), name="static")
        print(f"[INFO] 静态文件已挂载到 /static")
    else:
        print(f"[错误] 静态文件目录不存在: {static_dir}")
except Exception as e:
    print(f"[警告] 无法挂载static文件夹: {e}")
    import traceback
    traceback.print_exc()

# ============================================
# HTML 路由
# ============================================

@app.get("/")
async def index():
    """返回主页面"""
    try:
        index_path = _get_resource_path("templates/index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    except Exception as e:
        return HTMLResponse(f"<h1>错误</h1><p>{str(e)}</p>", status_code=500)

# ============================================
# API 路由：歌单管理
# ============================================

@app.get("/playlist_songs")
async def get_playlist_songs():
    """获取当前歌单的所有歌曲"""
    playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
    songs = playlist.songs if playlist else []
    return {
        "status": "OK",
        "songs": songs,
        "playlist_id": CURRENT_PLAYLIST_ID,
        "playlist_name": playlist.name if playlist else "--"
    }

@app.get("/tree")
async def get_file_tree():
    """获取本地文件树结构"""
    return {
        "status": "OK",
        "tree": PLAYER.local_file_tree
    }

# ============================================
# API 路由：播放控制
# ============================================

@app.post("/play")
async def play(request: Request):
    """播放指定歌曲 - 服务器MPV播放 + 浏览器推流"""
    try:
        form = await request.form()
        url = form.get("url", "").strip()
        title = form.get("title", "").strip()
        song_type = form.get("type", "local").strip()
        stream_format = form.get("stream_format", "mp3").strip() or "mp3"
        
        if not url:
            return JSONResponse(
                {"status": "ERROR", "error": "URL不能为空"},
                status_code=400
            )
        
        # 创建Song对象
        if song_type == "youtube" or url.startswith("http"):
            song = StreamSong(stream_url=url, title=title or url)
        else:
            song = LocalSong(file_path=url, title=title)
        
        # 播放 - 使用 MusicPlayer 的实例方法
        PLAYER.play(
            song,
            mpv_command_func=PLAYER.mpv_command,
            mpv_pipe_exists_func=PLAYER.mpv_pipe_exists,
            ensure_mpv_func=PLAYER.ensure_mpv,
            add_to_history_func=PLAYBACK_HISTORY.add_to_history,
            save_to_history=True
        )
        
        return {
            "status": "OK",
            "message": "播放成功",
            "current": PLAYER.current_meta,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/play_song")
async def play_song(request: Request):
    """播放指定歌曲（别名）"""
    return await play(request)

@app.post("/next")
async def next_track():
    """播放下一首"""
    try:
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        songs = playlist.songs if playlist else []

        if not songs:
            print("[ERROR] /next: 当前歌单为空")
            return JSONResponse(
                {"status": "ERROR", "error": "当前歌单为空"},
                status_code=400
            )

        # 确定下一首的索引（支持循环播放）
        current_idx = PLAYER.current_index if PLAYER.current_index >= 0 else -1
        next_idx = current_idx + 1 if current_idx >= 0 else 0
        
        # 循环播放：如果到达队列底部，返回到第一首
        if next_idx >= len(songs):
            next_idx = 0
        
        print(f"[自动播放] 从索引 {current_idx} 跳到 {next_idx}，总歌曲数：{len(songs)}")

        # 获取下一首歌曲
        song_data = songs[next_idx]
        
        # 处理歌曲数据（可能是dict或字符串路径）
        if isinstance(song_data, dict):
            url = song_data.get("url", "")
            title = song_data.get("title", url)
            song_type = song_data.get("type", "local")
        else:
            url = str(song_data)
            title = os.path.basename(url)
            song_type = "local"

        if not url:
            print(f"[ERROR] /next: 歌曲数据不完整: {song_data}")
            return JSONResponse(
                {"status": "ERROR", "error": "歌曲信息不完整"},
                status_code=400
            )

        # 构造Song对象并播放
        if song_type == "youtube" or url.startswith("http"):
            song = StreamSong(stream_url=url, title=title or url)
            print(f"[自动播放] 播放YouTube: {title}")
        else:
            song = LocalSong(file_path=url, title=title)
            print(f"[自动播放] 播放本地文件: {title}")

        success = PLAYER.play(
            song,
            mpv_command_func=PLAYER.mpv_command,
            mpv_pipe_exists_func=PLAYER.mpv_pipe_exists,
            ensure_mpv_func=PLAYER.ensure_mpv,
            add_to_history_func=PLAYBACK_HISTORY.add_to_history,
            save_to_history=True
        )
        
        if not success:
            print(f"[ERROR] /next: 播放失败")
            return JSONResponse(
                {"status": "ERROR", "error": "播放失败"},
                status_code=500
            )
        
        PLAYER.current_index = next_idx
        print(f"[自动播放] ✓ 已切换到下一首: {title}")

        return {
            "status": "OK",
            "current": PLAYER.current_meta,
            "current_index": PLAYER.current_index,
        }
    except Exception as e:
        import traceback
        print(f"[ERROR] /next 异常: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/prev")
async def prev_track():
    """播放上一首"""
    try:
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        songs = playlist.songs if playlist else []

        if not songs:
            print("[ERROR] /prev: 当前歌单为空")
            return JSONResponse(
                {"status": "ERROR", "error": "当前歌单为空"},
                status_code=400
            )

        # 确定上一首的索引（支持循环播放）
        current_idx = PLAYER.current_index if PLAYER.current_index >= 0 else 0
        prev_idx = current_idx - 1 if current_idx > 0 else len(songs) - 1
        
        # 循环播放：如果在第一首，则回到最后一首
        if prev_idx < 0 or current_idx == 0:
            prev_idx = len(songs) - 1
        
        print(f"[上一首] 从索引 {current_idx} 跳到 {prev_idx}，总歌曲数：{len(songs)}")

        # 获取上一首歌曲
        song_data = songs[prev_idx]
        
        # 处理歌曲数据（可能是dict或字符串路径）
        if isinstance(song_data, dict):
            url = song_data.get("url", "")
            title = song_data.get("title", url)
            song_type = song_data.get("type", "local")
        else:
            url = str(song_data)
            title = os.path.basename(url)
            song_type = "local"

        if not url:
            print(f"[ERROR] /prev: 歌曲数据不完整: {song_data}")
            return JSONResponse(
                {"status": "ERROR", "error": "歌曲信息不完整"},
                status_code=400
            )

        # 构造Song对象并播放
        if song_type == "youtube" or url.startswith("http"):
            song = StreamSong(stream_url=url, title=title or url)
            print(f"[上一首] 播放YouTube: {title}")
        else:
            song = LocalSong(file_path=url, title=title)
            print(f"[上一首] 播放本地文件: {title}")

        success = PLAYER.play(
            song,
            mpv_command_func=PLAYER.mpv_command,
            mpv_pipe_exists_func=PLAYER.mpv_pipe_exists,
            ensure_mpv_func=PLAYER.ensure_mpv,
            add_to_history_func=PLAYBACK_HISTORY.add_to_history,
            save_to_history=True
        )
        
        if not success:
            print(f"[ERROR] /prev: 播放失败")
            return JSONResponse(
                {"status": "ERROR", "error": "播放失败"},
                status_code=500
            )
        
        PLAYER.current_index = prev_idx
        print(f"[上一首] ✓ 已切换到上一首: {title}")

        return {
            "status": "OK",
            "current": PLAYER.current_meta,
            "current_index": PLAYER.current_index,
        }
    except Exception as e:
        import traceback
        print(f"[ERROR] /prev 异常: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/status")
async def get_status():
    """获取播放器状态"""
    playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
    return {
        "status": "OK",
        "current_meta": PLAYER.current_meta,
        "current_playlist_id": CURRENT_PLAYLIST_ID,
        "current_playlist_name": playlist.name if playlist else "--",
        "loop_mode": PLAYER.loop_mode,
        "mpv_state": {
            "paused": mpv_get("pause"),
            "time_pos": mpv_get("time-pos"),
            "duration": mpv_get("duration"),
            "volume": mpv_get("volume")
        }
    }

@app.post("/pause")
async def pause():
    """暂停/继续播放"""
    try:
        paused = mpv_get("pause")
        mpv_command(["set_property", "pause", not paused])
        return {
            "status": "OK",
            "paused": not paused
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/toggle_pause")
async def toggle_pause():
    """暂停/继续播放（别名）"""
    return await pause()

@app.post("/seek")
async def seek(request: Request):
    """跳转到指定位置"""
    try:
        form = await request.form()
        percent = float(form.get("percent", 0))
        
        # 获取总时长
        duration = mpv_get("duration")
        if duration:
            position = (percent / 100) * duration
            mpv_command(["seek", position, "absolute"])
            return {"status": "OK", "position": position}
        else:
            return JSONResponse(
                {"status": "ERROR", "error": "无法获取时长"},
                status_code=400
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/loop")
async def set_loop_mode():
    """设置循环模式"""
    try:
        PLAYER.toggle_loop_mode()
        return {
            "status": "OK",
            "loop_mode": PLAYER.loop_mode
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

# ============================================
# API 路由：搜索
# ============================================

@app.post("/search_song")
async def search_song(request: Request):
    """搜索歌曲（本地 + YouTube）"""
    try:
        data = await request.json()
        query = data.get("query", "").strip()
        
        if not query:
            return JSONResponse(
                {"status": "ERROR", "error": "搜索词不能为空"},
                status_code=400
            )
        
        # 检查是否是 URL（YouTube 播放列表或视频）
        is_url = query.startswith("http://") or query.startswith("https://")
        
        local_results = []
        youtube_results = []
        
        if is_url:
            # 如果是 URL，尝试提取播放列表或视频
            try:
                # 先尝试作为播放列表处理
                playlist_result = StreamSong.extract_playlist(query)
                if playlist_result.get("status") == "OK":
                    youtube_results = playlist_result.get("entries", [])
                    # 如果播放列表为空，可能是单个视频，尝试作为视频处理
                    if not youtube_results:
                        video_result = StreamSong.extract_metadata(query)
                        if video_result.get("status") == "OK":
                            youtube_results = [video_result.get("data", {})]
                else:
                    # 如果不是播放列表，尝试作为单个视频处理
                    video_result = StreamSong.extract_metadata(query)
                    if video_result.get("status") == "OK":
                        youtube_results = [video_result.get("data", {})]
            except Exception as e:
                print(f"[警告] 提取 YouTube URL 失败: {e}")
        else:
            # 本地搜索
            local_results = PLAYER.search_local(query, max_results=PLAYER.local_search_max_results)
            
            # YouTube 关键词搜索
            try:
                yt_search_result = StreamSong.search(query, max_results=PLAYER.youtube_search_max_results)
                if yt_search_result.get("status") == "OK":
                    youtube_results = yt_search_result.get("results", [])
            except Exception as e:
                print(f"[警告] YouTube搜索失败: {e}")
        
        return {
            "status": "OK",
            "local": local_results,
            "youtube": youtube_results
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/search_youtube")
async def search_youtube(request: Request):
    """搜索 YouTube 视频"""
    try:
        form = await request.form()
        query = form.get("query", "").strip()
        
        if not query:
            return JSONResponse(
                {"status": "ERROR", "error": "搜索词不能为空"},
                status_code=400
            )
        
        # 使用 yt-dlp 搜索
        try:
            results = StreamSong.search(query, max_results=10)
            return {
                "status": "OK",
                "results": results
            }
        except Exception as e:
            print(f"[错误] YouTube 搜索失败: {e}")
            return JSONResponse(
                {"status": "ERROR", "error": f"搜索失败: {str(e)}"},
                status_code=500
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

# ============================================
# API 路由：歌单管理
# ============================================

@app.get("/playlists")
async def get_playlists():
    """获取所有歌单"""
    return {
        "status": "OK",
        "playlists": [
            {
                "id": pid,
                "name": p.name,
                "count": len(p.songs),
                "songs": p.songs
            }
            for pid, p in PLAYLISTS_MANAGER._playlists.items()
        ]
    }

@app.post("/playlists")
async def create_playlist_restful(request: Request):
    """创建新歌单 (RESTful API)"""
    try:
        data = await request.json()
        name = data.get("name", "新歌单").strip()
        
        if not name:
            return JSONResponse(
                {"error": "歌单名称不能为空"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.create_playlist(name)
        return {
            "id": playlist.id,
            "name": playlist.name,
            "songs": []
        }
    except Exception as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=500
        )

@app.post("/playlist_create")
async def create_playlist(request: Request):
    """创建新歌单"""
    try:
        data = await request.json()
        name = data.get("name", "新歌单").strip()
        
        playlist = PLAYLISTS_MANAGER.create_playlist(name)
        return {
            "status": "OK",
            "playlist_id": playlist.id,
            "name": playlist.name
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlist_add")
async def add_to_playlist(request: Request):
    """添加歌曲到歌单（支持指定插入位置）"""
    try:
        data = await request.json()
        playlist_id = data.get("playlist_id", CURRENT_PLAYLIST_ID)
        song_data = data.get("song")
        insert_index = data.get("insert_index")  # ✅ 新增：支持指定插入位置
        
        if not song_data:
            return JSONResponse(
                {"status": "ERROR", "error": "歌曲数据不能为空"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            return JSONResponse(
                {"status": "ERROR", "error": "歌单不存在"},
                status_code=404
            )
        
        # ✅ 如果未指定 insert_index，计算默认位置
        if insert_index is None:
            current_index = playlist.current_playing_index if hasattr(playlist, 'current_playing_index') else -1
            # 如果有当前播放的歌曲，则插入到下一个位置；否则插入到第一首之后
            if current_index >= 0 and current_index < len(playlist.songs):
                insert_index = current_index + 1
            else:
                insert_index = 1 if playlist.songs else 0  # 第一首之后，或如果空列表则位置0
        
        # 创建 Song 对象
        song_type = song_data.get("type", "local")
        thumbnail_url = song_data.get("thumbnail_url")
        
        # 如果是 YouTube 歌曲且没有缩略图，自动生成
        if song_type == "youtube" and not thumbnail_url:
            url = song_data.get("url", "")
            if "youtube.com" in url or "youtu.be" in url:
                # 提取视频 ID
                import re
                video_id_match = re.search(r'(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})', url)
                if video_id_match:
                    video_id = video_id_match.group(1)
                    thumbnail_url = f"https://img.youtube.com/vi/{video_id}/default.jpg"
        
        song_obj = Song(
            url=song_data.get("url"),
            title=song_data.get("title"),
            song_type=song_type,
            duration=song_data.get("duration", 0),
            thumbnail_url=thumbnail_url
        )
        
        # 转换为字典格式后插入
        song_dict = song_obj.to_dict()
        # ✅ 确保 insert_index 不超出范围
        insert_index = max(0, min(insert_index, len(playlist.songs)))
        playlist.songs.insert(insert_index, song_dict)
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        return {
            "status": "OK",
            "message": f"已添加到下一曲（位置 {insert_index}）"
        }
    except Exception as e:
        print(f"[ERROR] 添加歌曲失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlists/{playlist_id}/add_next")
async def add_song_to_playlist_next(playlist_id: str, request: Request):
    """添加歌曲到下一曲位置"""
    try:
        form_data = await request.form()
        url = form_data.get('url', '')
        title = form_data.get('title', '')
        song_type = form_data.get('type', 'local')
        thumbnail_url = form_data.get('thumbnail_url', '')
        
        if not url or not title:
            return JSONResponse(
                {"status": "ERROR", "error": "URL 和标题不能为空"},
                status_code=400
            )
        
        # 添加到歌单
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            return JSONResponse(
                {"status": "ERROR", "error": f"歌单 {playlist_id} 不存在"},
                status_code=404
            )
        
        # 如果是 YouTube 歌曲且没有缩略图，自动生成
        if song_type == "youtube" and not thumbnail_url:
            # 提取视频 ID
            import re
            video_id_match = re.search(r'(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})', url)
            if video_id_match:
                video_id = video_id_match.group(1)
                thumbnail_url = f"https://img.youtube.com/vi/{video_id}/default.jpg"
        
        # 创建歌曲对象
        from models.song import Song
        song_obj = Song(
            url=url,
            title=title,
            song_type=song_type,
            duration=0,
            thumbnail_url=thumbnail_url if thumbnail_url else None
        )
        
        # 获取当前播放歌曲的索引（从歌单数据中获取）
        current_index = playlist.current_playing_index if hasattr(playlist, 'current_playing_index') else -1
        
        # 如果有当前播放的歌曲，则插入到下一个位置；否则插入到第一首之后
        if current_index >= 0 and current_index < len(playlist.songs):
            insert_index = current_index + 1
        else:
            insert_index = 1 if playlist.songs else 0  # 第一首之后，或如果空列表则位置0
        
        # 在指定位置插入歌曲
        song_dict = song_obj.to_dict()
        playlist.songs.insert(insert_index, song_dict)
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        return {
            "status": "OK",
            "message": f"已添加到下一曲"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlists/{playlist_id}/add_top")
async def add_song_to_playlist_top(playlist_id: str, request: Request):
    """添加歌曲到歌单顶部"""
    try:
        form_data = await request.form()
        url = form_data.get('url', '')
        title = form_data.get('title', '')
        song_type = form_data.get('type', 'local')
        thumbnail_url = form_data.get('thumbnail_url', '')
        
        if not url or not title:
            return JSONResponse(
                {"status": "ERROR", "error": "URL 和标题不能为空"},
                status_code=400
            )
        
        song_data = {
            "url": url,
            "title": title,
            "type": song_type,
            "duration": 0
        }
        
        if thumbnail_url:
            song_data["thumbnail_url"] = thumbnail_url
        
        # 添加到歌单顶部
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            return JSONResponse(
                {"status": "ERROR", "error": f"歌单 {playlist_id} 不存在"},
                status_code=404
            )
        
        # 使用 add_song 方法添加歌曲
        success = playlist.add_song(song_data)
        
        # 如果添加成功，重新排列使其在顶部
        if success and len(playlist.songs) > 1:
            # 将最后添加的歌曲移到顶部
            playlist.songs.insert(0, playlist.songs.pop())
        
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        return {
            "status": "OK",
            "message": "已添加到歌单顶部"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/playlist")
async def get_current_playlist():
    """获取当前播放队列"""
    try:
        songs = []

        # 优先使用多歌单管理器中的当前歌单数据（包括默认歌单）
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        # 如果当前歌单缺失，回退到默认歌单
        if not playlist:
            playlist = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
            # 同时修正当前歌单ID，保持前后端一致
            if playlist:
                globals()["CURRENT_PLAYLIST_ID"] = DEFAULT_PLAYLIST_ID
        if playlist and hasattr(playlist, "songs"):
            for s in playlist.songs:
                if isinstance(s, dict):
                    # 确保包含基本字段
                    songs.append(
                        {
                            "url": s.get("url"),
                            "title": s.get("title") or s.get("name") or s.get("url"),
                            "type": s.get("type", "local"),
                            "duration": s.get("duration", 0),
                            "thumbnail_url": s.get("thumbnail_url", ""),
                        }
                    )
                elif isinstance(s, str):
                    # 兼容旧字符串列表
                    songs.append(
                        {
                            "url": s,
                            "title": os.path.basename(s),
                            "type": "local",
                        }
                    )
        else:
            # 没有找到当前歌单，返回空列表
            songs = []
        
        # 获取当前播放索引
        current_index = -1
        try:
            current_index = PLAYER.current_index if hasattr(PLAYER, 'current_index') else -1
        except:
            pass
        
        # 获取当前歌单名称
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if not playlist:
            playlist = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
        playlist_name = playlist.name if playlist else "--"
        
        return {
            "status": "OK",
            "playlist": songs,  # 前端期望的字段名是 playlist
            "playlist_name": playlist_name,  # 添加歌单名称
            "current_index": current_index
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/volume")
async def set_volume(request: Request):
    """设置或获取音量"""
    try:
        form = await request.form()
        volume_str = form.get("value", "").strip()
        
        if volume_str:
            # 设置音量
            try:
                volume = int(volume_str)
                volume = max(0, min(100, volume))  # 限制在0-100
                PLAYER.mpv_command(["set_property", "volume", volume])
                return {
                    "status": "OK",
                    "volume": volume
                }
            except ValueError as e:
                return JSONResponse(
                    {"status": "ERROR", "error": f"无效的音量值: {volume_str}"},
                    status_code=400
                )
        else:
            # 获取当前音量
            try:
                current_volume = PLAYER.mpv_get("volume")
                if current_volume is None:
                    # MPV 未运行或未设置音量，返回默认值
                    return {
                        "status": "OK",
                        "volume": 50
                    }
                # 确保返回整数
                volume_value = int(float(current_volume))
                return {
                    "status": "OK",
                    "volume": volume_value
                }
            except (ValueError, TypeError) as e:
                print(f"[警告] 获取音量失败: {e}, 当前值: {current_volume}")
                # 返回默认音量
                return {
                    "status": "OK",
                    "volume": 50
                }
    except Exception as e:
        print(f"[错误] /volume 路由异常: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str):
    """删除歌单"""
    try:
        # 防止删除默认歌单
        if playlist_id == "default":
            return JSONResponse(
                {"status": "ERROR", "error": "默认歌单不可删除"},
                status_code=400
            )
        
        if PLAYLISTS_MANAGER.delete_playlist(playlist_id):
            return {
                "status": "OK",
                "message": "删除成功"
            }
        else:
            return JSONResponse(
                {"status": "ERROR", "error": "歌单不存在"},
                status_code=404
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.put("/playlists/{playlist_id}")
async def update_playlist(playlist_id: str, data: dict):
    """更新歌单信息（如名称）"""
    try:
        # 防止修改默认歌单
        if playlist_id == "default":
            return JSONResponse(
                {"status": "ERROR", "error": "默认歌单不可修改"},
                status_code=400
            )
        
        new_name = data.get('name', '').strip()
        if not new_name:
            return JSONResponse(
                {"status": "ERROR", "error": "歌单名称不能为空"},
                status_code=400
            )
        
        if PLAYLISTS_MANAGER.rename_playlist(playlist_id, new_name):
            return {
                "status": "OK",
                "message": "修改成功",
                "data": {"name": new_name}
            }
        else:
            return JSONResponse(
                {"status": "ERROR", "error": "歌单不存在"},
                status_code=404
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlists/{playlist_id}/switch")
async def switch_playlist(playlist_id: str):
    """切换到指定歌单"""
    global CURRENT_PLAYLIST_ID
    
    try:
        # 获取目标歌单
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            return JSONResponse(
                {"error": "歌单不存在"},
                status_code=404
            )
        
        # 切换到新歌单（直接指向目标歌单对象）
        CURRENT_PLAYLIST_ID = playlist_id
        PLAYLISTS_MANAGER.save()
        
        return {
            "status": "OK",
            "playlist": {
                "id": playlist.id,
                "name": playlist.name,
                "count": len(playlist.songs)
            }
        }
    except Exception as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=500
        )

@app.post("/playlist_play")
async def playlist_play(request: Request):
    """播放队列中指定索引的歌曲"""
    try:
        form = await request.form()
        index = int(form.get("index", 0))

        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        songs = playlist.songs if playlist else []

        if 0 <= index < len(songs):
            song_data = songs[index]
            # song_data 可能是 dict，也可能是字符串
            if isinstance(song_data, dict):
                url = song_data.get("url")
                title = song_data.get("title") or url
                song_type = song_data.get("type", "local")
            else:
                url = song_data
                title = os.path.basename(url)
                song_type = "local"

            if song_type == "youtube" or (url and str(url).startswith("http")):
                song = StreamSong(stream_url=url, title=title or url)
            else:
                song = LocalSong(file_path=url, title=title)

            PLAYER.play(song, index=index)
            return JSONResponse({"status": "OK", "message": "播放成功"})
        else:
            return JSONResponse(
                {"status": "ERROR", "error": "索引超出范围"},
                status_code=400
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlist_reorder")
async def playlist_reorder(request: Request):
    """重新排序播放队列"""
    try:
        data = await request.json()
        from_index = data.get("from_index")
        to_index = data.get("to_index")
        
        if from_index is not None and to_index is not None:
            playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
            if playlist and 0 <= from_index < len(playlist.songs) and 0 <= to_index < len(playlist.songs):
                song = playlist.songs.pop(from_index)
                playlist.songs.insert(to_index, song)
                playlist.updated_at = time.time()
                PLAYLISTS_MANAGER.save()
            return JSONResponse({"status": "OK", "message": "重新排序成功"})
        else:
            return JSONResponse(
                {"status": "ERROR", "error": "缺少参数"},
                status_code=400
            )
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlist_remove")
async def playlist_remove(request: Request):
    """从队列移除歌曲"""
    try:
        form = await request.form()
        index = int(form.get("index", -1))
        
        print(f"[DEBUG] playlist_remove - index: {index}, current_playlist_id: {CURRENT_PLAYLIST_ID}")
        
        if index < 0:
            print(f"[ERROR] 无效的索引: {index}")
            return JSONResponse(
                {"status": "ERROR", "error": "无效的索引"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if not playlist:
            print(f"[ERROR] 找不到歌单: {CURRENT_PLAYLIST_ID}")
            return JSONResponse(
                {"status": "ERROR", "error": "找不到歌单"},
                status_code=404
            )
        
        print(f"[DEBUG] 当前歌单歌曲数: {len(playlist.songs)}")
        
        if index >= len(playlist.songs):
            print(f"[ERROR] 索引超出范围: {index} >= {len(playlist.songs)}")
            return JSONResponse(
                {"status": "ERROR", "error": "索引超出范围"},
                status_code=400
            )
        
        song_to_remove = playlist.songs[index]
        print(f"[DEBUG] 准备删除歌曲: {song_to_remove.get('title', 'Unknown') if isinstance(song_to_remove, dict) else song_to_remove}")
        
        playlist.songs.pop(index)
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        print(f"[SUCCESS] 删除成功，剩余歌曲数: {len(playlist.songs)}")
        return JSONResponse({"status": "OK", "message": "删除成功"})
        
    except Exception as e:
        print(f"[EXCEPTION] playlist_remove error: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/playlist_clear")
async def playlist_clear():
    """清空播放队列"""
    try:
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if playlist:
            playlist.songs = []
            playlist.updated_at = time.time()
            PLAYLISTS_MANAGER.save()
        return JSONResponse({"status": "OK", "message": "清空成功"})
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/playback_history")
async def get_playback_history():
    """获取播放历史"""
    try:
        history = PLAYER.playback_history.get_all()
        return {
            "status": "OK",
            "history": history
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/song_add_to_history")
async def song_add_to_history(request: Request):
    """新增一条播放历史记录（替代 /play_queue_add_to_history）"""
    try:
        payload = {}
        content_type = (request.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            payload = await request.json()
        else:
            form = await request.form()
            payload = {k: v for k, v in form.items()}

        url = (payload.get("url") or "").strip()
        title = (payload.get("title") or url).strip()
        song_type = (payload.get("type") or "local").strip().lower()
        thumbnail_url = (payload.get("thumbnail_url") or "").strip() or None

        if not url:
            return JSONResponse(
                {"status": "ERROR", "error": "url不能为空"},
                status_code=400
            )

        is_local = song_type != "youtube"
        PLAYER.playback_history.add_to_history(
            url,
            title or url,
            is_local=is_local,
            thumbnail_url=thumbnail_url
        )

        return {"status": "OK", "message": "已添加到播放历史"}
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/ranking")
async def get_ranking(period: str = "all"):
    """获取播放排行榜
    
    参数:
      period: 时间段 - "all" (全部), "day" (本日), "week" (本周), "month" (本月), "quarter" (近三个月), "year" (近一年)
    
    返回:
      按播放次数排序的歌曲列表（基于时间段过滤播放记录）
    """
    try:
        import time
        from datetime import datetime, timedelta
        
        history = PLAYER.playback_history.get_all()
        
        if not history:
            return {
                "status": "OK",
                "ranking": [],
                "period": period
            }
        
        # 计算时间范围
        now = time.time()
        
        if period == "day":
            # 今天 (00:00:00 至今)
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            cutoff_time = today_start.timestamp()
        elif period == "week":
            # 最近7天
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            week_start = today_start - timedelta(days=7)
            cutoff_time = week_start.timestamp()
        elif period == "month":
            # 最近30天
            cutoff_time = now - (30 * 24 * 60 * 60)
        elif period == "quarter":
            # 最近90天 (季度)
            cutoff_time = now - (90 * 24 * 60 * 60)
        elif period == "year":
            # 最近365天
            cutoff_time = now - (365 * 24 * 60 * 60)
        else:  # "all"
            cutoff_time = 0
        
        # 基于timestamps字段统计各时间段的播放次数
        ranking_dict = {}
        for item in history:
            url = item.get('url', '')
            timestamps_str = item.get('timestamps', '')
            
            if not url or not timestamps_str:
                continue
            
            # 解析timestamps字符串中符合时间范围的播放时间
            try:
                all_timestamps = [int(ts) for ts in timestamps_str.split(',')]
            except:
                continue
            
            # 统计符合时间范围的播放次数
            period_play_count = sum(1 for ts in all_timestamps if ts >= cutoff_time)
            
            # 只有在时间范围内有播放的才加入排行榜
            if period_play_count > 0:
                last_played = max([ts for ts in all_timestamps if ts >= cutoff_time])
                
                ranking_dict[url] = {
                    'url': url,
                    'title': item.get('title', item.get('name', 'Unknown')),
                    'type': item.get('type', 'unknown'),
                    'thumbnail_url': item.get('thumbnail_url'),
                    'play_count': period_play_count,
                    'last_played': last_played
                }
        
        # 按播放次数排序（降序），次数相同则按最后播放时间排序
        ranking = sorted(
            ranking_dict.values(),
            key=lambda x: (-x['play_count'], -x['last_played'])
        )
        
        return {
            "status": "OK",
            "ranking": ranking,
            "period": period
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/youtube_extract_playlist")
async def youtube_extract_playlist(request: Request):
    """提取YouTube播放列表"""
    try:
        form = await request.form()
        url = form.get("url", "").strip()
        
        if not url:
            return JSONResponse(
                {"status": "ERROR", "error": "URL不能为空"},
                status_code=400
            )
        
        # 使用StreamSong提取播放列表
        videos = StreamSong.extract_playlist(url)
        return {
            "status": "OK",
            "videos": videos
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/play_youtube_playlist")
async def play_youtube_playlist(request: Request):
    """播放YouTube播放列表"""
    try:
        data = await request.json()
        videos = data.get("videos", [])
        
        if not videos:
            return JSONResponse(
                {"status": "ERROR", "error": "播放列表为空"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if not playlist:
            playlist = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)

        # 添加所有视频到当前歌单
        for video in videos:
            playlist.songs.append(
                {
                    "url": video.get("url"),
                    "title": video.get("title", ""),
                    "type": "youtube",
                    "duration": video.get("duration", 0),
                    "thumbnail_url": video.get("thumbnail_url", ""),
                }
            )

        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        return {
            "status": "OK",
            "added": len(videos)
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

# ============================================
# MPV 包装函数（便捷调用）
# ============================================

def mpv_command(cmd_list):
    """向 MPV 发送命令"""
    return PLAYER.mpv_command(cmd_list)

def mpv_get(property_name):
    """获取 MPV 属性值"""
    return PLAYER.mpv_get(property_name)

# ============================================
# API 路由：用户设置
# ============================================

@app.get("/settings")
async def get_user_settings():
    """获取默认设置（用户设置由浏览器 localStorage 管理）"""
    try:
        return {
            "status": "OK",
            "data": {
                "theme": "dark",
                "auto_stream": False,
                "stream_volume": 50,
                "language": "auto"
            }
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/settings")
async def update_user_settings(request: Request):
    """设置已由浏览器 localStorage 管理，此接口仅返回成功响应"""
    try:
        data = await request.json()
        logger.info(f"[设置] 浏览器端发送的设置: {data}（已由客户端保存到 localStorage）")
        
        return {
            "status": "OK",
            "message": "设置已保存到浏览器本地存储",
            "data": data
        }
    except Exception as e:
        logger.error(f"[设置] 处理失败: {e}")
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/settings/{key}")
async def update_single_setting(key: str, request: Request):
    """更新单个设置（由浏览器 localStorage 管理）"""
    try:
        data = await request.json()
        value = data.get("value")
        
        # 验证设置项（仅用于验证，实际存储由浏览器处理）
        default_settings = {
            "theme": "dark",
            "auto_stream": False,
            "stream_volume": 50,
            "language": "auto"
        }
        
        if key not in default_settings:
            return JSONResponse(
                {"status": "ERROR", "error": f"未知的设置项: {key}"},
                status_code=400
            )
        
        logger.info(f"[设置] 客户端更新 {key} = {value}（已保存到 localStorage）")
        
        return {
            "status": "OK",
            "message": f"已更新 {key}（客户端存储）",
            "data": {key: value}
        }
    except Exception as e:
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.post("/settings/reset")
async def reset_settings():
    """重置设置为默认值（浏览器 localStorage）"""
    try:
        logger.info("[API] 重置设置请求（浏览器 localStorage）")
        
        default_settings = {
            "theme": "dark",
            "auto_stream": False,
            "stream_volume": 50,
            "language": "auto"
        }
        
        response_data = {
            "status": "OK",
            "message": "已重置为默认设置（请清空 localStorage 重新加载）",
            "data": default_settings
        }
        
        return JSONResponse(response_data, status_code=200)
        
    except Exception as e:
        logger.exception(f"[API] 重置设置异常: {e}")
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/settings/schema")
async def get_settings_schema():
    """获取设置项的描述和可选值"""
    return {
        "status": "OK",
        "schema": {
            "theme": {
                "type": "select",
                "label": "主题样式",
                "options": [
                    {"value": "light", "label": "浅色"},
                    {"value": "dark", "label": "深色"},
                    {"value": "auto", "label": "自动"}
                ],
                "default": "dark"
            },
            "auto_stream": {
                "type": "boolean",
                "label": "自动启动推流",
                "description": "播放音乐时自动启动浏览器推流",
                "default": True
            },
            "stream_volume": {
                "type": "range",
                "label": "推流音量",
                "min": 0,
                "max": 100,
                "default": 50
            },
            "language": {
                "type": "select",
                "label": "语言",
                "options": [
                    {"value": "auto", "label": "自动选择"},
                    {"value": "zh", "label": "中文"},
                    {"value": "en", "label": "English"}
                ],
                "default": "auto"
            }
        }
    }

# ============================================
# 错误处理
# ============================================


# ============================================
# 错误处理
# ============================================

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """全局异常处理器"""
    return JSONResponse(
        {
            "status": "ERROR",
            "error": str(exc)
        },
        status_code=500
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)
