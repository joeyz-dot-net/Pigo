# -*- coding: utf-8 -*-
"""
FFmpeg 推流模块 - 支持AAC编码
"""
import subprocess
import threading
import queue
import time
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# 尝试找FFmpeg的完整路径
def find_ffmpeg():
    """查找FFmpeg可执行文件"""
    possible_paths = [
        "ffmpeg",  # PATH中的ffmpeg
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\ffmpeg\\ffmpeg.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
        os.path.join(os.path.dirname(__file__), "..", "ffmpeg", "ffmpeg.exe"),
    ]
    
    for path in possible_paths:
        try:
            # 测试是否能运行
            result = subprocess.run(f'"{path}" -version', shell=True, capture_output=True, timeout=2)
            if result.returncode == 0:
                print(f"[STREAM] 找到FFmpeg: {path}")
                return path
        except:
            pass
    
    print("[STREAM] ⚠️ 找不到FFmpeg，将尝试使用 'ffmpeg'")
    return "ffmpeg"

FFMPEG_CMD = find_ffmpeg()

FFMPEG_PROCESS = None
FFMPEG_FORMAT = None
STREAM_BUFFER = queue.Queue(maxsize=4096)
ACTIVE_CLIENTS = {}
CLIENTS_LOCK = threading.Lock()
STREAM_STATS = {
    "total_bytes": 0,
    "start_time": None,
    "last_log_time": None
}


def start_ffmpeg_stream(device_name="CABLE Output (VB-Audio Virtual Cable)", audio_format="aac"):
    """启动FFmpeg推流进程"""
    global FFMPEG_PROCESS, FFMPEG_FORMAT
    
    if FFMPEG_PROCESS and FFMPEG_FORMAT == audio_format:
        print(f"[STREAM] ℹ️ FFmpeg 已在运行 (格式: {audio_format})")
        return True
    
    stop_ffmpeg_stream()
    time.sleep(0.3)
    
    try:
        if audio_format == "aac":
            cmd = (
                f'"{FFMPEG_CMD}" -rtbufsize 200M -fflags +nobuffer -thread_queue_size 2048 '
                f'-f dshow -i audio="{device_name}" '
                f'-ac 2 -ar 44100 -c:a aac -b:a 192k '
                f'-f adts -'
            )
        elif audio_format == "aac-raw":
            cmd = (
                f'"{FFMPEG_CMD}" -rtbufsize 200M -fflags +nobuffer -thread_queue_size 2048 '
                f'-f dshow -i audio="{device_name}" '
                f'-ac 2 -ar 44100 -c:a aac -b:a 192k '
                f'-f null -'
            )
        elif audio_format == "mp3":
            cmd = (
                f'"{FFMPEG_CMD}" -rtbufsize 200M -fflags +nobuffer -thread_queue_size 2048 '
                f'-f dshow -i audio="{device_name}" '
                f'-ac 2 -ar 44100 -c:a libmp3lame -b:a 192k -q:a 4 '
                f'-f mp3 -'
            )
        else:  # pcm
            cmd = (
                f'"{FFMPEG_CMD}" -rtbufsize 200M -fflags +nobuffer -thread_queue_size 2048 '
                f'-f dshow -i audio="{device_name}" '
                f'-ac 2 -ar 44100 -f s16le -'
            )
        
        print(f"[STREAM] 启动FFmpeg命令: {cmd[:100]}...")
        
        FFMPEG_PROCESS = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW,
            bufsize=262144
        )
        
        FFMPEG_FORMAT = audio_format
        print(f"[STREAM] ✓ FFmpeg 已启动 (格式: {audio_format}, PID: {FFMPEG_PROCESS.pid})")
        
        # 检查ffmpeg是否立即失败
        import time as time_module
        time_module.sleep(0.2)
        if FFMPEG_PROCESS.poll() is not None:
            # 进程已退出，读取stderr
            stderr = FFMPEG_PROCESS.stderr.read().decode('utf-8', errors='ignore')
            print(f"[STREAM] ✗ FFmpeg 启动失败，stderr: {stderr[:500]}")
            return False
        
        start_stream_reader_thread()
        return True
        
    except Exception as e:
        print(f"[STREAM] ✗ FFmpeg 启动异常: {e}")
        import traceback
        traceback.print_exc()
        FFMPEG_PROCESS = None
        return False


def stop_ffmpeg_stream():
    """停止FFmpeg进程"""
    global FFMPEG_PROCESS
    if FFMPEG_PROCESS:
        try:
            FFMPEG_PROCESS.terminate()
            FFMPEG_PROCESS.wait(timeout=2)
        except:
            try:
                FFMPEG_PROCESS.kill()
            except:
                pass
        FFMPEG_PROCESS = None
        logger.info("[STREAM] ✓ FFmpeg 已停止")


def start_stream_reader_thread():
    """后台读取FFmpeg输出"""
    def read_stream():
        global STREAM_STATS
        chunk_size = 256 * 1024
        consecutive_empty = 0
        total_bytes = 0
        last_log_time = time.time()
        
        # 初始化统计
        STREAM_STATS["total_bytes"] = 0
        STREAM_STATS["start_time"] = time.time()
        
        print(f"[STREAM] 📖 FFmpeg读取线程启动，进程ID: {FFMPEG_PROCESS.pid}")
        
        while FFMPEG_PROCESS and FFMPEG_PROCESS.poll() is None:
            try:
                chunk = FFMPEG_PROCESS.stdout.read(chunk_size)
                
                if not chunk:
                    consecutive_empty += 1
                    print(f"[STREAM] ℹ️ 无数据 ({consecutive_empty}次)")
                    if consecutive_empty > 30:
                        print(f"[STREAM] ⚠️ FFmpeg 无数据超时，进程状态: {FFMPEG_PROCESS.poll()}")
                        break
                    time.sleep(0.1)
                    continue
                
                consecutive_empty = 0
                total_bytes += len(chunk)
                STREAM_STATS["total_bytes"] += len(chunk)
                
                now = time.time()
                if now - last_log_time >= 1.0:
                    speed = total_bytes / (now - last_log_time) / 1024
                    active = len(ACTIVE_CLIENTS)
                    status = "✓ 已激活" if active > 0 else "⚠️ 没有激活"
                    print(f"[STREAM] 🚀 速率: {speed:.1f} KB/s | "
                          f"已读: {total_bytes / 1024:.1f} KB ({active} 活跃客户端) {status}")
                    last_log_time = now
                    total_bytes = 0
                
                # 广播到所有客户端
                with CLIENTS_LOCK:
                    dead_clients = []
                    for client_id, client_queue in list(ACTIVE_CLIENTS.items()):
                        try:
                            client_queue.put_nowait(chunk)
                        except queue.Full:
                            print(f"[STREAM] ⚠️ 客户端队列满: {client_id}")
                            dead_clients.append(client_id)
                    
                    for client_id in dead_clients:
                        del ACTIVE_CLIENTS[client_id]
                
                try:
                    STREAM_BUFFER.put_nowait(chunk)
                except queue.Full:
                    pass
                    
            except Exception as e:
                print(f"[STREAM] ✗ 读取错误: {e}")
                import traceback
                traceback.print_exc()
                break
        
        print(f"[STREAM] 📤 FFmpeg 读取线程退出 (总计: {total_bytes / 1024 / 1024:.2f} MB)")
    
    thread = threading.Thread(target=read_stream, daemon=True)
    thread.start()


def register_client(client_id):
    """注册客户端"""
    with CLIENTS_LOCK:
        if client_id not in ACTIVE_CLIENTS:
            ACTIVE_CLIENTS[client_id] = queue.Queue(maxsize=4096)
            logger.info(f"[STREAM] 🟢 客户端连接 (总计: {len(ACTIVE_CLIENTS)})")
        return ACTIVE_CLIENTS[client_id]


def unregister_client(client_id):
    """移除客户端"""
    with CLIENTS_LOCK:
        if client_id in ACTIVE_CLIENTS:
            del ACTIVE_CLIENTS[client_id]
            logger.info(f"[STREAM] 🔴 客户端断开 (剩余: {len(ACTIVE_CLIENTS)})")


def get_mime_type(audio_format):
    """获取MIME类型"""
    mime_types = {
        "aac": "audio/aac",
        "aac-raw": "audio/aac",
        "mp3": "audio/mpeg",
        "pcm": "audio/wav",
        "flac": "audio/flac",
        "opus": "audio/opus",
        "vorbis": "audio/ogg",
    }
    return mime_types.get(audio_format, "audio/mpeg")
