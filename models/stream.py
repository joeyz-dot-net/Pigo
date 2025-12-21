# -*- coding: utf-8 -*-
"""
FFmpeg 推流模块 - 支持AAC编码
优化特性：
- 客户端连接池管理
- 异步非阻塞广播
- 三线程架构（读取+广播+心跳）
- 自动死亡客户端清理
- 性能监控和统计
"""
import subprocess
import threading
import queue
import time
import os
import platform
import logging
from pathlib import Path
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, Optional
from concurrent.futures import ThreadPoolExecutor
import struct

logger = logging.getLogger(__name__)

# 配置日志格式 - 添加时间戳
def _setup_logger():
    """配置 stream 模块的日志格式"""
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)

_setup_logger()

# 时间戳辅助函数
def _timestamp():
    """获取当前时间戳字符串"""
    from datetime import datetime
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

# ==================== 推流格式配置 ====================
# 从 settings.ini 读取默认推流格式
def get_default_stream_format():
    """从配置文件获取默认推流格式（支持: mp3, aac, aac-raw, pcm, flac）"""
    try:
        import configparser
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "settings.ini")
        if os.path.exists(config_path):
            config = configparser.ConfigParser()
            config.read(config_path, encoding="utf-8")
            fmt = config.get("app", "default_stream_format", fallback="mp3")
            if fmt.strip():
                return fmt.strip().lower()
    except Exception as e:
        print(f"[WARN] Failed to read default_stream_format from settings.ini: {e}")
    return "mp3"  # 最终回退默认值

DEFAULT_STREAM_FORMAT = get_default_stream_format()

# ==================== Safari 流媒体优化配置 ====================
KEEPALIVE_THRESHOLD = 2.0  # 无数据超过2秒才发送心跳（避免频繁干扰）
KEEPALIVE_CHUNK_SIZE = 128  # 心跳包大小：128字节（最小可感知的数据）

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
                print(f"{_timestamp()} [STREAM] 找到FFmpeg: {path}")
                return path
        except:
            pass
    
    print(f"{_timestamp()} [STREAM] ⚠️ 找不到FFmpeg，将尝试使用 'ffmpeg'")
    return "ffmpeg"

FFMPEG_CMD = find_ffmpeg()

def find_available_audio_device():
    """
    🔥 自动检测可用的音频输入设备
    Windows dshow 会列出所有音频设备
    优先级：配置文件指定 > CABLE Output > Stereo Mix > 第一个可用设备
    """
    # 🔥 首先检查配置文件中是否指定了设备
    try:
        import configparser
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "settings.ini")
        if os.path.exists(config_path):
            config = configparser.ConfigParser()
            config.read(config_path, encoding="utf-8")
            configured_device = config.get("paths", "audio_input_device", fallback="").strip()
            if configured_device:
                print(f"{_timestamp()} [STREAM] ✓ 使用配置的音频设备: {configured_device}")
                return configured_device
    except Exception as e:
        print(f"{_timestamp()} [STREAM] ⚠️ 读取音频设备配置失败: {e}")
    
    # 🔥 自动检测可用设备
    try:
        # 尝试列出所有可用的音频设备
        result = subprocess.run(
            f'"{FFMPEG_CMD}" -list_devices true -f dshow -i dummy 2>&1',
            shell=True,
            capture_output=True,
            timeout=5,
            text=True
        )
        
        output = result.stderr + result.stdout
        lines = output.split('\n')
        
        # 查找 "audio=" 开头的设备行
        audio_devices = []
        for line in lines:
            if 'audio=' in line:
                # 提取设备名称
                start = line.find('"')
                end = line.rfind('"')
                if start != -1 and end != -1 and start < end:
                    device_name = line[start+1:end]
                    audio_devices.append(device_name)
                    print(f"[STREAM] 检测到音频设备: {device_name}")
        
        # 优先选择：1. CABLE Output 2. 虚拟设备 3. 第一个可用设备
        for device in audio_devices:
            if 'CABLE' in device or 'Virtual' in device or 'Stereo Mix' in device:
                print(f"{_timestamp()} [STREAM] 选择虚拟设备: {device}")
                return device
        
        if audio_devices:
            print(f"{_timestamp()} [STREAM] 选择第一个可用设备: {audio_devices[0]}")
            return audio_devices[0]
        
        # 如果没有找到，使用默认设备
        print(f"{_timestamp()} [STREAM] 未找到音频设备，尝试使用默认 loopback 设备")
        return None  # 稍后会使用默认的 CABLE Output
        
    except Exception as e:
        print(f"{_timestamp()} [STREAM] 检测音频设备失败: {e}")
        return None

# ==================== 浏览器特定的队列大小配置 ====================
QUEUE_SIZE_CONFIG = {
    "safari": 512,       # 🔧🔧 Safari 超级优化：512块 × 256KB = 128MB（极限缓冲）
    "firefox": 64,       # Firefox: 64块 × 256KB = 16MB
    "edge": 64,          # Edge: 64块 × 256KB = 16MB
    "chrome": 64,        # Chrome: 64块 × 256KB = 16MB
    "default": 32,       # 其他: 32块 × 256KB = 8MB
}

# ==================== 浏览器特定的心跳配置 ====================
HEARTBEAT_CONFIG = {
    "safari": {
        "interval": 0.05,     # 🔧🔧 Safari: 50ms 超激进心跳
        "timeout": 20,        # Safari: 20秒超时
        "keepalive_size": 512, # Safari: 512字节心跳包
    },
    "firefox": {
        "interval": 1.0,
        "timeout": 40,
        "keepalive_size": 128,
    },
    "edge": {
        "interval": 1.0,
        "timeout": 40,
        "keepalive_size": 128,
    },
    "chrome": {
        "interval": 1.0,
        "timeout": 40,
        "keepalive_size": 128,
    },
    "default": {
        "interval": 1.0,
        "timeout": 40,
        "keepalive_size": 128,
    }
}

def get_queue_size_for_browser(browser_name: str) -> int:
    """获取浏览器特定的队列大小"""
    return QUEUE_SIZE_CONFIG.get(browser_name.lower(), QUEUE_SIZE_CONFIG["default"])

def get_heartbeat_config_for_browser(browser_name: str) -> dict:
    """获取浏览器特定的心跳配置"""
    return HEARTBEAT_CONFIG.get(browser_name.lower(), HEARTBEAT_CONFIG["default"])

# ==================== 格式感知的心跳包生成 ====================
def get_keepalive_chunk(audio_format: str) -> bytes:
    """
    已弃用：心跳通过序列号（seq_id < 0）维护，不再需要生成心跳数据块
    之前直接 yield 心跳包会导致解码器处理而产生爆音
    
    保留此函数以维持向后兼容性，返回空字节
    """
    return b''

# ==================== 客户端连接池管理 ====================
@dataclass
class ClientInfo:
    """客户端信息"""
    client_id: str
    queue: queue.Queue
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    bytes_sent: int = 0
    chunks_received: int = 0
    is_active: bool = True
    format: str = "mp3"
    browser: str = "default"  # 🔧 新增：浏览器类型，用于块大小决策
    
    def update_activity(self):
        """更新最后活动时间"""
        self.last_activity = time.time()
    
    def is_dead(self, timeout=40):
        """检查客户端是否超时"""
        return time.time() - self.last_activity > timeout


class ClientPool:
    """客户端连接池 - 管理多客户端连接、健康检查、自动清理"""
    def __init__(self, queue_maxsize=None):
        self.clients: Dict[str, ClientInfo] = {}
        self.lock = threading.Lock()
        # 保留默认值供向后兼容
        self.default_queue_maxsize = queue_maxsize or 128
        self.stats = {
            "total_clients_ever": 0,
            "peak_concurrent": 0,
            "total_chunks_sent": 0,
            "total_bytes_sent": 0,
        }
    
    def register(self, client_id: str, audio_format: str = "mp3", browser_name: str = "default") -> queue.Queue:
        """注册客户端 - 使用浏览器特定的队列大小"""
        with self.lock:
            if client_id not in self.clients:
                # 🔧 根据浏览器类型调整队列大小
                queue_size = get_queue_size_for_browser(browser_name)
                client_queue = queue.Queue(maxsize=queue_size)
                self.clients[client_id] = ClientInfo(
                    client_id=client_id,
                    queue=client_queue,
                    format=audio_format,
                    browser=browser_name  # 🔧 存储浏览器类型
                )
                self.stats["total_clients_ever"] += 1
                current = len(self.clients)
                if current > self.stats["peak_concurrent"]:
                    self.stats["peak_concurrent"] = current
            else:
                pass  # 重复注册，无需输出日志
            return self.clients[client_id].queue
    
    def unregister(self, client_id: str):
        """注销客户端"""
        with self.lock:
            if client_id in self.clients:
                client = self.clients[client_id]
                connection_duration = time.time() - client.created_at
                # 仅在调试模式下输出详细日志
                pass  # 移除冗长的日志输出
                del self.clients[client_id]
    
    def get_client(self, client_id: str) -> Optional[ClientInfo]:
        """获取客户端信息"""
        with self.lock:
            return self.clients.get(client_id)
    
    def update_activity(self, client_id: str):
        """更新客户端活动时间"""
        client = self.get_client(client_id)
        if client:
            client.update_activity()
    
    def broadcast(self, chunk: bytes, skip_dead=True) -> tuple[int, int]:
        """
        广播数据到所有活跃客户端
        返回: (成功发送数, 失败数)
        
        优化多客户端场景：
        - 减少单个超时到 2.0 秒，避免慢客户端阻塞整个系统
        - 队列满时标记为不活跃，但不立即删除（让自动清理处理）
        - 防止"幽灵客户端"导致计数不同步
        """
        success_count = 0
        fail_count = 0
        
        with self.lock:
            clients_snapshot = list(self.clients.items())
        
        for client_id, client_info in clients_snapshot:
            try:
                # 🔧 简化：总是尝试发送，如果队列满则丢弃最旧数据
                try:
                    client_info.queue.put_nowait(chunk)
                except queue.Full:
                    # 队列满 - 丢弃最早的块，再放入新块
                    try:
                        client_info.queue.get_nowait()  # 丢弃最旧
                    except queue.Empty:
                        pass
                    try:
                        client_info.queue.put_nowait(chunk)  # 放入新块
                    except queue.Full:
                        pass  # 即使再满也放弃，避免阻塞
                
                client_info.bytes_sent += len(chunk)
                client_info.chunks_received += 1
                client_info.update_activity()  # 更新活动时间
                success_count += 1
                CLIENT_POOL.stats["total_bytes_sent"] += len(chunk)
                CLIENT_POOL.stats["total_chunks_sent"] += 1
            except Exception as e:
                print(f"[DEBUG-ERROR] 广播失败 {client_id[:8]}: {e}")
                fail_count += 1
        
        # 当有失败的客户端时，输出警告日志
        if fail_count > 0 and success_count > 0:
            print(f"⚠️ 广播统计: {success_count}成功/{fail_count}失败 "
                          f"(总客户端: {len(clients_snapshot)})")
        
        return success_count, fail_count
    
    def broadcast_async(self, item):
        """
        异步广播 - 非阻塞版本
        将数据块（或 (seq_id, chunk) 元组）放入全局广播队列，由后台线程处理分发
        """
        try:
            BROADCAST_QUEUE.put_nowait(item)
            # 不记录队列深度了，避免频繁访问
        except queue.Full:
            # 广播队列满 - 丢弃最旧的块
            try:
                BROADCAST_QUEUE.get_nowait()
                BROADCAST_QUEUE.put_nowait(item)
            except:
                pass
    
    def broadcast_to_client(self, client_id: str, chunk: bytes) -> bool:
        """
        同步向单个客户端发送
        被异步广播线程调用
        """
        try:
            client_info = self.get_client(client_id)
            if not client_info:
                return False
            
            try:
                client_info.queue.put_nowait(chunk)
            except queue.Full:
                # 客户端队列满 - 丢弃最旧块并重试
                try:
                    client_info.queue.get_nowait()
                    client_info.queue.put_nowait(chunk)
                except:
                    return False
            
            client_info.bytes_sent += len(chunk)
            client_info.chunks_received += 1
            client_info.update_activity()
            CLIENT_POOL.stats["total_bytes_sent"] += len(chunk)
            CLIENT_POOL.stats["total_chunks_sent"] += 1
            return True
            
        except Exception as e:
            print(f"[ERROR] 单客户端发送失败 {client_id[:8]}: {e}")
            return False

    
    def get_stats(self) -> dict:
        """获取池统计信息"""
        with self.lock:
            return {
                "active_clients": len(self.clients),
                "total_clients_ever": self.stats["total_clients_ever"],
                "peak_concurrent": self.stats["peak_concurrent"],
                "total_chunks_sent": self.stats["total_chunks_sent"],
                "total_bytes_sent": self.stats["total_bytes_sent"],
                "clients": [
                    {
                        "id": c.client_id[:8],
                        "format": c.format,
                        "bytes_sent": c.bytes_sent,
                        "chunks_received": c.chunks_received,
                        "uptime": time.time() - c.created_at,
                    }
                    for c in self.clients.values()
                ]
            }
    
    def get_active_count(self) -> int:
        """获取活跃客户端数"""
        with self.lock:
            return len(self.clients)


# 全局客户端池
# 🔧🔧 Safari 超级优化：增加默认队列到2048（512MB缓冲，支持Safari超大缓冲）
CLIENT_POOL = ClientPool(queue_maxsize=2048)  # 默认2048块 = 512MB

# ==================== 异步广播配置 ====================
# 线程池用于并行向客户端发送数据
# 🔧🔧 Safari 超级优化：增加工作线程到120，加速Safari分发
BROADCAST_EXECUTOR = ThreadPoolExecutor(max_workers=120, thread_name_prefix="broadcast_")
# 全局广播队列：FFmpeg读取线程 → 广播队列 → 分发给客户端
# 🔧🔧 Safari 超级优化：增加到8192（512MB缓冲），支持Safari超大缓冲 + 多客户端
BROADCAST_QUEUE = queue.Queue(maxsize=8192)

# ==================== 浏览器特定的读取块大小配置 ====================
CHUNK_SIZE_CONFIG = {
    "safari": 32 * 1024,     # 🔧🔧 Safari: 32KB（极低延迟）
    "firefox": 192 * 1024,   # Firefox: 192KB
    "edge": 192 * 1024,      # Edge: 192KB
    "chrome": 192 * 1024,    # Chrome: 192KB
    "default": 192 * 1024,   # 默认: 192KB
}

def get_chunk_size_for_browser(browser_name: str) -> int:
    """获取浏览器特定的读取块大小"""
    return CHUNK_SIZE_CONFIG.get(browser_name.lower(), CHUNK_SIZE_CONFIG["default"])

# ==================== 核心流管理变量 ====================
FFMPEG_PROCESS = None
FFMPEG_FORMAT = None
STREAM_SHOULD_STOP = threading.Event()  # 🔥 新增：全局停止标志，控制所有流线程

# 🔥 新增：丢包重发机制
SEQUENCE_COUNTER = 0  # 全局序列号计数器
RETRANSMIT_BUFFER = deque(maxlen=2000)  # 循环缓冲池（保留最近2000块数据）
RETRANSMIT_LOCK = threading.Lock()  # 重发缓冲的线程锁

def add_to_retransmit_buffer(chunk_data):
    """添加数据块到重发缓冲池"""
    global SEQUENCE_COUNTER
    with RETRANSMIT_LOCK:
        seq_id = SEQUENCE_COUNTER
        SEQUENCE_COUNTER += 1
        RETRANSMIT_BUFFER.append((seq_id, chunk_data, time.time()))
        return seq_id

def get_from_retransmit_buffer(seq_id):
    """从重发缓冲池获取特定序列号的数据"""
    with RETRANSMIT_LOCK:
        for stored_seq, chunk_data, _ in RETRANSMIT_BUFFER:
            if stored_seq == seq_id:
                return chunk_data
    return None

STREAM_STATS = {
    "total_bytes": 0,
    "start_time": None,
    "last_log_time": None,
    "chunks_read": 0,
    "chunks_broadcasted": 0,
    "broadcast_fails": 0,
}


def cleanup_ffmpeg_processes():
    """强制清理所有孤立的FFmpeg进程"""
    try:
        if platform.system() == 'Windows':
            os.system('taskkill /F /IM ffmpeg.exe /T 2>nul')
            logger.info("Cleaned up orphaned FFmpeg processes")
    except Exception as e:
        logger.error(f"Failed to cleanup FFmpeg: {e}")


def stop_stream_safely(ffmpeg_process, timeout=3):
    """安全停止FFmpeg进程，避免僵尸进程和死锁"""
    if not ffmpeg_process:
        return
    
    try:
        # 第一步：尝试优雅关闭
        if ffmpeg_process.poll() is None:  # 检查进程是否仍在运行
            ffmpeg_process.terminate()
            try:
                ffmpeg_process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                logger.warning("FFmpeg did not terminate gracefully, force killing")
                ffmpeg_process.kill()
                ffmpeg_process.wait(timeout=2)
    except Exception as e:
        logger.error(f"Error stopping FFmpeg: {e}")
    finally:
        # 关闭I/O管道，避免资源泄漏
        try:
            if ffmpeg_process.stdout:
                ffmpeg_process.stdout.close()
        except:
            pass
        try:
            if ffmpeg_process.stderr:
                ffmpeg_process.stderr.close()
        except:
            pass
        try:
            if ffmpeg_process.stdin:
                ffmpeg_process.stdin.close()
        except:
            pass


def start_ffmpeg_stream(device_name="CABLE Output (VB-Audio Virtual Cable)", audio_format=None):
    """
    启动FFmpeg推流进程 - 低延迟优化版本
    关键优化：
    - 减小内部队列：-thread_queue_size 256（从1024）
    - 减小输入缓冲：-rtbufsize 8M（从100M）
    - 快速编码器：aac_coder fast / compression_level 0
    - 减小Python缓冲：bufsize=65536（从512KB）
    - 生成时间戳：-fflags +genpts+igndts
    """
    global FFMPEG_PROCESS, FFMPEG_FORMAT
    
    # 🔥 检查推流功能是否启用
    try:
        import configparser
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "settings.ini")
        if os.path.exists(config_path):
            config = configparser.ConfigParser()
            config.read(config_path, encoding="utf-8")
            enable_stream = config.get("app", "enable_stream", fallback="true").lower() in ("true", "1", "yes")
            if not enable_stream:
                print(f"{_timestamp()} [STREAM] ℹ️ 推流功能已禁用 (enable_stream=false)")
                return False
    except Exception as e:
        print(f"{_timestamp()} [STREAM] ⚠️ 读取推流配置失败: {e}")
    
    # 🔥 清除停止标志，准备启动新的流
    STREAM_SHOULD_STOP.clear()
    
    if audio_format is None:
        audio_format = DEFAULT_STREAM_FORMAT
    if FFMPEG_PROCESS and FFMPEG_FORMAT == audio_format:
        print(f"{_timestamp()} ℹ️ FFmpeg 已在运行 (格式: {audio_format})")
        return True
    
    if FFMPEG_PROCESS and FFMPEG_FORMAT != audio_format:
        active_clients = CLIENT_POOL.get_active_count()
        if active_clients > 0:
            print(f"{_timestamp()} ⚠️ 已有{active_clients}个活跃客户端使用{FFMPEG_FORMAT}格式，"
                  f"新客户端请求{audio_format}格式，但不更换格式以避免中断现有连接")
            return True
    
    stop_ffmpeg_stream()
    time.sleep(0.3)
    
    try:
        # 🔥 自动检测或使用配置的音频设备
        detected_device = find_available_audio_device()
        if detected_device:
            device_name = detected_device
        else:
            # ❌ 如果检测失败，使用默认设备
            default_device = "CABLE Output (VB-Audio Virtual Cable)"
            print(f"{_timestamp()} [STREAM] ⚠️ 未能检测到任何音频设备，将尝试使用默认: {default_device}")
            device_name = default_device
        
        # ✅ 验证设备名称不为空
        if not device_name or device_name.strip() == "":
            print(f"{_timestamp()} [STREAM] ❌ 错误：音频设备名称为空，无法启动FFmpeg")
            return False
        
        bitrate = 192
        print(f"{_timestamp()} 🎯 固定比特率: {bitrate}kbps，低延迟模式")
        print(f"{_timestamp()} 🎤 音频设备: {device_name}")
        
        # 🔧 防爆音激进的FFmpeg参数：更大缓冲
        common_options = (
            f'"{FFMPEG_CMD}" '
            f'-rtbufsize 32M '
            f'-fflags +genpts+igndts '
            f'-thread_queue_size 1024 '
            f'-f dshow -i audio="{device_name}" '
            f'-ac 2 -ar 44100 '
        )
        
        if audio_format == "aac":
            cmd = (
                f'{common_options}'
                f'-c:a aac -b:a {bitrate}k '
                f'-aac_coder fast '
                f'-f adts -'
            )
        elif audio_format == "aac-raw":
            cmd = (
                f'{common_options}'
                f'-c:a aac -b:a {bitrate}k '
                f'-aac_coder fast '
                f'-f null -'
            )
        elif audio_format == "mp3":
            # 🔧 MP3优化：固定192kbps + 快速编码
            cmd = (
                f'{common_options}'
                f'-c:a libmp3lame -b:a 192k '
                f'-compression_level 0 '
                f'-f mp3 -'
            )
        else:  # pcm
            cmd = (
                f'{common_options}'
                f'-f s16le -'
            )
        
        print(f"{_timestamp()} 启动FFmpeg: {cmd[:100]}...")
        
        # 🔧 Safari优化版本：增加Python缓冲到512K（防止缓冲区枯竭）
        # 重要：使用 CREATE_NEW_PROCESS_GROUP 将FFmpeg放在独立进程组，避免继承主线程状态
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if platform.system() == 'Windows' else 0
        FFMPEG_PROCESS = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creation_flags,
            bufsize=524288  # 512KB 缓冲（相比256KB增大，防止Safari暂停）
        )
        
        FFMPEG_FORMAT = audio_format
        print(f"{_timestamp()} ✓ FFmpeg 已启动 (进程ID: {FFMPEG_PROCESS.pid}, 终极防断音模式)")
        print(f"{_timestamp()}   - 格式: {audio_format}")
        print(f"{_timestamp()}   - rtbufsize: 32M")
        print(f"{_timestamp()}   - thread_queue_size: 1024")
        print(f"{_timestamp()}   - Python bufsize: 256KB")
        print(f"{_timestamp()}   - 广播队列: 2048块 (128MB)")
        print(f"{_timestamp()}   - 客户端队列: 512块 (128MB)")
        print(f"{_timestamp()}   - 心跳间隔: 20ms")
        print(f"{_timestamp()}   - 并发线程: 40")
        
        # 立即检查进程是否存活
        time.sleep(0.5)
        poll_result = FFMPEG_PROCESS.poll()
        if poll_result is not None:
            # ❌ 进程已退出
            print(f"{_timestamp()} ✗ FFmpeg 进程已退出! (退出码: {poll_result})")
            
            # 立即读取可用的错误数据
            stderr_data = ""
            try:
                if FFMPEG_PROCESS.stderr:
                    chunk = FFMPEG_PROCESS.stderr.read(8192)
                    if chunk:
                        stderr_data = chunk.decode('utf-8', errors='ignore')
            except:
                pass
            
            if stderr_data:
                print(f"{_timestamp()} FFmpeg 标准错误:")
                for line in stderr_data.split('\n')[:30]:  # 显示前30行
                    if line.strip():
                        print(f"{_timestamp()}   {line}")
            else:
                print(f"{_timestamp()} (没有捕获到标准错误 - FFmpeg 立即退出)")
            
            # 🔍 立即诊断：列出可用的音频设备
            print(f"{_timestamp()} 🔍 自动检测系统可用的音频设备...")
            try:
                result = subprocess.run(
                    f'"{FFMPEG_CMD}" -list_devices true -f dshow -i dummy 2>&1',
                    shell=True,
                    capture_output=True,
                    timeout=5,
                    text=True
                )
                device_output = result.stderr + result.stdout
                audio_devices = []
                for line in device_output.split('\n'):
                    if 'audio=' in line and '"' in line:
                        start = line.find('"')
                        end = line.rfind('"')
                        if start != -1 and end != -1 and start < end:
                            dev_name = line[start+1:end]
                            audio_devices.append(dev_name)
                
                if audio_devices:
                    print(f"{_timestamp()} ✅ 发现 {len(audio_devices)} 个音频设备:")
                    for i, dev in enumerate(audio_devices, 1):
                        print(f"{_timestamp()}    {i}. {dev}")
                    print(f"{_timestamp()} ✅ 请在 settings.ini 中将其中一个设备名复制到 [paths] audio_input_device")
                else:
                    print(f"{_timestamp()} ❌ 未检测到任何音频设备!")
                    print(f"{_timestamp()} 可能原因:")
                    print(f"{_timestamp()}    - 虚拟音频设备（VB-Cable）未安装")
                    print(f"{_timestamp()}    - 系统音频设备未启用")
                    print(f"{_timestamp()} 下载 VB-Cable: https://vb-audio.com/Cable/")
            except Exception as e:
                print(f"{_timestamp()} (设备检测异常: {e})")
            
            print(f"{_timestamp()} 📝 配置步骤:")
            print(f"{_timestamp()}    1. 编辑 settings.ini 文件")
            print(f"{_timestamp()}    2. 找到 [paths] 部分的 audio_input_device = ")
            print(f"{_timestamp()}    3. 设置为上面列出的设备名")
            print(f"{_timestamp()}    4. 重启应用")
            return False
        
        # 🔥 重新清除停止标志，因为 stop_ffmpeg_stream() 已经设置过了
        STREAM_SHOULD_STOP.clear()
        print(f"{_timestamp()} ✓ 停止标志已清除，准备启动读取线程")
        
        start_stream_reader_thread()
        return True
        
    except Exception as e:
        print(f"{_timestamp()} ✗ FFmpeg 启动异常: {e}")
        import traceback
        traceback.print_exc()
        FFMPEG_PROCESS = None
        return False


def stop_ffmpeg_stream():
    """停止FFmpeg进程，使用安全关闭逻辑"""
    global FFMPEG_PROCESS
    
    # 🔥 首先设置停止标志，通知所有线程停止
    STREAM_SHOULD_STOP.set()
    
    # 🔥 等待广播队列清空（最多等待2秒）
    wait_time = 0
    while not BROADCAST_QUEUE.empty() and wait_time < 2.0:
        time.sleep(0.1)
        wait_time += 0.1
    
    # 🔥 给所有线程一点时间来响应停止标志
    time.sleep(0.3)
    
    if FFMPEG_PROCESS:
        stop_stream_safely(FFMPEG_PROCESS, timeout=3)
        FFMPEG_PROCESS = None
        print(f"{_timestamp()} ✓ FFmpeg 已停止")


def start_stream_reader_thread():
    """
    后台读取FFmpeg输出 - 异步广播优化版本
    三线程架构：
    1. read_stream()：读取FFmpeg → 放入广播队列（非阻塞）
    2. broadcast_worker()：从广播队列 → 并行分发给所有客户端
    3. send_heartbeats()：无数据时发送心跳
    """
    def read_stream():
        """FFmpeg读取线程 - 浏览器特定块大小"""
        global STREAM_STATS
        
        # � 检查FFmpeg进程是否成功启动
        if not FFMPEG_PROCESS:
            print(f"{_timestamp()} ✗ FFmpeg 进程未启动，读取线程无法运行")
            STREAM_SHOULD_STOP.set()
            return
        
        # �🔧 初始块大小，等客户端连接后动态调整
        chunk_size = get_chunk_size_for_browser("default")
        total_bytes = 0
        last_log_time = time.time()
        last_data_time = time.time()
        consecutive_empty_reads = 0
        
        STREAM_STATS["total_bytes"] = 0
        STREAM_STATS["start_time"] = time.time()
        STREAM_STATS["chunks_read"] = 0
        STREAM_STATS["chunks_broadcasted"] = 0
        STREAM_STATS["broadcast_fails"] = 0
        
        print(f"{_timestamp()} 📖 FFmpeg 读取线程启动，进程ID: {FFMPEG_PROCESS.pid}")
        print(f"{_timestamp()} 📡 异步广播模式启用 (Safari 缓冲: 64MB, 默认缓冲: 256MB, 心跳: 差异化)")
        
        # 🔍 检查进程是否已经在读取时退出
        poll_check = FFMPEG_PROCESS.poll()
        if poll_check is not None:
            print(f"{_timestamp()} ❌ FFmpeg 进程已在读取开始时退出! (退出码: {poll_check})")
            print(f"{_timestamp()} 🔍 这通常表示音频设备不存在或不可用")
            try:
                if FFMPEG_PROCESS.stderr:
                    errs = FFMPEG_PROCESS.stderr.read(4096).decode('utf-8', errors='ignore')
                    if errs.strip():
                        print(f"{_timestamp()} FFmpeg 错误: {errs[:300]}")
            except:
                pass
            STREAM_SHOULD_STOP.set()
            return
        
        # 检查 while 循环条件
        print(f"{_timestamp()} [DEBUG] 检查 while 循环条件: FFMPEG_PROCESS={bool(FFMPEG_PROCESS)}, poll()={FFMPEG_PROCESS.poll()}, STREAM_SHOULD_STOP.is_set()={STREAM_SHOULD_STOP.is_set()}")
        
        while FFMPEG_PROCESS and FFMPEG_PROCESS.poll() is None and not STREAM_SHOULD_STOP.is_set():
            try:
                # 阻塞读取FFmpeg输出
                chunk = FFMPEG_PROCESS.stdout.read(chunk_size)
                
                if chunk:
                    consecutive_empty_reads = 0
                    last_data_time = time.time()
                    
                    STREAM_STATS["chunks_read"] += 1
                    STREAM_STATS["total_bytes"] += len(chunk)
                    total_bytes += len(chunk)
                    
                    # � 新增：将块添加到重发缓冲池，并获取序列号
                    seq_id = add_to_retransmit_buffer(chunk)
                    
                    # 🔧 非阻塞广播：放入队列后立即返回（使用序列号标记）
                    CLIENT_POOL.broadcast_async((seq_id, chunk))
                else:
                    consecutive_empty_reads += 1
                    if consecutive_empty_reads == 1:
                        # 第一次读到空数据，立即诊断
                        print(f"{_timestamp()} ⚠️ FFmpeg 未返回数据，进行诊断...")
                        if FFMPEG_PROCESS.poll() is not None:
                            print(f"{_timestamp()} ❌ FFmpeg 进程已退出! (退出码: {FFMPEG_PROCESS.poll()})")
                            print(f"{_timestamp()} 🔍 音频设备问题 - 执行自动诊断...")
                            try:
                                if FFMPEG_PROCESS.stderr:
                                    errs = FFMPEG_PROCESS.stderr.read(4096).decode('utf-8', errors='ignore')
                                    if errs.strip():
                                        print(f"{_timestamp()} FFmpeg 错误: {errs[:500]}")
                            except:
                                pass
                            # 自动列出可用设备
                            print(f"{_timestamp()} 🔍 自动检测系统可用的音频设备...")
                            try:
                                result = subprocess.run(
                                    f'"{FFMPEG_CMD}" -list_devices true -f dshow -i dummy 2>&1',
                                    shell=True,
                                    capture_output=True,
                                    timeout=5,
                                    text=True
                                )
                                device_output = result.stderr + result.stdout
                                audio_devices = []
                                for line in device_output.split('\n'):
                                    if 'audio=' in line and '"' in line:
                                        start = line.find('"')
                                        end = line.rfind('"')
                                        if start != -1 and end != -1 and start < end:
                                            dev_name = line[start+1:end]
                                            audio_devices.append(dev_name)
                                
                                if audio_devices:
                                    print(f"{_timestamp()} ✅ 发现 {len(audio_devices)} 个音频设备:")
                                    for i, dev in enumerate(audio_devices, 1):
                                        print(f"{_timestamp()}    {i}. {dev}")
                                    print(f"{_timestamp()} ✅ 请在 settings.ini 中将其中一个设备名复制到 [paths] audio_input_device")
                                else:
                                    print(f"{_timestamp()} ❌ 未检测到任何音频设备!")
                                    print(f"{_timestamp()} 下载 VB-Cable: https://vb-audio.com/Cable/")
                            except:
                                pass
                            break
                    elif consecutive_empty_reads > 10:
                        print(f"{_timestamp()} ⚠️ FFmpeg 输出停止 (连续空读 {consecutive_empty_reads} 次)")
                        break
                
                # 每3秒日志
                now = time.time()
                if now - last_log_time >= 3.0:
                    speed = total_bytes / (now - last_log_time) / 1024 if (now - last_log_time) > 0 else 0
                    active = CLIENT_POOL.get_active_count()
                    bcast_queue = BROADCAST_QUEUE.qsize()
                    chunk_size_kb = chunk_size // 1024
                    time_since = now - last_data_time
                    
                    status = "✓" if active > 0 else "⚠️"
                    
                    # Safari 特殊监控
                    with CLIENT_POOL.lock:
                        safari_clients = [c for c in CLIENT_POOL.clients.values() if 'safari' in str(getattr(c, 'browser', '')).lower()]
                    
                    safari_info = ""
                    if safari_clients:
                        avg_queue_depth = sum(c.queue.qsize() for c in safari_clients) / len(safari_clients)
                        safari_info = f" | Safari队列深度: {avg_queue_depth:.1f}"
                    
                    print(f"🚀 速率: {speed:.1f}KB/s | 已读: {total_bytes/1024:.1f}KB | "
                          f"客户端: {active} {status} | 块大小: {chunk_size_kb}KB{safari_info}")
                    last_log_time = now
                    total_bytes = 0
                    
            except Exception as e:
                print(f"✗ 读取错误: {type(e).__name__}: {e}")
                time.sleep(0.1)
        
        print(f"{_timestamp()} 📤 FFmpeg 读取线程退出")
        # 🔥 当读取线程退出时，设置停止标志通知其他线程也退出
        STREAM_SHOULD_STOP.set()
    
    def broadcast_worker():
        """
        广播分发线程 - 优化版本
        🔧 终极优化：
        - 使用完全非阻塞的put_nowait
        - 超时改为0.2秒（更快响应）
        - 增加工作线程数40个
        """
        failed_clients = set()
        log_interval = time.time()
        empty_read_count = 0  # 🔥 新增：计数连续空读，如果停止标志设置且持续空读则退出
        
        while not STREAM_SHOULD_STOP.is_set() or not BROADCAST_QUEUE.empty():
            try:
                try:
                    item = BROADCAST_QUEUE.get(timeout=1.0)
                    empty_read_count = 0
                except queue.Empty:
                    empty_read_count += 1
                    # 🔥 如果停止标志已设置且连续2次空读，说明队列已清空，可以退出
                    if STREAM_SHOULD_STOP.is_set() and empty_read_count >= 2:
                        print(f"📊 广播线程检测到停止信号，准备退出")
                        break
                    # 定期清理死亡客户端
                    now = time.time()
                    with CLIENT_POOL.lock:
                        dead = [cid for cid, c in CLIENT_POOL.clients.items() if c.is_dead(timeout=30)]
                    for cid in dead:
                        CLIENT_POOL.unregister(cid)
                    continue
                
                # 🔥 解包：序列号 + 数据块（item 是 (seq_id, chunk) 元组或旧格式）
                if isinstance(item, tuple) and len(item) == 2:
                    first, second = item
                    # 判断是 (seq_id, chunk) 还是旧的 (chunk, timestamp) 格式
                    if isinstance(first, int) and isinstance(second, bytes):
                        # 新格式：(seq_id, chunk)
                        seq_id, chunk = first, second
                    elif isinstance(first, bytes) and isinstance(second, (float, int)):
                        # 旧格式：(chunk, timestamp) - 兼容性
                        chunk = first
                        seq_id = -1
                    else:
                        # 未知格式，跳过
                        continue
                else:
                    # 不是元组，跳过
                    continue
                
                # 获取客户端快照
                with CLIENT_POOL.lock:
                    clients_snapshot = list(CLIENT_POOL.clients.items())
                
                if not clients_snapshot:
                    continue
                
                # 🔧 分浏览器发送策略
                success_count = 0
                fail_count = 0
                
                for client_id, client_info in clients_snapshot:
                    try:
                        browser = getattr(client_info, 'browser', 'default')
                        
                        # 🔥 冗余发送优化：只有 Safari 发送2次（从3次降低到2次，结合客户端去重）
                        # 原因：客户端现在有去重机制，3倍冗余会导致CPU浪费和内存压力
                        redundancy = 2 if browser.lower() == 'safari' else 1
                        
                        for redundancy_attempt in range(redundancy):
                            # 根据浏览器类型使用不同策略
                            if browser.lower() == 'safari':
                                # 🔧🔧 Safari: 超激进重试（5次尝试）+ 冗余发送
                                for attempt in range(5):  # 尝试5次
                                    try:
                                        # 发送时包含序列号，供客户端检测丢包
                                        client_info.queue.put_nowait((seq_id, chunk))
                                        success_count += 1
                                        failed_clients.discard(client_id)
                                        break
                                    except queue.Full:
                                        if attempt <= 3:
                                            time.sleep(0.001)  # 1ms 短延迟重试
                                        else:  # 最后两次尝试
                                            # 激进清空队列（丢弃最近100个块的老数据）
                                            dropped = 0
                                            while not client_info.queue.empty() and dropped < 100:
                                                try:
                                                    client_info.queue.get_nowait()
                                                    dropped += 1
                                                except queue.Empty:
                                                    break
                                            try:
                                                client_info.queue.put_nowait((seq_id, chunk))
                                                success_count += 1
                                                failed_clients.discard(client_id)
                                                break
                                            except queue.Full:
                                                pass  # 即使再次失败也放弃
                            else:
                                # Chrome/Edge/Firefox: 标准发送
                                try:
                                    client_info.queue.put_nowait((seq_id, chunk))
                                    success_count += 1
                                    failed_clients.discard(client_id)
                                except queue.Full:
                                    # 丢弃最旧块再试
                                    try:
                                        client_info.queue.get_nowait()
                                        client_info.queue.put_nowait((seq_id, chunk))
                                        success_count += 1
                                        failed_clients.discard(client_id)
                                    except:
                                        fail_count += 1
                                        failed_clients.add(client_id)
                        
                        client_info.bytes_sent += len(chunk)
                        client_info.chunks_received += 1
                        client_info.update_activity()
                        CLIENT_POOL.stats["total_bytes_sent"] += len(chunk)
                        CLIENT_POOL.stats["total_chunks_sent"] += 1
                    
                    except Exception as e:
                        print(f"[ERROR] 发送失败 {client_id[:8]}: {e}")
                        fail_count += 1
                        failed_clients.add(client_id)
                
                STREAM_STATS["chunks_broadcasted"] += success_count
                if fail_count > 0:
                    STREAM_STATS["broadcast_fails"] += fail_count
                
                # 🔧 Safari 针对性日志：仅当有Safari客户端或有失败时才输出
                now = time.time()
                if now - log_interval >= 15.0:
                    with CLIENT_POOL.lock:
                        has_safari = any('safari' in str(getattr(c, 'browser', '')).lower() for c in CLIENT_POOL.clients.values())
                    
                    if has_safari or fail_count > 0:
                        queue_depth = BROADCAST_QUEUE.qsize()
                        print(f"📊 广播: {success_count}/{len(clients_snapshot)} 成功 | 队列深度: {queue_depth} | 失败: {len(failed_clients)}")
                    
                    log_interval = now
                
            except Exception as e:
                print(f"{_timestamp()} ❌ 广播线程异常: {e}")
                time.sleep(0.5)
    
    def send_heartbeats():
        """
        心跳保活线程 - 分浏览器差异化策略
        🔧 关键改进：
        - Safari: 50ms 激进心跳 + 20秒超时（防止暂停）
        - Chrome/Edge/Firefox: 1000ms 标准心跳 + 40秒超时
        - 每个客户端独立心跳配置，互不影响
        """
        # 维护每个客户端的上次心跳时间
        last_heartbeat_time = {}
        
        while not STREAM_SHOULD_STOP.is_set():
            try:
                now = time.time()
                
                with CLIENT_POOL.lock:
                    clients_snapshot = list(CLIENT_POOL.clients.items())
                
                for client_id, client in clients_snapshot:
                    try:
                        browser = getattr(client, 'browser', 'default')
                        config = get_heartbeat_config_for_browser(browser)
                        
                        # 检查是否需要发送心跳
                        if client_id not in last_heartbeat_time:
                            last_heartbeat_time[client_id] = now
                        
                        time_since_last = now - last_heartbeat_time[client_id]
                        
                        # 根据浏览器配置决定是否发送心跳
                        if time_since_last >= config["interval"]:
                            # 🔥 心跳包用特殊的负数序列号标记（-1），避免与数据块序列号混淆
                            # 只发送空字节心跳，避免解码器误处理导致爆音
                            keepalive_seq = -1
                            keepalive = b''  # 空字节，只用序列号维持连接
                            
                            try:
                                client.queue.put_nowait((keepalive_seq, keepalive))
                                last_heartbeat_time[client_id] = now
                                # 仅在调试模式下输出心跳日志（减少日志输出）
                            except queue.Full:
                                pass  # 队列满，丢弃心跳
                        
                        # 检查客户端超时（每个浏览器类型有不同超时时间）
                        if client.is_dead(timeout=config["timeout"]):
                            # 清理超时客户端（仅在超时时记录）
                            CLIENT_POOL.unregister(client_id)
                            if client_id in last_heartbeat_time:
                                del last_heartbeat_time[client_id]
                    
                    except Exception as e:
                        pass  # 心跳异常，无需输出日志
                
                # 清理已注销的客户端信息
                registered_clients = set(c_id for c_id, _ in clients_snapshot)
                dead_keys = [k for k in last_heartbeat_time.keys() if k not in registered_clients]
                for k in dead_keys:
                    del last_heartbeat_time[k]
                
                time.sleep(0.05)  # 50ms 检查间隔（保证Safari 响应）
                
            except Exception as e:
                if not STREAM_SHOULD_STOP.is_set():
                    # 只在没有停止时才输出错误，避免关闭时的日志干扰
                    time.sleep(0.5)
        
        print(f"{_timestamp()} ♥️ 心跳线程检测到停止信号，准备退出")
    
    # 启动三个线程
    read_thread = threading.Thread(target=read_stream, daemon=True, name="stream_reader")
    read_thread.start()
    
    broadcast_thread = threading.Thread(target=broadcast_worker, daemon=True, name="broadcast_worker")
    broadcast_thread.start()
    
    heartbeat_thread = threading.Thread(target=send_heartbeats, daemon=True, name="heartbeat_safari")
    heartbeat_thread.start()
    
    print(f"{_timestamp()} ✓ 三线程架构已启动: 读取线程 + 异步广播线程 + 心跳线程")


def register_client(client_id, browser_name: str = "default"):
    """注册客户端 - 使用客户端池管理，支持浏览器特定配置"""
    audio_format = FFMPEG_FORMAT or "mp3"
    client_queue = CLIENT_POOL.register(client_id, audio_format, browser_name)
    return client_queue


def unregister_client(client_id):
    """注销客户端"""
    CLIENT_POOL.unregister(client_id)


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


def get_stream_stats():
    """
    获取完整的流统计信息
    返回包含客户端池统计的详细数据
    """
    pool_stats = CLIENT_POOL.get_stats()
    
    total_bytes = STREAM_STATS.get("total_bytes", 0)
    start_time = STREAM_STATS.get("start_time")
    duration = 0
    avg_speed = 0
    
    if start_time:
        duration = time.time() - start_time
        if duration > 0:
            avg_speed = (total_bytes / 1024) / duration
    
    running = FFMPEG_PROCESS is not None and FFMPEG_PROCESS.poll() is None
    
    return {
        "status": "OK",
        "running": running,
        "format": FFMPEG_FORMAT or "mp3",  # 默认显示mp3格式
        "duration": round(duration, 2),
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / 1024 / 1024, 2),
        "avg_speed_kbps": round(avg_speed, 2),
        "chunks_read": STREAM_STATS.get("chunks_read", 0),
        "chunks_broadcasted": STREAM_STATS.get("chunks_broadcasted", 0),
        "broadcast_fails": STREAM_STATS.get("broadcast_fails", 0),
        "pool": pool_stats,
    }


# ==================== 向后兼容性 ====================
# 为了与旧代码兼容，提供 ACTIVE_CLIENTS 引用
# 注意：推荐使用 CLIENT_POOL 接口
@property
def ACTIVE_CLIENTS():
    """向后兼容 - 返回活跃客户端字典"""
    with CLIENT_POOL.lock:
        return {cid: c.queue for cid, c in CLIENT_POOL.clients.items()}

# 也导出为简单的 dict-like 对象
class _ActiveClientsCompat:
    def __init__(self, pool):
        self.pool = pool
    
    def __len__(self):
        return self.pool.get_active_count()
    
    def __contains__(self, key):
        return self.pool.get_client(key) is not None
    
    def __getitem__(self, key):
        client = self.pool.get_client(key)
        if client:
            return client.queue
        raise KeyError(key)
    
    def items(self):
        with self.pool.lock:
            return [(cid, c.queue) for cid, c in self.pool.clients.items()]
    
    def __repr__(self):
        return f"<ACTIVE_CLIENTS: {self.pool.get_active_count()} clients>"

# 导出兼容接口
ACTIVE_CLIENTS = _ActiveClientsCompat(CLIENT_POOL)
