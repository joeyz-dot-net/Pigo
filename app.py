# -*- coding: utf-8 -*-
"""
ClubMusic - 纯FastAPI实现的网页音乐播放器
"""

import os
import sys
import json
import time
import logging
import hashlib
import random
import subprocess
from pathlib import Path
from urllib.parse import unquote

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

logger.info("\n" + "="*50)
logger.info("初始化 ClubMusic...")
logger.info("="*50 + "\n")

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

# ==================== 获取资源路径函数 ====================
def _get_resource_path(relative_path: str) -> str:
    """获取资源路径（支持 PyInstaller 打包后的环境）
    
    PyInstaller 打包后，资源文件被解压到 sys._MEIPASS 临时目录中。
    开发环境下，使用源代码目录。
    """
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后：资源在 _MEIPASS 目录中
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    else:
        # 开发环境
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

# ==================== 全局单例实例 ====================
# 初始化设置
SETTINGS = initialize_settings()

# 初始化播放器实例
PLAYER = MusicPlayer.initialize(data_dir=".")

# 初始化歌单管理器
PLAYLISTS_MANAGER = Playlists()
PLAYLISTS_MANAGER.load()

# 初始化排行榜管理器
RANK_MANAGER = HitRank()

logger.info("\n✓ 所有模块初始化完成！\n")

DEFAULT_PLAYLIST_ID = "default"
CURRENT_PLAYLIST_ID = DEFAULT_PLAYLIST_ID
PLAYBACK_HISTORY = PLAYER.playback_history

# 初始化默认歌单
def _init_default_playlist():
    """初始化系统默认歌单"""
    default_pl = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
    if not default_pl:
        default_pl = PLAYLISTS_MANAGER.create_playlist("正在播放")
        default_pl.id = DEFAULT_PLAYLIST_ID
        PLAYLISTS_MANAGER._playlists[DEFAULT_PLAYLIST_ID] = default_pl
        PLAYLISTS_MANAGER.save()
        logger.debug(f"创建默认歌单: {DEFAULT_PLAYLIST_ID}")
    return default_pl

# 确保默认歌单存在
_init_default_playlist()

# ==================== 浏览器检测函数 ====================
def detect_browser(user_agent: str) -> str:
    """
    从 User-Agent 字符串检测浏览器类型
    
    Args:
        user_agent: HTTP User-Agent 字符串
    
    Returns:
        str: 浏览器类型 (safari, edge, chrome, firefox, opera, unknown)
    """
    ua = user_agent.lower()
    
    # 检测顺序很重要：需要考虑包含关系
    # Opera 检测（必须在 Chrome 之前，因为 Opera 基于 Chromium）
    if 'opr' in ua or 'opera' in ua:
        return 'opera'
    # Edge 在 UA 中显示为 "Edg"（注意不是 Edge）
    elif 'edg' in ua:
        return 'edge'
    # Chrome 检测（必须排除 Edge，因为 Edge Chromium 也包含 chromium）
    elif 'chrome' in ua and 'edg' not in ua:
        return 'chrome'
    # Firefox 检测
    elif 'firefox' in ua:
        return 'firefox'
    # Safari 的 UA 包含 "Safari" 但不包含 "Chrome" 或 "Edg"
    elif 'safari' in ua and 'chrome' not in ua and 'edg' not in ua:
        return 'safari'
    else:
        return 'unknown'


# ==================== Safari 浏览器自适应优化 ====================
def detect_browser_and_apply_config(request: Request) -> dict:
    """根据User-Agent检测浏览器并应用对应的流媒体配置"""
    user_agent = request.headers.get("user-agent", "").lower()
    
    config = {
        "browser": "Unknown",
        "keepalive_interval": 0.5,      # 心跳间隔（秒）
        "chunk_size": 256 * 1024,        # 块大小（字节）
        "queue_timeout": 1.0,            # 队列超时（秒）
        "force_flush": False,            # 强制刷新
        "max_consecutive_empty": 150,    # 最大连续空数据次数
    }
    
    if "safari" in user_agent and "chrome" not in user_agent:
        config.update({
            "browser": "Safari",
            "keepalive_interval": 0.5,   # Safari：生产环境优化心跳（每500ms，降低CPU）
            "chunk_size": 128 * 1024,     # 🔧 优化2：改为128KB（更低延迟）
            "queue_timeout": 1.0,        # Safari：生产环境增加超时到1.0s（提高容错）
            "force_flush": True,         # Safari：强制立即发送
            "max_consecutive_empty": 400,  # 🔧 优化3：增加到400（更宽容，适应生产网络延迟）
        })
    elif "edge" in user_agent or "edg" in user_agent:
        config.update({
            "browser": "Edge",
            "keepalive_interval": 0.5,
            "chunk_size": 256 * 1024,
            "queue_timeout": 1.0,
            "force_flush": False,
            "max_consecutive_empty": 150,
        })
    elif "firefox" in user_agent:
        config.update({
            "browser": "Firefox",
            "keepalive_interval": 0.4,
            "chunk_size": 128 * 1024,
            "queue_timeout": 0.8,
            "force_flush": False,
            "max_consecutive_empty": 150,
        })
    elif "chrome" in user_agent:
        config.update({
            "browser": "Chrome",
            "keepalive_interval": 0.5,
            "chunk_size": 256 * 1024,
            "queue_timeout": 1.0,
            "force_flush": False,
            "max_consecutive_empty": 150,
        })
    
    return config


# ==================== 推流配置读取函数 ====================


# ============================================
# 创建 FastAPI 应用
# ============================================

app = FastAPI(
    title="ClubMusic",
    description="ClubMusic - 网页音乐播放器",
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
    logger.info("应用启动完成")
    # 启动播放进度监控任务
    asyncio.create_task(monitor_playback_progress())

@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时的清理事件"""
    logger.info("应用正在关闭...")
    
    # 清理 MPV 进程
    try:
        if PLAYER and PLAYER.mpv_process:
            logger.info("正在关闭 MPV 进程...")
            PLAYER.mpv_process.terminate()
            try:
                PLAYER.mpv_process.wait(timeout=3)
                logger.info("✅ MPV 进程已正常关闭")
            except:
                logger.warning("MPV 进程未响应，强制终止...")
                PLAYER.mpv_process.kill()
                logger.info("✅ MPV 进程已强制终止")
    except Exception as e:
        logger.error(f"关闭 MPV 进程失败: {e}")
        # 尝试使用 taskkill 强制终止
        try:
            import subprocess
            subprocess.run(["taskkill", "/IM", "mpv.exe", "/F"], capture_output=True, timeout=2)
            logger.info("✅ 使用 taskkill 强制终止 MPV 进程")
        except:
            pass
    
    logger.info("应用已关闭")

async def monitor_playback_progress():
    """监控播放进度，智能聚合重复日志"""
    logger.info("🎵 播放进度监控任务已启动")
    
    last_log_time = 0
    log_interval = 5  # 采样间隔：每5秒输出一次日志
    last_log_hash = None  # 追踪上一条日志的哈希值
    consecutive_same_logs = 0  # 连续相同日志计数
    
    while True:
        await asyncio.sleep(5)  # 每5秒检查一次
        
        # 仅在有歌曲播放时输出
        if not PLAYER.current_meta or not PLAYER.current_meta.get("url"):
            last_log_hash = None  # 重置哈希
            consecutive_same_logs = 0
            continue
        
        try:
            current_time = time.time()
            
            # 采样：仅在时间间隔足够时输出日志
            if current_time - last_log_time < log_interval:
                continue
            
            # 获取 MPV 状态
            paused = mpv_get("pause")
            time_pos = mpv_get("time-pos") or 0
            duration = mpv_get("duration") or 0
            volume = mpv_get("volume") or 0
            
            # 格式化时间显示
            def format_time(seconds):
                mins = int(seconds // 60)
                secs = int(seconds % 60)
                return f"{mins:02d}:{secs:02d}"
            
            # 获取歌曲信息
            title = PLAYER.current_meta.get("title", "未知歌曲")
            song_type = PLAYER.current_meta.get("type", "unknown")
            
            # 计算进度百分比
            progress_percent = (time_pos / duration * 100) if duration > 0 else 0
            
            # 构建日志内容（不含时间戳）
            log_content = (
                f"🎵 [播放监控] "
                f"{title} | "
                f"{'⏸️ 暂停' if paused else '▶️ 播放中'} | "
                f"进度: {format_time(time_pos)}/{format_time(duration)} ({progress_percent:.1f}%) | "
                f"音量: {int(volume)}% | "
                f"类型: {song_type}"
            )
            
            # 计算日志哈希值，用于检测重复
            log_hash = hashlib.md5(log_content.encode()).hexdigest()
            
            # ✅ 日志去重逻辑
            if log_hash == last_log_hash:
                # 与上一条日志相同
                consecutive_same_logs += 1
                
                # 只在第一次重复时输出"..."提示，避免继续刷屏
                if consecutive_same_logs == 1:
                    logger.info(f"🎵 [播放监控] ... (持续播放中，5秒后更新状态)")
                
                # 不输出完整日志内容，只更新时间戳
                last_log_time = current_time
                continue
            else:
                # 日志内容改变了
                if consecutive_same_logs > 0:
                    # 之前有连续的重复日志，现在输出新日志
                    logger.info(f"🎵 [播放监控] (重复 {consecutive_same_logs} 次后更新)")
                
                # 输出新日志
                logger.info(log_content)
                last_log_hash = log_hash
                consecutive_same_logs = 0
                last_log_time = current_time
            
        except Exception as e:
            logger.warning(f"监控任务异常: {e}")
            last_log_hash = None
            consecutive_same_logs = 0
            continue

# ============================================
# 挂载静态文件
# ============================================

# 🔥 优先处理 preview.png：如果程序运行目录有此文件，优先使用
@app.get("/static/images/preview.png")
async def get_preview_image():
    """
    获取预览图片
    优先级：
    1. 程序运行目录的 preview.png
    2. static/images/preview.png
    """
    # 检查程序运行目录
    local_preview = os.path.join(os.getcwd(), "preview.png")
    if os.path.isfile(local_preview):
        return FileResponse(local_preview, media_type="image/png")
    
    # 回退到静态目录
    static_preview = _get_resource_path("static/images/preview.png")
    if os.path.isfile(static_preview):
        return FileResponse(static_preview, media_type="image/png")
    
    raise HTTPException(status_code=404, detail="Preview image not found")

try:
    static_dir = _get_resource_path("static")
    if os.path.isdir(static_dir):
        logger.debug(f"静态文件目录: {static_dir}")
        app.mount("/static", StaticFiles(directory=static_dir, check_dir=True), name="static")
        logger.info(f"静态文件已挂载到 /static")
    else:
        logger.error(f"静态文件目录不存在: {static_dir}")
except Exception as e:
    logger.warning(f"无法挂载static文件夹: {e}")
    import traceback
    traceback.print_exc()

# ============================================
# 常见封面文件名
# ============================================
COVER_FILENAMES = [
    "cover.jpg", "cover.png", "cover.jpeg",
    "folder.jpg", "folder.png", "folder.jpeg",
    "album.jpg", "album.png", "album.jpeg",
    "front.jpg", "front.png", "front.jpeg",
    "albumart.jpg", "albumart.png", "albumart.jpeg",
    "Cover.jpg", "Cover.png", "Folder.jpg", "Folder.png",
]

def _get_cover_from_directory(file_path: str) -> str:
    """从音频文件所在目录查找封面文件"""
    directory = os.path.dirname(file_path)
    for cover_name in COVER_FILENAMES:
        cover_path = os.path.join(directory, cover_name)
        if os.path.isfile(cover_path):
            return cover_path
    return None

def _extract_embedded_cover_bytes(file_path: str) -> bytes:
    """使用 mutagen 提取音频文件内嵌封面，返回字节数据（不保存文件）
    
    支持格式：MP3 (ID3)、FLAC、M4A/AAC (MP4)、OGG/Opus
    """
    try:
        from mutagen import File
        from mutagen.id3 import ID3
        from mutagen.flac import FLAC
        from mutagen.mp4 import MP4
        from mutagen.oggvorbis import OggVorbis
        from mutagen.oggopus import OggOpus
        
        audio = File(file_path)
        if audio is None:
            return None
        
        # MP3: ID3 标签中的 APIC 帧
        if hasattr(audio, 'tags') and audio.tags:
            # ID3 格式 (MP3)
            if isinstance(audio.tags, ID3):
                for key in audio.tags:
                    if key.startswith('APIC'):
                        apic = audio.tags[key]
                        return apic.data
            
            # MP4/M4A 格式
            if isinstance(audio, MP4):
                if 'covr' in audio.tags:
                    covers = audio.tags['covr']
                    if covers:
                        return bytes(covers[0])
        
        # FLAC 格式
        if isinstance(audio, FLAC):
            if audio.pictures:
                return audio.pictures[0].data
        
        # OGG/Opus 格式
        if isinstance(audio, (OggVorbis, OggOpus)):
            if hasattr(audio, 'pictures') and audio.pictures:
                return audio.pictures[0].data
        
    except Exception as e:
        logger.debug(f"提取内嵌封面失败: {e}")
    return None

@app.get("/cover/{file_path:path}")
async def get_cover(file_path: str):
    """获取本地歌曲或目录的封面
    
    对于文件：
    1. 优先提取音频文件内嵌封面（不保存，直接返回）
    2. 回退到所在目录中的 cover.jpg/folder.jpg 等
    
    对于目录：
    1. 查找目录中的 cover.jpg/folder.jpg 等
    """
    try:
        from fastapi.responses import Response
        
        # URL 解码
        decoded_path = unquote(file_path)
        
        # 构建绝对路径
        if os.path.isabs(decoded_path):
            abs_path = decoded_path
        else:
            abs_path = os.path.join(PLAYER.music_dir, decoded_path)
        
        # 检查是否为目录
        if os.path.isdir(abs_path):
            # 目录：查找目录中的封面文件
            cover_path = _get_cover_from_directory(abs_path)
            if cover_path and os.path.isfile(cover_path):
                ext = os.path.splitext(cover_path)[1].lower()
                media_type = {
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png": "image/png",
                    ".webp": "image/webp",
                }.get(ext, "image/jpeg")
                return FileResponse(cover_path, media_type=media_type)
            raise HTTPException(status_code=404, detail="未找到目录封面")
        
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="文件不存在")
        
        # 文件：1. 尝试提取内嵌封面（直接返回字节流，不保存）
        cover_bytes = _extract_embedded_cover_bytes(abs_path)
        if cover_bytes:
            return Response(content=cover_bytes, media_type="image/jpeg")
        
        # 2. 尝试文件所在目录的封面文件
        cover_path = _get_cover_from_directory(abs_path)
        if cover_path and os.path.isfile(cover_path):
            ext = os.path.splitext(cover_path)[1].lower()
            media_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
            }.get(ext, "image/jpeg")
            return FileResponse(cover_path, media_type=media_type)
        
        raise HTTPException(status_code=404, detail="未找到封面")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取封面失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
            save_to_history=True,
            mpv_cmd=PLAYER.mpv_cmd
        )
        
        # 【新增】更新 PLAYER.current_index：查找当前播放歌曲在列表中的索引
        # 这样下次添加歌曲时才能计算正确的插入位置
        try:
            playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
            if playlist:
                for idx, song_item in enumerate(playlist.songs):
                    song_item_url = song_item.get("url") if isinstance(song_item, dict) else str(song_item)
                    if song_item_url == url:
                        PLAYER.current_index = idx
                        logger.info(f"[播放] 已更新 current_index = {idx}, 歌曲: {title}")
                        break
        except Exception as e:
            logger.warning(f"[播放] 更新 current_index 失败: {e}")
        
        return {
            "status": "OK",
            "message": "播放成功",
            "current": PLAYER.current_meta
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
            logger.error("[ERROR] /next: 当前歌单为空")
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
        
        logger.info(f"[自动播放] 从索引 {current_idx} 跳到 {next_idx}，总歌曲数：{len(songs)}")

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
            logger.error(f"[ERROR] /next: 歌曲数据不完整: {song_data}")
            return JSONResponse(
                {"status": "ERROR", "error": "歌曲信息不完整"},
                status_code=400
            )

        # 构造Song对象并播放
        if song_type == "youtube" or url.startswith("http"):
            song = StreamSong(stream_url=url, title=title or url)
            logger.info(f"[自动播放] 播放YouTube: {title}")
        else:
            song = LocalSong(file_path=url, title=title)
            logger.info(f"[自动播放] 播放本地文件: {title}")

        success = PLAYER.play(
            song,
            mpv_command_func=PLAYER.mpv_command,
            mpv_pipe_exists_func=PLAYER.mpv_pipe_exists,
            ensure_mpv_func=PLAYER.ensure_mpv,
            add_to_history_func=PLAYBACK_HISTORY.add_to_history,
            save_to_history=True
        )
        
        if not success:
            logger.error(f"[ERROR] /next: 播放失败")
            return JSONResponse(
                {"status": "ERROR", "error": "播放失败"},
                status_code=500
            )
        
        PLAYER.current_index = next_idx
        logger.info(f"[自动播放] ✓ 已切换到下一首: {title}")

        return {
            "status": "OK",
            "current": PLAYER.current_meta,
            "current_index": PLAYER.current_index,
        }
    except Exception as e:
        import traceback
        logger.error(f"[ERROR] /next 异常: {str(e)}")
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
            logger.error("[ERROR] /prev: 当前歌单为空")
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
        
        logger.info(f"[上一首] 从索引 {current_idx} 跳到 {prev_idx}，总歌曲数：{len(songs)}")

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
            logger.error(f"[ERROR] /prev: 歌曲数据不完整: {song_data}")
            return JSONResponse(
                {"status": "ERROR", "error": "歌曲信息不完整"},
                status_code=400
            )

        # 构造Song对象并播放
        if song_type == "youtube" or url.startswith("http"):
            song = StreamSong(stream_url=url, title=title or url)
            logger.info(f"[上一首] 播放YouTube: {title}")
        else:
            song = LocalSong(file_path=url, title=title)
            logger.info(f"[上一首] 播放本地文件: {title}")

        success = PLAYER.play(
            song,
            mpv_command_func=PLAYER.mpv_command,
            mpv_pipe_exists_func=PLAYER.mpv_pipe_exists,
            ensure_mpv_func=PLAYER.ensure_mpv,
            add_to_history_func=PLAYBACK_HISTORY.add_to_history,
            save_to_history=True
        )
        
        if not success:
            logger.error(f"[ERROR] /prev: 播放失败")
            return JSONResponse(
                {"status": "ERROR", "error": "播放失败"},
                status_code=500
            )
        
        PLAYER.current_index = prev_idx
        logger.info(f"[上一首] ✓ 已切换到上一首: {title}")

        return {
            "status": "OK",
            "current": PLAYER.current_meta,
            "current_index": PLAYER.current_index,
        }
    except Exception as e:
        import traceback
        logger.error(f"[ERROR] /prev 异常: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )

@app.get("/status")
async def get_status():
    """获取播放器状态"""
    playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
    
    # 获取 MPV 状态
    mpv_state = {
        "paused": mpv_get("pause"),
        "time_pos": mpv_get("time-pos"),
        "duration": mpv_get("duration"),
        "volume": mpv_get("volume")
    }
    
    # DEBUG 日志：显示当前播放歌曲状态
    if PLAYER.current_meta and PLAYER.current_meta.get("url"):
        title = PLAYER.current_meta.get("title", "N/A")
        song_type = PLAYER.current_meta.get("type", "N/A")
        paused = mpv_state.get("paused", False)
        time_pos = mpv_state.get("time_pos", 0) or 0
        duration = mpv_state.get("duration", 0) or 0
        volume = mpv_state.get("volume", 0) or 0
        
        logger.debug(
            f"🎵 [播放状态] "
            f"歌曲: {title} | "
            f"类型: {song_type} | "
            f"状态: {'暂停' if paused else '播放中'} | "
            f"进度: {int(time_pos)}/{int(duration)}s | "
            f"音量: {int(volume)}%"
        )
    
    # 为本地歌曲添加封面 URL（仅当封面存在时）
    current_meta = dict(PLAYER.current_meta) if PLAYER.current_meta else {}
    if current_meta.get("type") == "local" and not current_meta.get("thumbnail_url"):
        url = current_meta.get("url", "")
        if url:
            # 先检查封面是否存在
            if os.path.isabs(url):
                abs_path = url
            else:
                abs_path = os.path.join(PLAYER.music_dir, url)
            
            # 检查内嵌封面或目录封面
            has_cover = False
            if os.path.isfile(abs_path):
                # 检查目录封面
                if _get_cover_from_directory(abs_path):
                    has_cover = True
                else:
                    # 快速检查是否有内嵌封面（检查FFmpeg能否提取）
                    cover_bytes = _extract_embedded_cover_bytes(abs_path)
                    if cover_bytes:
                        has_cover = True
            
            if has_cover:
                from urllib.parse import quote
                current_meta["thumbnail_url"] = f"/cover/{quote(url, safe='')}"
    
    return {
        "status": "OK",
        "current_meta": current_meta,
        "current_playlist_id": CURRENT_PLAYLIST_ID,
        "current_playlist_name": playlist.name if playlist else "--",
        "loop_mode": PLAYER.loop_mode,
        "mpv_state": mpv_state
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
                logger.warning(f"[警告] 提取 YouTube URL 失败: {e}")
        else:
            # 本地搜索
            local_results = PLAYER.search_local(query, max_results=PLAYER.local_search_max_results)
            
            # YouTube 关键词搜索
            try:
                yt_search_result = StreamSong.search(query, max_results=PLAYER.youtube_search_max_results)
                if yt_search_result.get("status") == "OK":
                    youtube_results = yt_search_result.get("results", [])
            except Exception as e:
                logger.warning(f"[警告] YouTube搜索失败: {e}")
        
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
            logger.error(f"[错误] YouTube 搜索失败: {e}")
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
# ✅ 新增：获取目录下的所有歌曲
# ============================================

@app.post("/get_directory_songs")
async def get_directory_songs(request: Request):
    """获取目录下的所有歌曲
    
    参数:
      directory: 相对于音乐目录的路径（来自搜索结果）
    
    返回:
      目录下所有歌曲的列表
    """
    try:
        data = await request.json()
        directory = data.get("directory", "").strip()
        
        if not directory:
            return JSONResponse(
                {"status": "ERROR", "error": "目录路径不能为空"},
                status_code=400
            )
        
        # 验证目录路径（防止目录遍历攻击）
        abs_root = os.path.abspath(PLAYER.music_dir)
        abs_path = os.path.abspath(os.path.join(abs_root, directory))
        
        if not abs_path.startswith(abs_root):
            return JSONResponse(
                {"status": "ERROR", "error": "无效的目录路径"},
                status_code=400
            )
        
        if not os.path.isdir(abs_path):
            return JSONResponse(
                {"status": "ERROR", "error": "目录不存在"},
                status_code=404
            )
        
        # 收集目录下的所有音乐文件
        tracks = []
        for dp, _, files in os.walk(abs_path):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in PLAYER.allowed_extensions:
                    full_path = os.path.join(dp, f)
                    rel_path = os.path.relpath(full_path, abs_root).replace("\\", "/")
                    
                    # 构建歌曲数据
                    song = {
                        "url": rel_path,
                        "title": os.path.splitext(f)[0],
                        "type": "local",
                        "duration": 0
                    }
                    tracks.append(song)
        
        # 排序
        tracks.sort(key=lambda x: x["title"].lower())
        
        logger.info(f"获取目录歌曲: {directory} → {len(tracks)} 首歌曲")
        
        return {
            "status": "OK",
            "directory": directory,
            "songs": tracks,
            "count": len(tracks)
        }
    except Exception as e:
        logger.error(f"获取目录歌曲失败: {e}")
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
        
        # ✅ 检查歌曲是否已存在于歌单中
        song_url = song_data.get("url", "")
        for existing_song in playlist.songs:
            existing_url = existing_song.get("url", "")
            if existing_url and existing_url == song_url:
                return JSONResponse(
                    {"status": "ERROR", "error": "该歌曲已存在于当前播放序列", "duplicate": True},
                    status_code=409
                )
        
        # ✅ 如果未指定 insert_index，插入到当前播放歌曲的下一个位置（插队）
        if insert_index is None:
            # 【修复】使用 PLAYER.current_index 而不是 playlist.current_playing_index
            # 因为 current_playing_index 从未被更新，总是 -1
            current_index = PLAYER.current_index if hasattr(PLAYER, 'current_index') else -1
            
            logger.info(f"[添加歌曲] 计算插入位置 - PLAYER.current_index: {current_index}, 歌单长度: {len(playlist.songs)}")
            
            # 如果有当前播放的歌曲，则插入到下一个位置；否则插入到第一首之后
            if current_index >= 0 and current_index < len(playlist.songs):
                insert_index = current_index + 1
                logger.info(f"[添加歌曲] 有当前播放的歌曲，插入到下一个位置: {insert_index}")
            else:
                insert_index = 1 if playlist.songs else 0  # 第一首之后，或如果空列表则位置0
                logger.info(f"[添加歌曲] 无当前播放歌曲或索引无效，使用默认位置: {insert_index}")
        
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
        logger.error(f"[ERROR] 添加歌曲失败: {str(e)}")
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
        
        # ✅ 检查歌曲是否已存在于歌单中
        for existing_song in playlist.songs:
            existing_url = existing_song.get("url", "")
            if existing_url and existing_url == url:
                return JSONResponse(
                    {"status": "ERROR", "error": "该歌曲已存在于当前播放序列", "duplicate": True},
                    status_code=409
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
async def get_current_playlist(playlist_id: str = None):
    """获取指定歌单内容（用户隔离：每个浏览器独立选择歌单）
    
    参数:
      playlist_id: 歌单ID（可选，默认为 'default'）
    """
    try:
        songs = []
        
        # 使用前端传入的 playlist_id，不再依赖后端全局变量
        target_playlist_id = playlist_id or DEFAULT_PLAYLIST_ID

        # 获取指定歌单数据
        playlist = PLAYLISTS_MANAGER.get_playlist(target_playlist_id)
        # 如果歌单不存在，回退到默认歌单
        if not playlist:
            playlist = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
            target_playlist_id = DEFAULT_PLAYLIST_ID
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
        
        # 获取歌单名称（使用已获取的 playlist 对象）
        playlist_name = playlist.name if playlist else "--"
        
        return {
            "status": "OK",
            "playlist": songs,  # 前端期望的字段名是 playlist
            "playlist_id": target_playlist_id,  # 返回实际使用的歌单ID
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
                    # MPV 未运行或未设置音量，返回本地默认值
                    local_volume = PLAYER.config.get("LOCAL_VOLUME", "50")
                    try:
                        return {
                            "status": "OK",
                            "volume": int(local_volume)
                        }
                    except (ValueError, TypeError):
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
                logger.warning(f"[警告] 获取音量失败: {e}, 当前值: {current_volume}")
                # 返回默认音量
                return {
                    "status": "OK",
                    "volume": 50
                }
    except Exception as e:
        logger.error(f"[错误] /volume 路由异常: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "ERROR", "error": str(e)},
            status_code=500
        )


@app.get("/volume/defaults")
async def get_volume_defaults():
    """获取默认音量配置（从settings.ini）"""
    try:
        # 安全地获取配置，处理 config 属性不存在的情况
        config = getattr(PLAYER, 'config', {})
        local_vol = config.get("LOCAL_VOLUME", "50") if config else "50"
        
        try:
            local_volume = int(local_vol)
        except (ValueError, TypeError):
            local_volume = 50
        
        return {
            "status": "OK",
            "local_volume": local_volume
        }
    except Exception as e:
        logger.error(f"Failed to get volume defaults: {e}")
        return {
            "status": "OK",
            "local_volume": 50
        }

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

@app.post("/playlists/{playlist_id}/remove")
async def remove_song_from_playlist(playlist_id: str, request: Request):
    """从指定歌单中移除歌曲"""
    try:
        form = await request.form()
        index = int(form.get("index", -1))
        
        logger.debug(f"remove_song_from_playlist - playlist_id: {playlist_id}, index: {index}")
        
        if index < 0:
            logger.error(f"[ERROR] 无效的索引: {index}")
            return JSONResponse(
                {"status": "ERROR", "error": "无效的索引"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            logger.error(f"[ERROR] 找不到歌单: {playlist_id}")
            return JSONResponse(
                {"status": "ERROR", "error": "找不到歌单"},
                status_code=404
            )
        
        logger.debug(f"目标歌单歌曲数: {len(playlist.songs)}")
        
        if index >= len(playlist.songs):
            logger.error(f"[ERROR] 索引超出范围: {index} >= {len(playlist.songs)}")
            return JSONResponse(
                {"status": "ERROR", "error": "索引超出范围"},
                status_code=400
            )
        
        song_to_remove = playlist.songs[index]
        logger.debug(f"准备删除歌曲: {song_to_remove.get('title', 'Unknown') if isinstance(song_to_remove, dict) else song_to_remove}")
        
        playlist.songs.pop(index)
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        logger.info(f"[SUCCESS] 从歌单 {playlist_id} 删除成功，剩余歌曲数: {len(playlist.songs)}")
        return JSONResponse({"status": "OK", "message": "删除成功"})
        
    except Exception as e:
        logger.error(f"[EXCEPTION] remove_song_from_playlist error: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
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
    """验证歌单是否存在（用户隔离：不再修改后端全局状态）
    
    歌单选择状态由前端 localStorage 独立管理，后端只负责验证歌单是否存在。
    """
    try:
        # 验证目标歌单是否存在
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        if not playlist:
            return JSONResponse(
                {"error": "歌单不存在"},
                status_code=404
            )
        
        # 返回歌单信息，不修改后端全局状态
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
        playlist_id = data.get("playlist_id", CURRENT_PLAYLIST_ID)  # 支持指定歌单
        
        if from_index is not None and to_index is not None:
            playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
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
        
        logger.debug(f"playlist_remove - index: {index}, current_playlist_id: {CURRENT_PLAYLIST_ID}")
        
        if index < 0:
            logger.error(f"[ERROR] 无效的索引: {index}")
            return JSONResponse(
                {"status": "ERROR", "error": "无效的索引"},
                status_code=400
            )
        
        playlist = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if not playlist:
            logger.error(f"[ERROR] 找不到歌单: {CURRENT_PLAYLIST_ID}")
            return JSONResponse(
                {"status": "ERROR", "error": "找不到歌单"},
                status_code=404
            )
        
        logger.debug(f"当前歌单歌曲数: {len(playlist.songs)}")
        
        if index >= len(playlist.songs):
            logger.error(f"[ERROR] 索引超出范围: {index} >= {len(playlist.songs)}")
            return JSONResponse(
                {"status": "ERROR", "error": "索引超出范围"},
                status_code=400
            )
        
        song_to_remove = playlist.songs[index]
        logger.debug(f"准备删除歌曲: {song_to_remove.get('title', 'Unknown') if isinstance(song_to_remove, dict) else song_to_remove}")
        
        playlist.songs.pop(index)
        playlist.updated_at = time.time()
        PLAYLISTS_MANAGER.save()
        
        logger.info(f"[SUCCESS] 删除成功，剩余歌曲数: {len(playlist.songs)}")
        return JSONResponse({"status": "OK", "message": "删除成功"})
        
    except Exception as e:
        logger.info(f"[EXCEPTION] playlist_remove error: {type(e).__name__}: {str(e)}")
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

@app.get("/playback_history_merged")
async def get_playback_history_merged():
    """获取已合并的播放历史 - 相同URL只显示一次，最后播放时间降序排列"""
    try:
        raw_history = PLAYER.playback_history.get_all()
        
        # 按 URL 合并，只保留最新的记录
        merged_dict = {}
        for item in raw_history:
            url = item.get('url', '')
            if url:
                # 如果URL已存在，只有新的时间戳更新时才更新
                if url not in merged_dict:
                    merged_dict[url] = item
                else:
                    # 比较时间戳，保留更新的
                    existing_ts = merged_dict[url].get('ts', 0)
                    new_ts = item.get('ts', 0)
                    if new_ts > existing_ts:
                        merged_dict[url] = item
        
        # 转换为列表并按时间降序排列（最新的在前）
        merged_history = list(merged_dict.values())
        merged_history.sort(key=lambda x: x.get('ts', 0), reverse=True)
        
        return {
            "status": "OK",
            "history": merged_history,
            "count": len(merged_history)
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
