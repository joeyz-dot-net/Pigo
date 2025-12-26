/**
 * WebRTC 信令客户端模块
 * 替代原有的 FFmpeg HTTP 推流，使用 WebRTC 实现低延迟音频传输
 */

import { Toast } from './ui.js';

/**
 * WebRTC 连接状态
 */
const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    FAILED: 'failed',
    CLOSED: 'closed'
};

/**
 * WebRTC 信令管理器
 */
class WebRTCSignaling {
    constructor() {
        // WebSocket 连接
        this.ws = null;
        this.wsUrl = this._getWebSocketUrl();
        
        // RTCPeerConnection
        this.peerConnection = null;
        
        // 客户端ID（由服务器分配）
        this.clientId = null;
        
        // 连接状态
        this.state = ConnectionState.DISCONNECTED;
        
        // 音频元素
        this.audioElement = null;
        
        // 远端音频流
        this.remoteStream = null;
        
        // 事件回调
        this.onStateChange = null;
        this.onAudioReady = null;
        this.onError = null;
        
        // 重连配置
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // ms
        this.reconnectTimer = null;
        
        // 心跳配置
        this.heartbeatInterval = null;
        this.heartbeatTimeout = 15000; // 15秒发送一次心跳，确保在60秒超时前更新活动时间
        
        // ICE 服务器配置
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
        
        // 调试模式
        this.debug = localStorage.getItem('DEBUG_MODE') === 'true';
    }
    
    /**
     * 获取 WebSocket URL
     */
    _getWebSocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws/signaling`;
    }
    
    /**
     * 日志输出
     */
    _log(level, ...args) {
        const prefix = '[WebRTC]';
        const timestamp = new Date().toLocaleTimeString();
        
        if (level === 'error') {
            console.error(prefix, timestamp, ...args);
        } else if (level === 'warn') {
            console.warn(prefix, timestamp, ...args);
        } else if (this.debug || level === 'info') {
            console.log(prefix, timestamp, ...args);
        }
    }
    
    /**
     * 更新连接状态
     */
    _setState(newState) {
        if (this.state !== newState) {
            this._log('info', `状态变化: ${this.state} → ${newState}`);
            this.state = newState;
            
            if (this.onStateChange) {
                this.onStateChange(newState);
            }
        }
    }
    
    /**
     * 连接信令服务器
     */
    async connect() {
        if (this.state === ConnectionState.CONNECTING || 
            this.state === ConnectionState.CONNECTED) {
            this._log('warn', '已在连接中或已连接');
            return;
        }
        
        this._setState(ConnectionState.CONNECTING);
        this._log('info', '正在连接信令服务器...');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);
                
                this.ws.onopen = () => {
                    this._log('info', '✓ WebSocket 连接成功');
                    this.reconnectAttempts = 0;
                    this._startHeartbeat();
                };
                
                this.ws.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        await this._handleMessage(data);
                        
                        // 收到 client_id 后开始建立 WebRTC 连接
                        if (data.type === 'client_id') {
                            this.clientId = data.client_id;
                            this._log('info', `客户端ID: ${this.clientId.substring(0, 8)}...`);
                            await this._createOffer();
                            resolve();
                        }
                    } catch (err) {
                        this._log('error', '处理消息失败:', err);
                    }
                };
                
                this.ws.onerror = (error) => {
                    this._log('error', 'WebSocket 错误:', error);
                    if (this.onError) {
                        this.onError(error);
                    }
                    reject(error);
                };
                
                this.ws.onclose = (event) => {
                    this._log('info', `WebSocket 关闭: code=${event.code}`);
                    this._stopHeartbeat();
                    this._setState(ConnectionState.DISCONNECTED);
                    
                    // 尝试重连
                    if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this._scheduleReconnect();
                    }
                };
                
            } catch (err) {
                this._log('error', '创建 WebSocket 失败:', err);
                this._setState(ConnectionState.FAILED);
                reject(err);
            }
        });
    }
    
    /**
     * 断开连接
     */
    async disconnect() {
        this._log('info', '断开连接...');
        
        // 停止重连和心跳
        this._cancelReconnect();
        this._stopHeartbeat();
        
        // 关闭 RTCPeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // 关闭 WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        // 清理音频
        if (this.audioElement) {
            this.audioElement.srcObject = null;
        }
        
        this.remoteStream = null;
        this.clientId = null;
        this._setState(ConnectionState.CLOSED);
    }
    
    /**
     * 处理服务器消息
     */
    async _handleMessage(data) {
        const { type } = data;
        
        switch (type) {
            case 'client_id':
                // 已在 onmessage 中处理
                break;
                
            case 'answer':
                await this._handleAnswer(data.sdp);
                break;
                
            case 'ice':
                await this._handleRemoteIceCandidate(data.candidate);
                break;
                
            case 'error':
                this._log('error', '服务器错误:', data.message);
                if (this.onError) {
                    this.onError(new Error(data.message));
                }
                break;
                
            case 'pong':
                // 心跳响应
                this._log('debug', '收到心跳响应');
                break;
                
            default:
                this._log('warn', '未知消息类型:', type);
        }
    }
    
    /**
     * 创建并发送 Offer
     */
    async _createOffer() {
        this._log('info', '创建 RTCPeerConnection...');
        
        // 创建 PeerConnection
        this.peerConnection = new RTCPeerConnection({
            iceServers: this.iceServers
        });
        
        // 监听 ICE candidate
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this._log('debug', '发送 ICE candidate');
                this._send({
                    type: 'ice',
                    candidate: {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    }
                });
            }
        };
        
        // 监听连接状态变化
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            this._log('info', `RTCPeerConnection 状态: ${state}`);
            
            switch (state) {
                case 'connected':
                    this._setState(ConnectionState.CONNECTED);
                    Toast.success('🎵 WebRTC 音频已连接');
                    break;
                case 'disconnected':
                    this._setState(ConnectionState.DISCONNECTED);
                    break;
                case 'failed':
                    this._setState(ConnectionState.FAILED);
                    Toast.error('WebRTC 连接失败');
                    break;
            }
        };
        
        // 监听 ICE 连接状态
        this.peerConnection.oniceconnectionstatechange = () => {
            this._log('debug', `ICE 状态: ${this.peerConnection.iceConnectionState}`);
        };
        
        // 监听远端音频轨道
        this.peerConnection.ontrack = (event) => {
            console.log('%c[WebRTC] ✓ 收到远端音频轨道!', 'color: #4CAF50; font-weight: bold; font-size: 14px');
            console.log('[WebRTC] event.track:', event.track);
            console.log('[WebRTC] event.track.muted:', event.track.muted);
            console.log('[WebRTC] event.track.readyState:', event.track.readyState);
            console.log('[WebRTC] event.streams:', event.streams);
            
            // 监听轨道 unmute 事件（当开始接收音频数据时触发）
            event.track.onunmute = () => {
                console.log('%c[WebRTC] ✓ 音频轨道已 unmute - 开始接收数据!', 'color: #4CAF50; font-weight: bold');
            };
            
            event.track.onmute = () => {
                console.log('%c[WebRTC] ⚠️ 音频轨道 muted', 'color: #FF9800; font-weight: bold');
            };
            
            event.track.onended = () => {
                console.log('%c[WebRTC] ❌ 音频轨道已结束', 'color: #F44336; font-weight: bold');
            };
            
            if (event.streams && event.streams[0]) {
                this.remoteStream = event.streams[0];
                console.log('[WebRTC] 使用事件中的流');
            } else {
                // 如果没有流，创建一个新的
                this.remoteStream = new MediaStream();
                this.remoteStream.addTrack(event.track);
                console.log('[WebRTC] 创建新的 MediaStream 并添加轨道');
            }
            
            console.log('[WebRTC] remoteStream 轨道数:', this.remoteStream.getTracks().length);
            console.log('[WebRTC] audioElement 存在:', !!this.audioElement);
            
            // 设置到音频元素
            if (this.audioElement) {
                console.log('[WebRTC] 设置 audioElement.srcObject...');
                this.audioElement.srcObject = this.remoteStream;
                
                // 确保音量不是0
                if (this.audioElement.volume === 0) {
                    this.audioElement.volume = 0.5;
                    console.log('[WebRTC] 音量为0，设置为0.5');
                }
                
                // 确保不是静音
                if (this.audioElement.muted) {
                    this.audioElement.muted = false;
                    console.log('[WebRTC] 取消静音');
                }
                
                this.audioElement.play().then(() => {
                    console.log('%c[WebRTC] ✓ 音频播放已启动!', 'color: #4CAF50; font-weight: bold');
                    if (this.onAudioReady) {
                        this.onAudioReady(this.remoteStream);
                    }
                }).catch(err => {
                    console.warn('[WebRTC] ⚠️ 自动播放被阻止:', err);
                    Toast.info('请点击页面以启用音频播放');
                });
            } else {
                console.error('[WebRTC] ❌ audioElement 不存在，无法播放音频！');
            }
        };
        
        // 添加音频收发器（只接收）
        this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        
        // 创建 Offer
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this._log('info', '发送 Offer...');
            this._send({
                type: 'offer',
                sdp: offer.sdp
            });
        } catch (err) {
            this._log('error', '创建 Offer 失败:', err);
            this._setState(ConnectionState.FAILED);
            throw err;
        }
    }
    
    /**
     * 处理服务器 Answer
     */
    async _handleAnswer(sdp) {
        if (!this.peerConnection) {
            this._log('error', '收到 Answer 但没有 PeerConnection');
            return;
        }
        
        try {
            this._log('info', '收到 Answer，设置远端描述...');
            const answer = new RTCSessionDescription({
                type: 'answer',
                sdp: sdp
            });
            await this.peerConnection.setRemoteDescription(answer);
            this._log('info', '✓ 远端描述已设置');
        } catch (err) {
            this._log('error', '设置 Answer 失败:', err);
            this._setState(ConnectionState.FAILED);
        }
    }
    
    /**
     * 处理远端 ICE candidate
     */
    async _handleRemoteIceCandidate(candidate) {
        if (!this.peerConnection) {
            this._log('warn', '收到 ICE candidate 但没有 PeerConnection');
            return;
        }
        
        try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            this._log('debug', '已添加远端 ICE candidate');
        } catch (err) {
            this._log('error', '添加 ICE candidate 失败:', err);
        }
    }
    
    /**
     * 发送消息到服务器
     */
    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this._log('warn', '无法发送消息：WebSocket 未连接');
        }
    }
    
    /**
     * 启动心跳
     */
    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this._send({ type: 'ping' });
        }, this.heartbeatTimeout);
    }
    
    /**
     * 停止心跳
     */
    _stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    /**
     * 安排重连
     */
    _scheduleReconnect() {
        this._cancelReconnect();
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        this._log('info', `将在 ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)`);
        
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(err => {
                this._log('error', '重连失败:', err);
            });
        }, delay);
    }
    
    /**
     * 取消重连
     */
    _cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    
    /**
     * 设置音频输出元素
     */
    setAudioElement(element) {
        this.audioElement = element;
        
        // 如果已有远端流，立即设置
        if (this.remoteStream && element) {
            element.srcObject = this.remoteStream;
        }
    }
    
    /**
     * 获取当前状态
     */
    getState() {
        return this.state;
    }
    
    /**
     * 是否已连接
     */
    isConnected() {
        return this.state === ConnectionState.CONNECTED;
    }
    
    /**
     * 获取统计信息
     */
    async getStats() {
        if (!this.peerConnection) {
            return null;
        }
        
        try {
            const stats = await this.peerConnection.getStats();
            const result = {
                audio: null,
                connection: null
            };
            
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                    result.audio = {
                        bytesReceived: report.bytesReceived,
                        packetsReceived: report.packetsReceived,
                        packetsLost: report.packetsLost || 0,
                        jitter: report.jitter
                    };
                } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    result.connection = {
                        localCandidateType: report.localCandidateType,
                        remoteCandidateType: report.remoteCandidateType,
                        roundTripTime: report.currentRoundTripTime
                    };
                }
            });
            
            return result;
        } catch (err) {
            this._log('error', '获取统计信息失败:', err);
            return null;
        }
    }
}

// ==================== 导出 ====================

// 单例实例
export const webrtcSignaling = new WebRTCSignaling();

// 导出类和常量
export { WebRTCSignaling, ConnectionState };
