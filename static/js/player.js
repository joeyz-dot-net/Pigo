// 播放器控制模块
import { api } from './api.js';
import { settingsManager } from './settingsManager.js';
import { operationLock } from './operationLock.js';
import { webrtcSignaling, ConnectionState } from './webrtc.js';

export class Player {
    constructor() {
        this.status = null;
        this.pollInterval = null;
        this.listeners = new Map();
        this.currentPlayingUrl = null;  // 追踪当前播放的歌曲URL
        this.pollingPaused = false;  // 轮询暂停标志
        
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
        
        // 注意：不再在播放歌曲时自动启动推流
        // 推流由用户通过设置面板中的"接收推流"开关手动控制
        
        return result;
    }
    
    // 启动浏览器推流（带详细的连接提示）
    // 优先使用 WebRTC，失败则降级到 HTTP 流
    async startBrowserStream(streamFormat = 'mp3') {
        // === 首先尝试 WebRTC ===
        try {
            const webrtcResult = await this.tryWebRTCStream();
            if (webrtcResult.success) {
                console.log('%c[推流] ✓ 使用 WebRTC 模式', 'color: #4CAF50; font-weight: bold');
                return webrtcResult;
            }
            console.log('[推流] WebRTC 不可用，降级到 HTTP 流');
        } catch (err) {
            console.warn('[推流] WebRTC 尝试失败:', err.message);
        }
        
        // === 降级到 HTTP 流 ===
        return this.startHTTPStream(streamFormat);
    }
    
    // 尝试 WebRTC 推流
    async tryWebRTCStream() {
        // 检查服务器是否支持 WebRTC
        try {
            const response = await fetch('/config/webrtc-enabled');
            const data = await response.json();
            
            if (!data.webrtc_enabled) {
                return { success: false, reason: 'server_disabled' };
            }
        } catch (err) {
            return { success: false, reason: 'check_failed', error: err };
        }
        
        // 获取音频元素
        const audioElement = document.getElementById('browserStreamAudio');
        if (!audioElement) {
            return { success: false, reason: 'no_audio_element' };
        }
        
        // 设置 WebRTC 信令回调
        webrtcSignaling.setAudioElement(audioElement);
        
        webrtcSignaling.onStateChange = (state) => {
            console.log(`[WebRTC] 状态变化: ${state}`);
            if (state === ConnectionState.CONNECTED) {
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('playing');
                }
                this.emit('stream:playing');
            } else if (state === ConnectionState.DISCONNECTED || state === ConnectionState.FAILED) {
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('closed');
                }
                this.emit('stream:ended');
            } else if (state === ConnectionState.CONNECTING) {
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
            }
        };
        
        webrtcSignaling.onAudioReady = (stream) => {
            console.log('[WebRTC] ✓ 音频流就绪');
            this.emit('stream:ready', { format: 'opus', mode: 'webrtc' });
        };
        
        webrtcSignaling.onError = (err) => {
            console.error('[WebRTC] 错误:', err);
            this.emit('stream:error', { error: err, errorMsg: err.message || 'WebRTC 错误' });
        };
        
        // 连接 WebRTC
        try {
            await webrtcSignaling.connect();
            
            // 设置音量
            const streamVolume = settingsManager.getStreamVolume();
            audioElement.volume = streamVolume / 100;
            
            return { success: true, mode: 'webrtc', format: 'opus' };
        } catch (err) {
            return { success: false, reason: 'connection_failed', error: err };
        }
    }
    
    // 启动 HTTP 流（原始实现，作为降级方案）
    async startHTTPStream(streamFormat = 'mp3') {
        const audioElement = document.getElementById('browserStreamAudio');
        
        if (!audioElement) {
            console.warn("[Stream] 浏览器推流元素不存在");
            return;
        }
        
        // 防护：如果音频元素有非流 URL，立即清理
        if (audioElement.src && !audioElement.src.includes('/stream/play')) {
            console.warn('[推流] ⚠️ 检测到非法的音频源，清理:', audioElement.src);
            audioElement.src = '';
            audioElement.load();
        }
        
        try {
            // === 浏览器检测 ===
            const userAgent = navigator.userAgent;
            const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
            const isChrome = /chrome|chromium|crios/i.test(userAgent);
            const isEdge = /edg/i.test(userAgent);
            const isFirefox = /firefox|fxios/i.test(userAgent);
            
            console.log(`%c[推流] 浏览器信息`, 'color: #4CAF50; font-weight: bold');
            console.log(`  User-Agent: ${userAgent.substring(0, 80)}...`);
            console.log(`  Safari: ${isSafari}, Chrome: ${isChrome}, Edge: ${isEdge}, Firefox: ${isFirefox}`);
            
            // === 关键：删除旧的 stream_client_id cookie，强制后端生成新ID ===
            // 这样可以避免重复使用已断开的客户端ID
            document.cookie = 'stream_client_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
            console.log('[推流] ✓ 已清除旧的客户端ID cookie，将强制生成新ID');
            
            // Safari 特殊处理：确保音频元素完全重置
            if (isSafari) {
                console.log('[推流] Safari 检测到，应用 Safari 特殊处理...');
                audioElement.pause();
                audioElement.currentTime = 0;
                await new Promise(resolve => setTimeout(resolve, 100));
                console.log('[推流] Safari 音频元素已重置，等待 100ms...');
            }
            
            const timestamp = Date.now();
            const url = `/stream/play?format=${streamFormat}&t=${timestamp}`;
            
            console.log(`%c[推流] 初始化参数`, 'color: #2196F3; font-weight: bold');
            console.log(`  格式: ${streamFormat}`);
            console.log(`  URL: ${url}`);
            console.log(`  时间戳: ${timestamp}`);
            
            // === 关键：彻底清理旧连接 ===
            console.log('[推流] 清理旧连接...');
            // 1. 暂停播放并重置
            if (!audioElement.paused) {
                audioElement.pause();
                console.log('[推流]   ✓ 已暂停旧播放');
            }
            audioElement.currentTime = 0;
            
            // 2. 清除旧的 src 并设置空源
            if (audioElement.src) {
                console.log(`[推流]   ✓ 清除旧 src: ${audioElement.src.substring(0, 60)}...`);
                audioElement.src = '';
                audioElement.load(); // 触发清理
            }
            
            // 3. 移除所有旧的事件监听器（防止事件重复触发）
            if (audioElement.parentNode) {
                const newAudioElement = audioElement.cloneNode(false);
                audioElement.parentNode.replaceChild(newAudioElement, audioElement);
                console.log('[推流]   ✓ 已克隆音频元素，移除所有旧事件监听器');
            } else {
                console.warn('[推流]   ⚠️ 音频元素已从 DOM 移除，跳过克隆操作');
            }
            const freshAudioElement = document.getElementById('browserStreamAudio');
            
            if (!freshAudioElement) {
                console.error("[Stream] ❌ 音频元素无法重新获取");
                return;
            }
            
            // === 配置新连接 ===
            freshAudioElement.crossOrigin = 'anonymous';
            freshAudioElement.preload = 'none';  // 改为 none，等待我们主动触发加载
            
            // ✅ 从设置中读取推流音量，仅改变浏览器音频音量
            const streamVolume = settingsManager.getStreamVolume();
            const volumeDecimal = streamVolume / 100;
            freshAudioElement.volume = volumeDecimal;
            console.log(`[推流] 音量: ${streamVolume}% (HTML5 audio.volume = ${volumeDecimal.toFixed(2)})`);
            
            freshAudioElement.autoplay = false;  // 禁用自动播放，由我们控制
            
            // 标记用于追踪播放状态
            let isPlayingStarted = false;
            let playRetryCount = 0;
            const maxRetries = 3;
            let canplayTriggered = false;
            
            // 检测浏览器支持的格式
            const mimeTypes = {
                'mp3': 'audio/mpeg',
                'aac': 'audio/aac',
                'aac-raw': 'audio/aac',
                'flac': 'audio/flac',
                'pcm': 'audio/wav',
                'opus': 'audio/opus',
                'vorbis': 'audio/ogg'
            };
            const testMimeType = mimeTypes[streamFormat] || 'audio/mpeg';
            const canPlayType = freshAudioElement.canPlayType(testMimeType);
            console.log(`[推流] 格式支持检测: ${streamFormat} (${testMimeType}): ${canPlayType || '不支持'}`);
            
            if (!canPlayType) {
                console.warn(`[推流] ⚠️ 浏览器可能不支持 ${streamFormat}，继续尝试...`);
            }
            
            // 重试播放的函数
            const attemptPlay = () => {
                if (isPlayingStarted) return; // 已经开始播放，不再重试
                
                freshAudioElement.play().then(() => {
                    isPlayingStarted = true;
                    console.log(`[推流] ✓ 推流已启动 (第 ${playRetryCount + 1} 次尝试成功)`);
                }).catch(err => {
                    playRetryCount++;
                    console.warn(`[推流] ⚠️ 播放失败 (${playRetryCount}/${maxRetries}): ${err.message}`);
                    
                    // 如果是被暂停打断，等待 100ms 后重试
                    if (err.message.includes('interrupted') && playRetryCount < maxRetries) {
                        setTimeout(attemptPlay, 100);
                    } else if (playRetryCount >= maxRetries) {
                        console.error(`[推流] ❌ 播放失败（超过重试次数）:`, err);
                        this.emit('stream:error', { error: err, errorMsg: '播放启动失败' });
                    }
                });
            };
            
            // 设置新源和 MIME 类型
            const mimeType = testMimeType;
            console.log(`[推流] 设置 MIME 类型: ${mimeType}`);
            
            freshAudioElement.src = url;
            
            // 正在加载元数据
            freshAudioElement.onloadedmetadata = () => {
                console.log(`[推流] ✓ 元数据已加载 (时长: ${freshAudioElement.duration}s)`);
            };
            
            // 开始加载流
            freshAudioElement.onloadstart = () => {
                console.log(`[推流] 🔄 开始加载音频流...`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
                this.emit('stream:loadstart');
            };
            
            // 正在缓冲
            freshAudioElement.onprogress = () => {
                const buffered = freshAudioElement.buffered;
                if (buffered.length > 0) {
                    const bufferedEnd = buffered.end(buffered.length - 1);
                    const duration = freshAudioElement.duration;
                    if (duration > 0) {
                        const percent = Math.round((bufferedEnd / duration) * 100);
                        // 缓冲进度（不输出日志，减少控制台噪音）
                    }
                }
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
                this.emit('stream:buffering');
            };
            
            // 缓冲足够可以播放
            freshAudioElement.oncanplay = () => {
                if (canplayTriggered) return;  // 避免重复
                canplayTriggered = true;
                
                console.log(`[推流] ✓ 缓冲足够，准备播放`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
                this.emit('stream:ready', { format: streamFormat });
                
                // 在 canplay 时立即尝试播放（比 load 之后的延迟更可靠）
                if (!isPlayingStarted) {
                    attemptPlay();
                }
            };
            
            // 播放中
            freshAudioElement.onplay = () => {
                console.log(`[推流] ▶️ 播放开始`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('playing');
                }
                this.emit('stream:playing');
            };
            
            // 正在播放中
            freshAudioElement.onplaying = () => {
                console.log(`[推流] 🎵 正在播放中...`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('playing');
                }
            };
            
            // 播放错误（关键）
            freshAudioElement.onerror = (e) => {
                const errorCode = freshAudioElement.error?.code;
                const errorMsg = {
                    1: 'MEDIA_ERR_ABORTED - 播放被中止',
                    2: 'MEDIA_ERR_NETWORK - 网络错误',
                    3: 'MEDIA_ERR_DECODE - 解码错误',
                    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - 不支持的格式'
                }[errorCode] || `未知错误 (${errorCode})`;
                
                // 所有错误都标记为关闭，禁用自动重连
                // 用户需要手动点击推流指示器来恢复推流
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('closed');
                }
                
                // 静默处理格式不支持错误（code=4），不显示 toast 提示
                if (errorCode === 4) {
                    console.warn(`[推流] ⚠️ 浏览器不支持此流格式，已自动切换`);
                    console.warn(`[推流] 诊断信息:`);
                    console.warn(`  - 浏览器支持检测: ${canPlayType}`);
                    console.warn(`  - 请求格式: ${streamFormat}`);
                    console.warn(`  - MIME 类型: ${testMimeType}`);
                    console.warn(`  - 源 URL: ${freshAudioElement.src}`);
                    // 只发送 stream:error 事件给内部处理，不显示用户提示
                    this.emit('stream:error', { error: e, errorMsg: errorMsg, silent: true });
                    return;
                }
                
                // 其他错误正常处理
                console.error(`[推流] ❌ 播放错误:`, {
                    code: errorCode,
                    message: errorMsg,
                    src: freshAudioElement.src,
                    mimeType: testMimeType,
                    canPlayType: canPlayType,
                    element: freshAudioElement
                });
                
                this.emit('stream:error', { error: e, errorMsg: errorMsg });
            };
            
            // 播放暂停
            freshAudioElement.onpause = () => {
                console.log(`[推流] ⏸ 播放已暂停`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('paused');
                }
                this.emit('stream:paused');
            };
            
            // 播放结束
            freshAudioElement.onended = () => {
                console.log(`[推流] ✓ 播放结束`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('closed');
                }
                this.emit('stream:ended');
            };
            
            // 音频卡顿（关键：检测客户端被服务器断开）
            freshAudioElement.onstalled = () => {
                console.log(`[推流] ⏸ 数据加载已停滞`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
                // 检测是否是流断开导致的 stalled
                setTimeout(() => {
                    if (freshAudioElement.readyState < 2) {  // HAVE_CURRENT_DATA
                        console.warn(`[推流] ⚠️ 长时间无数据，可能流已断开`);
                        if (window.settingsManager) {
                            window.settingsManager.updateStreamStatusIndicator('closed');
                        }
                    }
                }, 5000);  // 5秒后仍无数据则认为断开
            };
            
            // 音频流断开或挂起（关键：检测客户端被服务器断开）
            freshAudioElement.onsuspend = () => {
                console.log(`[推流] ⏸ 数据加载已挂起`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
                // 检查是否是真的断开
                setTimeout(() => {
                    if (freshAudioElement.readyState === 0 || freshAudioElement.networkState === 3) {
                        console.warn(`[推流] ⚠️ 流已断开，更新指示器`);
                        if (window.settingsManager) {
                            window.settingsManager.updateStreamStatusIndicator('closed');
                        }
                    }
                }, 2000);  // 2秒后检查
                
                this.emit('stream:suspend');
            };
            
            // 开始寻求位置
            freshAudioElement.onseeking = () => {
                console.log(`[推流] 🔍 正在查找...`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
            };
            
            // 完成寻求位置
            freshAudioElement.onseeked = () => {
                console.log(`[推流] ✓ 查找完成`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('playing');
                }
            };
            
            // 等待数据
            freshAudioElement.onwaiting = () => {
                console.log(`[推流] ⏳ 正在等待更多数据...`);
                if (window.settingsManager) {
                    window.settingsManager.updateStreamStatusIndicator('buffering');
                }
            };
            
            // === 启动加载 ===
            // 注意：src已在第142行设置，这里直接触发加载
            freshAudioElement.load();  // 显式触发加载
            
            console.log(`[推流] 已发送加载命令，等待缓冲足够...`);
            
            // Safari 特殊处理：立即尝试播放，而不是等待 canplay 事件
            if (isSafari) {
                await new Promise(resolve => setTimeout(resolve, 150));
                console.log(`[推流] Safari 模式：立即尝试播放`);
                attemptPlay();
            }
            
            // 备用启动（如果 canplay 没有在 5 秒内触发）
            const backupTimeout = setTimeout(() => {
                if (!isPlayingStarted && !canplayTriggered) {
                    console.log(`[推流] ℹ️ 缓冲等待超时，尝试直接启动播放（备用方案）`);
                    attemptPlay();
                }
            }, 5000);
            
            // 如果播放成功启动，清除备用超时
            const originalEmit = this.emit.bind(this);
            const removeBackupTimeout = () => {
                clearTimeout(backupTimeout);
                this.emit = originalEmit;
            };
            this.emit = (event, ...args) => {
                if (event === 'stream:playing' || event === 'stream:error') {
                    removeBackupTimeout();
                }
                return originalEmit(event, ...args);
            };
            
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

    /**
     * 推流诊断函数 - 输出详细的推流调试信息
     */
    diagnoseStream() {
        console.log('%c🔍 推流诊断信息', 'color: #FF9800; font-size: 16px; font-weight: bold');
        
        const audioElement = document.getElementById('browserStreamAudio');
        
        // 1. 音频元素信息
        console.group('%c音频元素状态', 'color: #2196F3; font-weight: bold');
        if (audioElement) {
            console.log('元素存在: ✓');
            console.log('src:', audioElement.src || '(empty)');
            console.log('currentTime:', audioElement.currentTime);
            console.log('duration:', audioElement.duration);
            console.log('paused:', audioElement.paused);
            console.log('ended:', audioElement.ended);
            console.log('volume:', audioElement.volume);
            console.log('muted:', audioElement.muted);
            console.log('readyState:', audioElement.readyState, ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][audioElement.readyState]);
            console.log('networkState:', audioElement.networkState, ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE'][audioElement.networkState]);
            if (audioElement.error) {
                console.error('error code:', audioElement.error.code, ['MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'][audioElement.error.code - 1]);
                console.error('error message:', audioElement.error.message);
            } else {
                console.log('error: null (no error)');
            }
        } else {
            console.error('元素存在: ✗ (未找到 #browserStreamAudio)');
        }
        console.groupEnd();
        
        // 2. 浏览器信息
        console.group('%c浏览器环境', 'color: #4CAF50; font-weight: bold');
        const userAgent = navigator.userAgent;
        console.log('User-Agent:', userAgent.substring(0, 100) + '...');
        console.log('Safari:', /^((?!chrome|android).)*safari/i.test(userAgent));
        console.log('Chrome:', /chrome|chromium|crios/i.test(userAgent));
        console.log('Edge:', /edg/i.test(userAgent));
        console.log('Firefox:', /firefox|fxios/i.test(userAgent));
        console.groupEnd();
        
        // 3. 推流设置
        console.group('%c推流设置', 'color: #9C27B0; font-weight: bold');
        const streamActive = localStorage.getItem('streamActive');
        const streamFormat = localStorage.getItem('streamFormat');
        const currentStreamState = localStorage.getItem('currentStreamState');
        console.log('streamActive:', streamActive);
        console.log('streamFormat:', streamFormat);
        console.log('currentStreamState:', currentStreamState ? JSON.parse(currentStreamState) : 'null');
        
        const autoStreamSetting = document.getElementById('autoStreamSetting');
        if (autoStreamSetting) {
            console.log('接收推流开关:', autoStreamSetting.checked ? '✓ 启用' : '✗ 禁用');
        }
        console.groupEnd();
        
        // 4. Cookie 信息
        console.group('%cCookie 信息', 'color: #FF5722; font-weight: bold');
        const cookies = document.cookie.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            if (key) acc[key] = value || '(empty)';
            return acc;
        }, {});
        console.table(cookies);
        console.groupEnd();
        
        console.log('%c✓ 诊断完成', 'color: #4CAF50; font-weight: bold');
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
