# -*- coding: utf-8 -*-
"""
WebRTC 信令模块 - 使用 sounddevice 采集音频
使用 aiortc 实现 Python 端 WebRTC 媒体服务
"""

import asyncio
import fractions
import json
import logging
import os
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional, Set, Callable
from collections import deque

logger = logging.getLogger(__name__)

# ==================== 依赖检查 ====================
try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
    from aiortc.contrib.media import MediaPlayer, MediaRecorder
    from aiortc.mediastreams import AudioStreamTrack
    import av
    AIORTC_AVAILABLE = True
except ImportError:
    AIORTC_AVAILABLE = False
    logger.warning("aiortc 未安装，WebRTC 功能不可用。请运行: pip install aiortc")

# sounddevice 依赖检查（替代 PyAudio，无需编译）
try:
    import sounddevice as sd
    import numpy as np
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False
    logger.warning("sounddevice 未安装，音频采集功能不可用。请运行: pip install sounddevice")

# ==================== 音频轨道类 ====================

class VirtualAudioTrack(AudioStreamTrack):
    """
    虚拟音频轨道 - 从 VB-Cable 或系统音频采集
    使用 sounddevice 作为音频采集后端（纯 Python，无需编译）
    """
    
    kind = "audio"
    
    def __init__(self, device_name: str = "CABLE Output (VB-Audio Virtual Cable)", 
                 sample_rate: int = 48000, channels: int = 2):
        super().__init__()
        self.device_name = device_name
        self.sample_rate = sample_rate
        self.channels = channels
        self._queue = asyncio.Queue(maxsize=100)
        self._running = False
        self._capture_thread = None
        self._start_time = None
        self._frame_count = 0
        
        # sounddevice 实例
        self._stream = None
        self._device_index = None
        self._loop = None
        
        # 带宽统计
        self._bytes_sent = 0
        self._bytes_captured = 0
        self._last_stats_time = None
        self._last_bytes_sent = 0
        self._last_bytes_captured = 0
        
    def _find_device_index(self) -> Optional[int]:
        """查找指定名称的音频设备索引
        
        优先选择 2 通道版本的设备（立体声，与 WebRTC 兼容）
        """
        if not SOUNDDEVICE_AVAILABLE:
            return None
            
        try:
            devices = sd.query_devices()
            
            # 记录所有匹配的设备，优先选择 2 通道版本
            matched_devices = []
            
            for i, dev in enumerate(devices):
                name = dev.get('name', '')
                max_input_channels = dev.get('max_input_channels', 0)
                
                # 查找匹配的输入设备（必须是 CABLE Output）
                if max_input_channels > 0 and self.device_name.lower() in name.lower():
                    matched_devices.append({
                        'index': i,
                        'name': name,
                        'channels': max_input_channels
                    })
                    logger.info(f"[WebRTC] 发现设备: {name} (索引: {i}, 通道数: {max_input_channels})")
            
            if matched_devices:
                # 优先选择 2 通道版本（立体声，与 WebRTC 最兼容）
                stereo_devices = [d for d in matched_devices if d['channels'] == 2]
                if stereo_devices:
                    selected = stereo_devices[0]
                    logger.info(f"[WebRTC] ✓ 选择 2 通道设备: {selected['name']} (索引: {selected['index']})")
                    return selected['index']
                else:
                    # 没有 2 通道设备，选择通道数最小的（更兼容）
                    selected = min(matched_devices, key=lambda d: d['channels'])
                    logger.info(f"[WebRTC] ✓ 选择设备: {selected['name']} (索引: {selected['index']}, 通道数: {selected['channels']})")
                    return selected['index']
                    
            # 如果没找到指定设备，列出所有可用的输入设备
            logger.warning(f"[WebRTC] 未找到设备 '{self.device_name}'，可用的输入设备:")
            for i, dev in enumerate(devices):
                if dev.get('max_input_channels', 0) > 0:
                    logger.warning(f"  [{i}] {dev.get('name')} ({dev.get('max_input_channels')}ch)")
                    
            return None
            
        except Exception as e:
            logger.error(f"[WebRTC] 查找音频设备失败: {e}")
            return None
        
    async def start(self):
        """启动音频采集"""
        if self._running:
            return
            
        if not SOUNDDEVICE_AVAILABLE:
            logger.error("[WebRTC] sounddevice 未安装，无法启动音频采集")
            return
            
        # 查找设备索引
        self._device_index = self._find_device_index()
        if self._device_index is None:
            logger.error(f"[WebRTC] 无法找到音频设备: {self.device_name}")
            return
            
        self._running = True
        self._start_time = time.time()
        self._frame_count = 0
        self._loop = asyncio.get_event_loop()
        
        # 初始化带宽统计
        self._bytes_sent = 0
        self._bytes_captured = 0
        self._last_stats_time = time.time()
        self._last_bytes_sent = 0
        self._last_bytes_captured = 0
        
        # 在后台线程中运行 sounddevice 采集
        self._capture_thread = threading.Thread(
            target=self._capture_audio_loop,
            daemon=True,
            name="WebRTC-AudioCapture"
        )
        self._capture_thread.start()
        logger.info(f"[WebRTC] sounddevice 音频采集已启动: {self.device_name}")
        
    def stop(self):
        """停止音频采集"""
        self._running = False
        
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except:
                pass
            self._stream = None
            
        logger.info("[WebRTC] sounddevice 音频采集已停止")
        
    def _capture_audio_loop(self):
        """sounddevice 音频采集循环（在后台线程中运行）"""
        logger.info("[WebRTC] 🎤 音频采集线程已启动")
        try:
            # 每帧 960 样本 @ 48kHz = 20ms（WebRTC 标准帧长度）
            frame_samples = 960
            
            logger.info(f"[WebRTC] sounddevice 流已打开: {self.sample_rate}Hz, {self.channels}ch, {frame_samples} samples/frame")
            logger.info(f"[WebRTC] 使用设备索引: {self._device_index}")
            
            # 使用 InputStream 进行阻塞式录制
            with sd.InputStream(
                device=self._device_index,
                channels=self.channels,
                samplerate=self.sample_rate,
                dtype='int16',
                blocksize=frame_samples
            ) as stream:
                while self._running:
                    try:
                        # 读取一帧音频数据
                        audio_data, overflowed = stream.read(frame_samples)
                        
                        if overflowed:
                            logger.debug("[WebRTC] 音频缓冲区溢出")
                        
                        if audio_data is None or len(audio_data) == 0:
                            continue
                            
                        self._frame_count += 1
                        
                        # 转换为字节数据
                        data = audio_data.tobytes()
                        self._bytes_captured += len(data)
                        
                        # 每500帧输出一次采集状态（约10秒）- 简化日志
                        if self._frame_count % 500 == 0:
                            max_amplitude = np.max(np.abs(audio_data))
                            logger.debug(
                                f"[WebRTC] 🎤 音频采集 | "
                                f"帧数: {self._frame_count} | "
                                f"队列: {self._queue.qsize()}/100 | "
                                f"电平: {max_amplitude}"
                            )
                        
                        # 创建 PyAV 音频帧
                        frame = av.AudioFrame(
                            format='s16',
                            layout='stereo' if self.channels == 2 else 'mono',
                            samples=frame_samples
                        )
                        frame.planes[0].update(data)
                        frame.sample_rate = self.sample_rate
                        # 使用正确的时间基准：采样点数 * 帧序号
                        frame.pts = self._frame_count * frame_samples
                        frame.time_base = fractions.Fraction(1, self.sample_rate)
                        
                        # 放入队列
                        try:
                            future = asyncio.run_coroutine_threadsafe(
                                self._queue.put(frame),
                                self._loop
                            )
                            future.result(timeout=0.1)
                        except asyncio.QueueFull:
                            pass  # 队列满，丢弃帧
                        except Exception as e:
                            if self._running:
                                logger.debug(f"[WebRTC] 放入队列失败: {e}")
                                
                    except Exception as e:
                        if self._running:
                            logger.error(f"[WebRTC] 读取音频帧失败: {e}")
                        time.sleep(0.01)
                        
        except Exception as e:
            logger.error(f"[WebRTC] sounddevice 采集异常: {e}")
                    
    async def recv(self):
        """接收下一帧音频（WebRTC 调用）"""
        if not self._running:
            logger.info("[WebRTC] recv() 调用时采集未运行，启动采集...")
            await self.start()
            
        try:
            frame = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            # 统计发送字节数
            if frame and hasattr(frame, 'planes') and len(frame.planes) > 0:
                self._bytes_sent += len(bytes(frame.planes[0]))
            # 每500帧输出一次统计（约10秒）
            if self._frame_count > 0 and self._frame_count % 500 == 0:
                logger.info(f"[WebRTC] 📤 已发送 {self._frame_count} 帧到 WebRTC")
            return frame
        except asyncio.TimeoutError:
            # 超时返回静音帧
            frame_samples = 960
            # 使用与采集相同的方式创建静音帧
            silence_bytes = bytes(frame_samples * self.channels * 2)  # 16-bit = 2 bytes per sample
            frame = av.AudioFrame(format='s16', layout='stereo' if self.channels == 2 else 'mono', samples=frame_samples)
            frame.planes[0].update(silence_bytes)
            frame.sample_rate = self.sample_rate
            frame.pts = self._frame_count * frame_samples
            frame.time_base = fractions.Fraction(1, self.sample_rate)
            self._frame_count += 1
            return frame


# ==================== 客户端会话管理 ====================

@dataclass
class WebRTCClient:
    """WebRTC 客户端会话"""
    client_id: str
    peer_connection: Optional[object] = None  # RTCPeerConnection
    audio_track: Optional[VirtualAudioTrack] = None
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    state: str = "new"  # new, connecting, connected, disconnected, failed
    
    def update_activity(self):
        self.last_activity = time.time()
        
    def is_expired(self, timeout: float = 60.0) -> bool:
        # 如果连接状态仍然是 connected，则不认为过期
        if self.state == "connected":
            return False
        return time.time() - self.last_activity > timeout


class WebRTCSignalingServer:
    """
    WebRTC 信令服务器
    管理多客户端连接、SDP 交换、ICE candidate 交换
    """
    
    def __init__(self, audio_device: str = "CABLE Output (VB-Audio Virtual Cable)"):
        self.clients: Dict[str, WebRTCClient] = {}
        self._lock = threading.Lock()
        self.audio_device = audio_device
        self._cleanup_task = None
        self._shared_audio_track: Optional[VirtualAudioTrack] = None
        
        # 事件回调
        self.on_client_connected: Optional[Callable] = None
        self.on_client_disconnected: Optional[Callable] = None
        
        # 统计信息
        self.stats = {
            "total_clients_ever": 0,
            "peak_concurrent": 0,
            "total_offers_processed": 0,
            "total_answers_sent": 0,
        }
        
        # 带宽监控
        self._bandwidth_task = None
        self._last_bytes_sent = {}  # 每个客户端的上次发送字节数
        self._last_stats_time = time.time()
        
    async def start(self):
        """启动信令服务器"""
        if not AIORTC_AVAILABLE:
            logger.error("[WebRTC] aiortc 未安装，无法启动信令服务器")
            return False
            
        # 启动客户端清理任务
        self._cleanup_task = asyncio.create_task(self._cleanup_expired_clients())
        
        # 启动带宽监控任务
        self._bandwidth_task = asyncio.create_task(self._monitor_bandwidth())
        
        # 创建共享音频轨道
        self._shared_audio_track = VirtualAudioTrack(device_name=self.audio_device)
        await self._shared_audio_track.start()
        
        logger.info("[WebRTC] 信令服务器已启动")
        return True
        
    async def stop(self):
        """停止信令服务器"""
        # 停止清理任务
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        # 停止带宽监控任务
        if self._bandwidth_task:
            self._bandwidth_task.cancel()
            try:
                await self._bandwidth_task
            except asyncio.CancelledError:
                pass
                
        # 停止共享音频轨道
        if self._shared_audio_track:
            self._shared_audio_track.stop()
            
        # 关闭所有客户端连接
        for client_id in list(self.clients.keys()):
            await self.remove_client(client_id)
            
        logger.info("[WebRTC] 信令服务器已停止")
        
    async def _cleanup_expired_clients(self):
        """定期清理过期客户端"""
        while True:
            try:
                await asyncio.sleep(30)  # 每30秒检查一次
                
                expired_clients = []
                with self._lock:
                    for client_id, client in self.clients.items():
                        if client.is_expired(timeout=60):
                            expired_clients.append(client_id)
                            
                for client_id in expired_clients:
                    logger.info(f"[WebRTC] 清理过期客户端: {client_id[:8]}...")
                    await self.remove_client(client_id)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[WebRTC] 清理任务异常: {e}")
    
    async def _monitor_bandwidth(self):
        """定期监控真实的 WebRTC 网络传输带宽"""
        logger.info("[WebRTC] 📊 带宽监控任务已启动")
        
        while True:
            try:
                await asyncio.sleep(2)  # 每2秒统计一次
                
                current_time = time.time()
                elapsed = current_time - self._last_stats_time
                
                if elapsed <= 0:
                    continue
                
                total_bytes_sent = 0
                connected_clients = 0
                
                # 遍历所有已连接的客户端，获取其 RTCPeerConnection 统计
                with self._lock:
                    client_list = list(self.clients.items())
                
                for client_id, client in client_list:
                    if client.state != "connected" or not client.peer_connection:
                        continue
                    
                    connected_clients += 1
                    
                    try:
                        # 获取 RTCPeerConnection 的统计信息
                        stats = await client.peer_connection.getStats()
                        
                        for report in stats.values():
                            # 查找 outbound-rtp 类型的统计（发送的媒体流）
                            if report.type == "outbound-rtp" and report.kind == "audio":
                                bytes_sent = getattr(report, 'bytesSent', 0)
                                
                                # 计算增量
                                last_bytes = self._last_bytes_sent.get(client_id, 0)
                                delta_bytes = bytes_sent - last_bytes
                                
                                if delta_bytes > 0:
                                    total_bytes_sent += delta_bytes
                                
                                # 更新记录
                                self._last_bytes_sent[client_id] = bytes_sent
                                break
                                
                    except Exception as e:
                        logger.debug(f"[WebRTC] 获取客户端 {client_id[:8]} 统计失败: {e}")
                
                # 计算并输出带宽
                if connected_clients > 0 and total_bytes_sent > 0:
                    bandwidth_kbps = (total_bytes_sent * 8) / (elapsed * 1000)
                    bandwidth_mbps = bandwidth_kbps / 1000
                    
                    logger.info(
                        f"[WebRTC] 📡 网络传输 | "
                        f"速率: {bandwidth_kbps:.1f} kbps ({bandwidth_mbps:.2f} Mbps) | "
                        f"已连接: {connected_clients} 个客户端"
                    )
                
                self._last_stats_time = current_time
                
                # 清理已断开客户端的记录
                active_ids = set(self.clients.keys())
                self._last_bytes_sent = {k: v for k, v in self._last_bytes_sent.items() if k in active_ids}
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[WebRTC] 带宽监控异常: {e}")
                
    def generate_client_id(self) -> str:
        """生成唯一客户端ID"""
        return str(uuid.uuid4())
        
    async def create_client(self, client_id: str = None) -> WebRTCClient:
        """创建新客户端会话"""
        if not AIORTC_AVAILABLE:
            raise RuntimeError("aiortc 未安装")
            
        if not client_id:
            client_id = self.generate_client_id()
            
        # 创建 RTCPeerConnection
        pc = RTCPeerConnection()
        
        # 创建客户端会话
        client = WebRTCClient(
            client_id=client_id,
            peer_connection=pc,
        )
        
        # 添加音频轨道
        if self._shared_audio_track:
            pc.addTrack(self._shared_audio_track)
            client.audio_track = self._shared_audio_track
            
        # 设置连接状态回调
        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            state = pc.connectionState
            logger.info(f"[WebRTC] 客户端 {client_id[:8]} 连接状态: {state}")
            client.state = state
            client.update_activity()
            
            if state == "connected":
                if self.on_client_connected:
                    self.on_client_connected(client_id)
            elif state in ("disconnected", "failed", "closed"):
                if self.on_client_disconnected:
                    self.on_client_disconnected(client_id)
                    
        @pc.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange():
            logger.debug(f"[WebRTC] 客户端 {client_id[:8]} ICE 状态: {pc.iceConnectionState}")
            
        # 保存客户端
        with self._lock:
            self.clients[client_id] = client
            self.stats["total_clients_ever"] += 1
            current_count = len(self.clients)
            if current_count > self.stats["peak_concurrent"]:
                self.stats["peak_concurrent"] = current_count
                
        logger.info(f"[WebRTC] 新客户端已创建: {client_id[:8]}... (当前: {len(self.clients)})")
        return client
        
    async def remove_client(self, client_id: str):
        """移除客户端会话"""
        with self._lock:
            client = self.clients.pop(client_id, None)
            
        if client and client.peer_connection:
            try:
                await client.peer_connection.close()
            except Exception as e:
                logger.warning(f"[WebRTC] 关闭连接失败: {e}")
                
        logger.info(f"[WebRTC] 客户端已移除: {client_id[:8]}... (剩余: {len(self.clients)})")
        
    def get_client(self, client_id: str) -> Optional[WebRTCClient]:
        """获取客户端会话"""
        with self._lock:
            return self.clients.get(client_id)
            
    async def handle_offer(self, client_id: str, offer_sdp: str) -> Optional[str]:
        """
        处理来自浏览器的 SDP Offer，返回 Answer
        
        Args:
            client_id: 客户端ID
            offer_sdp: SDP Offer 字符串
            
        Returns:
            SDP Answer 字符串，或 None 如果失败
        """
        client = self.get_client(client_id)
        if not client:
            # 创建新客户端
            client = await self.create_client(client_id)
            
        pc = client.peer_connection
        if not pc:
            logger.error(f"[WebRTC] 客户端 {client_id[:8]} 没有 PeerConnection")
            return None
            
        try:
            # 设置远端描述（Offer）
            offer = RTCSessionDescription(sdp=offer_sdp, type="offer")
            await pc.setRemoteDescription(offer)
            
            # 创建 Answer
            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            
            client.state = "connecting"
            client.update_activity()
            self.stats["total_offers_processed"] += 1
            self.stats["total_answers_sent"] += 1
            
            # 【带宽优化】限制音频比特率到 128 kbps（节省约 90% 带宽）
            original_sdp = pc.localDescription.sdp
            limited_sdp = self._limit_audio_bitrate(original_sdp, max_bitrate_kbps=128)
            
            logger.info(f"[WebRTC] 已处理 Offer 并生成 Answer (带宽限制: 128kbps): {client_id[:8]}...")
            return limited_sdp
            
        except Exception as e:
            logger.error(f"[WebRTC] 处理 Offer 失败: {e}")
            client.state = "failed"
            return None
    
    def _limit_audio_bitrate(self, sdp: str, max_bitrate_kbps: int = 128) -> str:
        """
        修改 SDP 以限制音频比特率
        
        通过在 SDP 的音频部分添加 b=AS:xxx 行来限制带宽
        
        Args:
            sdp: 原始 SDP 字符串
            max_bitrate_kbps: 最大比特率（kbps），默认 128
        
        Returns:
            修改后的 SDP 字符串
        """
        lines = sdp.split('\r\n')
        new_lines = []
        in_audio_section = False
        bandwidth_added = False
        
        for line in lines:
            new_lines.append(line)
            
            # 检测进入音频媒体部分
            if line.startswith('m=audio'):
                in_audio_section = True
                bandwidth_added = False
                logger.debug(f"[WebRTC SDP] 进入音频部分")
            # 检测离开音频部分（进入其他媒体部分）
            elif line.startswith('m='):
                in_audio_section = False
            
            # 在 c= 行（连接信息）后添加带宽限制
            if in_audio_section and line.startswith('c=') and not bandwidth_added:
                bandwidth_line = f'b=AS:{max_bitrate_kbps}'
                new_lines.append(bandwidth_line)
                bandwidth_added = True
                logger.info(f"[WebRTC SDP] ✓ 已添加带宽限制: {bandwidth_line}")
        
        return '\r\n'.join(new_lines)
            
    async def handle_ice_candidate(self, client_id: str, candidate: dict) -> bool:
        """
        处理来自浏览器的 ICE Candidate
        
        Args:
            client_id: 客户端ID
            candidate: ICE candidate 字典
            
        Returns:
            是否成功
        """
        client = self.get_client(client_id)
        if not client or not client.peer_connection:
            logger.warning(f"[WebRTC] 未知客户端的 ICE candidate: {client_id[:8]}")
            return False
            
        try:
            # aiortc 通常自己处理 ICE candidate 收集和交换
            # 浏览器发来的 ICE candidate 在 aiortc 中可能不需要手动添加
            # 记录收到的 candidate 但不阻塞连接
            candidate_str = candidate.get("candidate", "")
            
            # 如果 candidate 为空，这是 ICE 完成信号
            if not candidate_str:
                logger.debug(f"[WebRTC] 收到 ICE 完成信号: {client_id[:8]}...")
                return True
            
            # aiortc 的 ICE 处理是自动的，这里只记录日志
            logger.debug(f"[WebRTC] 收到 ICE candidate: {client_id[:8]}... (aiortc 自动处理)")
            client.update_activity()
            return True
            
        except Exception as e:
            logger.warning(f"[WebRTC] ICE candidate 处理: {e}")
            return True  # 返回 True 避免前端重试
            
    def get_stats(self) -> dict:
        """获取服务器统计信息"""
        with self._lock:
            active_clients = len(self.clients)
            client_states = {}
            for client in self.clients.values():
                state = client.state
                client_states[state] = client_states.get(state, 0) + 1
                
        return {
            "active_clients": active_clients,
            "client_states": client_states,
            "total_clients_ever": self.stats["total_clients_ever"],
            "peak_concurrent": self.stats["peak_concurrent"],
            "total_offers_processed": self.stats["total_offers_processed"],
            "total_answers_sent": self.stats["total_answers_sent"],
            "audio_device": self.audio_device,
            "aiortc_available": AIORTC_AVAILABLE,
        }


# ==================== 全局信令服务器实例 ====================

# 延迟初始化，由 app.py 在需要时创建
SIGNALING_SERVER: Optional[WebRTCSignalingServer] = None


def get_signaling_server() -> Optional[WebRTCSignalingServer]:
    """获取全局信令服务器实例"""
    return SIGNALING_SERVER


async def initialize_signaling_server(audio_device: str = None) -> WebRTCSignalingServer:
    """初始化全局信令服务器"""
    global SIGNALING_SERVER
    
    if SIGNALING_SERVER:
        return SIGNALING_SERVER
        
    if audio_device is None:
        audio_device = "CABLE Output (VB-Audio Virtual Cable)"
        
    SIGNALING_SERVER = WebRTCSignalingServer(audio_device=audio_device)
    await SIGNALING_SERVER.start()
    
    return SIGNALING_SERVER


async def shutdown_signaling_server():
    """关闭全局信令服务器"""
    global SIGNALING_SERVER
    
    if SIGNALING_SERVER:
        await SIGNALING_SERVER.stop()
        SIGNALING_SERVER = None
