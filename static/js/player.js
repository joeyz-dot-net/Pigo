// 播放器控制模块
import { api } from './api.js';

export class Player {
    constructor() {
        this.status = null;
        this.pollInterval = null;
        this.listeners = new Map();
        this.currentPlayingUrl = null;  // 追踪当前播放的歌曲URL
    }

    // 事件监听
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => cb(data));
    }

    // 播放控制
    async play(url, title, type = 'local', streamFormat = 'mp3') {
        const result = await api.play(url, title, type, streamFormat);
        
        // 记录当前播放的URL
        this.currentPlayingUrl = url;
        
        this.emit('play', { url, title, type });
        
        // 检查是否启用了接收推流，如果启用则自动播放推流
        if (typeof window.app !== 'undefined' && window.app.settingsManager) {
            window.app.settingsManager.checkAndStartAutoStream(streamFormat);
        }
        
        return result;
    }
    
    // 启动浏览器推流（带详细的连接提示）
    startBrowserStream(streamFormat = 'mp3') {
        const audioElement = document.getElementById('browserStreamAudio');
        
        if (!audioElement) {
            console.warn("[Stream] 浏览器推流元素不存在");
            return;
        }
        
        try {
            const timestamp = Date.now();
            const url = `/stream/play?format=${streamFormat}&t=${timestamp}`;
            
            console.log(`[推流] 设置音频源: ${url}`);
            
            // === 关键：彻底清理旧连接 ===
            // 1. 暂停播放并重置
            if (!audioElement.paused) {
                audioElement.pause();
            }
            audioElement.currentTime = 0;
            
            // 2. 清除旧的 src 并设置空源
            if (audioElement.src) {
                audioElement.src = '';
                audioElement.load(); // 触发清理
            }
            
            // 3. 移除所有旧的事件监听器（防止事件重复触发）
            const newAudioElement = audioElement.cloneNode(false);
            audioElement.parentNode.replaceChild(newAudioElement, audioElement);
            const freshAudioElement = document.getElementById('browserStreamAudio');
            
            if (!freshAudioElement) {
                console.warn("[Stream] 音频元素无法重新获取");
                return;
            }
            
            // === 配置新连接 ===
            freshAudioElement.crossOrigin = 'anonymous';
            freshAudioElement.preload = 'auto';
            freshAudioElement.volume = 1.0;
            
            // 设置新源
            freshAudioElement.src = url;
            
            // 连接开始
            freshAudioElement.onloadstart = () => {
                console.log(`[推流] ✓ 开始连接 (格式: ${streamFormat})`);
                this.emit('stream:connecting', { format: streamFormat });
            };
            
            // 正在加载元数据
            freshAudioElement.onloadedmetadata = () => {
                console.log(`[推流] ✓ 元数据已加载`);
            };
            
            // 正在缓冲
            freshAudioElement.onprogress = () => {
                console.log(`[推流] 正在缓冲数据...`);
                this.emit('stream:buffering');
            };
            
            // 缓冲足够可以播放
            freshAudioElement.oncanplay = () => {
                console.log(`[推流] ✓ 缓冲足够，开始播放`);
                this.emit('stream:ready', { format: streamFormat });
            };
            
            // 播放中
            freshAudioElement.onplay = () => {
                console.log(`[推流] 🎵 音乐已开始播放`);
                this.emit('stream:playing');
            };
            
            // 正在播放中
            freshAudioElement.onplaying = () => {
                console.log(`[推流] 🎵 正在播放中...`);
            };
            
            // 播放错误
            freshAudioElement.onerror = (e) => {
                const errorType = freshAudioElement.error?.code;
                const errorMsg = {
                    1: 'MEDIA_ERR_ABORTED',
                    2: 'MEDIA_ERR_NETWORK',
                    3: 'MEDIA_ERR_DECODE',
                    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                }[errorType] || '未知错误';
                console.error(`[推流] ❌ 播放错误 (${errorMsg}):`, e);
                this.emit('stream:error', { error: e, errorMsg });
            };
            
            // 播放暂停
            freshAudioElement.onpause = () => {
                console.log(`[推流] ⏸ 已暂停`);
                this.emit('stream:paused');
            };
            
            // 触发加载
            freshAudioElement.load();
            
            // 延迟播放以确保连接建立
            setTimeout(() => {
                freshAudioElement.play().then(() => {
                    console.log(`[推流] ✓ 推流已启动`);
                }).catch(err => {
                    console.error(`[推流] ❌ 播放失败:`, err.message);
                    this.emit('stream:error', { error: err });
                });
            }, 100);
            
        } catch (err) {
            console.error("[Stream] ❌ 启动失败:", err);
            this.emit('stream:error', { error: err });
        }
    }

    async pause() {
        const result = await api.pause();
        this.emit('pause');
        return result;
    }

    async next() {
        const result = await api.next();
        this.emit('next');
        return result;
    }

    async prev() {
        const result = await api.prev();
        this.emit('prev');
        return result;
    }

    async togglePlayPause() {
        // 后端 /pause 已是切换语义
        const result = await api.pause();
        // 尽力刷新状态，避免UI卡住
        try {
            const status = await api.getStatus();
            this.updateStatus(status);
        } catch (err) {
            console.warn('刷新状态失败:', err);
        }
        this.emit(result?.paused ? 'pause' : 'play');
        return result;
    }

    // 音量控制
    async setVolume(value) {
        const result = await api.setVolume(value);
        this.emit('volumeChange', value);
        return result;
    }

    // 进度控制
    async seek(percent) {
        const result = await api.seek(percent);
        this.emit('seek', percent);
        return result;
    }

    // 循环模式
    async cycleLoop() {
        const result = await api.loop();
        const loopMode = result.loop_mode !== undefined ? result.loop_mode : result;
        this.emit('loopChange', loopMode);
        return result;
    }

    // 状态轮询
    startPolling(interval = 5000) {
        if (this.pollInterval) return;
        
        this.pollInterval = setInterval(async () => {
            try {
                const status = await api.getStatus();
                this.updateStatus(status);
            } catch (error) {
                console.error('状态轮询失败:', error);
            }
        }, interval);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    updateStatus(status) {
        const oldStatus = this.status;
        this.status = status;
        this.emit('statusUpdate', { status, oldStatus });
    }

    // 获取当前状态
    getStatus() {
        return this.status;
    }

    // 判断是否正在播放
    isPlaying() {
        return this.status?.mpv?.paused === false;
    }
}

// 导出单例
export const player = new Player();
