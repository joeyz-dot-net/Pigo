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
    async play(url, title, type = 'local') {
        const result = await api.play(url, title, type);
        
        // 记录当前播放的URL
        this.currentPlayingUrl = url;
        
        this.emit('play', { url, title, type });
        
        return result;
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
