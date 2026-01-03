// 播放器控制模块
import { api } from './api.js';
import { settingsManager } from './settingsManager.js';
import { operationLock } from './operationLock.js';
import { iosBackgroundAudio } from './iosBackgroundAudio.js';

export class Player {
    constructor() {
        this.status = null;
        this.pollInterval = null;
        this.listeners = new Map();
        this.currentPlayingUrl = null;  // 追踪当前播放的歌曲URL
        this.pollingPaused = false;  // 轮询暂停标志
        this.iosBackgroundInitialized = false;  // iOS 后台模块初始化标志
        
        // 注册操作锁回调
        operationLock.onPause(() => {
            this.pollingPaused = true;
            console.log('[Player] 轮询已被操作锁暂停');
        });
        operationLock.onResume(() => {
            this.pollingPaused = false;
            console.log('[Player] 轮询已被操作锁恢复');
        });
    }
    
    /**
     * 初始化 iOS 后台播放支持
     */
    initIOSBackgroundAudio() {
        if (this.iosBackgroundInitialized) return;
        
        iosBackgroundAudio.init({
            onStatusRefresh: async () => {
                // 页面恢复前台时强制刷新状态
                try {
                    const status = await api.getStatus();
                    this.updateStatus(status);
                } catch (err) {
                    console.warn('[Player] iOS后台恢复刷新失败:', err);
                }
            },
            onPlayPause: () => this.togglePlayPause(),
            onNext: () => this.next(),
            onPrev: () => this.prev()
        });
        
        this.iosBackgroundInitialized = true;
        console.log('[Player] iOS 后台音频支持已初始化');
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
        
        // 自动初始化 iOS 后台播放支持
        this.initIOSBackgroundAudio();
        
        this.pollInterval = setInterval(async () => {
            // 检查操作锁：如果有活跃的锁，跳过本次轮询
            if (this.pollingPaused || operationLock.isPollingPaused()) {
                console.log('[Player] 轮询被操作锁暂停，跳过本次更新');
                return;
            }
            
            try {
                const status = await api.getStatus();
                this.updateStatus(status);
            } catch (error) {
                console.error('状态轮询失败:', error);
            }
        }, interval);
        
        // 【关键修复】启动轮询监控防止意外暂停
        // 如果轮询被暂停但没有活跃的锁，说明有地方没有正确释放锁
        // 这会导致播放停止，所以需要强制恢复
        this.startPollingMonitor();
    }

    // 【新增】轮询监控：防止轮询被意外暂停
    startPollingMonitor() {
        if (this.monitorInterval) return;
        
        this.monitorInterval = setInterval(() => {
            // 检查是否轮询被暂停但没有活跃的锁
            if ((this.pollingPaused || operationLock.isPollingPaused()) && 
                !operationLock.hasActiveLocks()) {
                console.warn('[Player] ⚠️ 轮询被暂停但无活跃锁，这可能导致播放停止！');
                console.warn('[Player] 锁状态:', operationLock.getStatus());
                console.warn('[Player] 强制恢复轮询...');
                
                // 强制恢复轮询
                try {
                    operationLock.resumePolling();
                    this.pollingPaused = false;
                    console.log('[Player] ✓ 轮询已强制恢复');
                } catch (err) {
                    console.error('[Player] 恢复轮询失败:', err);
                }
            }
        }, 5000);  // 每5秒检查一次
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    updateStatus(status) {
        const oldStatus = this.status;
        this.status = status;
        this.emit('statusUpdate', { status, oldStatus });
        
        // 同步更新 iOS 后台 Media Session 显示
        if (this.iosBackgroundInitialized && status) {
            // 更新正在播放的歌曲信息
            if (status.current_meta) {
                iosBackgroundAudio.updateNowPlaying({
                    title: status.current_meta.title || status.current_meta.name || '未知歌曲',
                    artist: status.current_meta.artist || 'ClubMusic',
                    album: status.current_playlist_name || '',
                    artwork: status.current_meta.thumbnail_url || status.thumbnail_url
                });
            }
            
            // 更新播放状态
            const isPlaying = status.mpv_state?.paused === false || status.mpv?.paused === false;
            iosBackgroundAudio.setPlaybackState(isPlaying);
        }
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
