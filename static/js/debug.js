// 调试面板模块
import { themeManager } from './themeManager.js';

export class Debug {
    constructor() {
        this.debugLogHistory = [];
        this.logEnabled = localStorage.getItem('debugLogEnabled') !== 'false'; // 默认启用
        this.elements = {
            debugBtn: document.getElementById('debugBtn'),
            debugModal: document.getElementById('debugModal'),
            debugModalClose: document.getElementById('debugModalClose'),
            debugRefresh: document.getElementById('debugRefresh'),
            debugClearLogs: document.getElementById('debugClearLogs'),
            debugPlayer: document.getElementById('debugPlayer'),
            debugPlaylist: document.getElementById('debugPlaylist'),
            debugStorage: document.getElementById('debugStorage'),
            debugLogs: document.getElementById('debugLogs'),
            themeDarkBtn: document.getElementById('themeDarkBtn'),
            themeLightBtn: document.getElementById('themeLightBtn'),
            startStreamBtn: document.getElementById('startStreamBtn'),
            stopStreamBtn: document.getElementById('stopStreamBtn'),
            streamStatusDisplay: document.getElementById('streamStatusDisplay'),
            streamStatusText: document.getElementById('streamStatusText'),
            logToggle: document.getElementById('logToggle'),
            streamSpeed: document.getElementById('streamSpeed'),
            streamTotal: document.getElementById('streamTotal'),
            streamDuration: document.getElementById('streamDuration'),
            streamClients: document.getElementById('streamClients'),
            streamFormat: document.getElementById('streamFormat')
        };
        this.themeManager = themeManager;
        this.isStreaming = false;
    }

    // 初始化调试面板
    init(player, playlistManager) {
        this.player = player;
        this.updateThemeButtons();
        this.playlistManager = playlistManager;
        this.setupConsoleCapture();
        this.setupEventListeners();
        
        // 启动推流统计轮询（每1秒更新一次）
        this.startStreamStatsPolling();
    }
    
    // 启动推流统计轮询
    startStreamStatsPolling() {
        // 清除旧的轮询
        if (this.streamStatsInterval) {
            clearInterval(this.streamStatsInterval);
        }
        
        // 每1秒更新一次推流统计
        this.streamStatsInterval = setInterval(() => {
            this.updateStreamStats();
        }, 1000);
    }
    
    // 停止推流统计轮询
    stopStreamStatsPolling() {
        if (this.streamStatsInterval) {
            clearInterval(this.streamStatsInterval);
            this.streamStatsInterval = null;
        }
    }

    // 捕获console日志
    setupConsoleCapture() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        const addLog = (type, args) => {
            // 检查日志开关是否启用
            if (!this.logEnabled) {
                return;
            }

            const timestamp = new Date().toLocaleTimeString();
            const message = Array.from(args).map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.debugLogHistory.push({ timestamp, type, message });

            // 只保留最近100条日志
            if (this.debugLogHistory.length > 100) {
                this.debugLogHistory.shift();
            }
        };

        console.log = function(...args) {
            originalLog.apply(console, args);
            addLog('LOG', args);
        };

        console.error = function(...args) {
            originalError.apply(console, args);
            addLog('ERROR', args);
        };

        console.warn = function(...args) {
            originalWarn.apply(console, args);
            addLog('WARN', args);
        };
    }

    // 设置事件监听器
    setupEventListeners() {
        // 调试按钮点击 - 使用事件委托，因为按钮现在在设置面板内
        document.addEventListener('click', (e) => {
            if (e.target.id === 'debugBtn' || e.target.closest('#debugBtn')) {
                this.show();
            }
        });

        // 关闭调试面板
        if (this.elements.debugModalClose) {
            this.elements.debugModalClose.addEventListener('click', () => {
                this.hide();
            });
        }

        // 点击背景关闭
        if (this.elements.debugModal) {
            this.elements.debugModal.addEventListener('click', (e) => {
                if (e.target === this.elements.debugModal) {
                    this.hide();
                }
            });
        }

        // 推流控制按钮
        if (this.elements.startStreamBtn) {
            this.elements.startStreamBtn.addEventListener('click', () => {
                this.startBrowserStream();
            });
        }
        if (this.elements.stopStreamBtn) {
            this.elements.stopStreamBtn.addEventListener('click', () => {
                this.stopBrowserStream();
            });
        }

        // 主题切换按钮
        if (this.elements.themeDarkBtn) {
            this.elements.themeDarkBtn.addEventListener('click', () => {
                this.setTheme('dark');
            });
        }
        if (this.elements.themeLightBtn) {
            this.elements.themeLightBtn.addEventListener('click', () => {
                this.setTheme('light');
            });
        }

        // 刷新调试信息
        if (this.elements.debugRefresh) {
            this.elements.debugRefresh.addEventListener('click', () => {
                this.updateInfo();
            });
        }

        // 清空日志
        if (this.elements.debugClearLogs) {
            this.elements.debugClearLogs.addEventListener('click', () => {
                this.clearLogs();
            });
        }

        // 日志开关
        if (this.elements.logToggle) {
            // 初始化复选框状态
            this.elements.logToggle.checked = this.logEnabled;
            
            this.elements.logToggle.addEventListener('change', (e) => {
                this.logEnabled = e.target.checked;
                localStorage.setItem('debugLogEnabled', this.logEnabled);
                console.log(`[日志] 控制台日志已${this.logEnabled ? '启用' : '禁用'}`);
            });
        }
    }

    // 显示调试面板
    show() {
        if (this.elements.debugModal) {
            this.elements.debugModal.style.display = 'block';
            this.updateInfo();
        }
    }

    // 隐藏调试面板
    hide() {
        if (this.elements.debugModal) {
            this.elements.debugModal.style.display = 'none';
        }
    }

    // 更新调试信息
    updateInfo() {
        this.updatePlayerInfo();
        this.updatePlaylistInfo();
        this.updateStorageInfo();
        this.updateStreamStats();
        this.updateLogs();
    }

    // 更新播放器信息
    updatePlayerInfo() {
        const playerStatus = this.player.getStatus();
        if (this.elements.debugPlayer) {
            const timestamp = new Date().toLocaleTimeString();
            const logsHtml = Object.entries(playerStatus || {}).map(([key, value]) => {
                const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                return `<div style="color: #51cf66;">[${timestamp}] ${key}: ${valueStr}</div>`;
            }).join('');
            this.elements.debugPlayer.innerHTML = logsHtml || '<div style="color: #888;">暂无数据</div>';
        }
    }

    // 更新歌单信息
    updatePlaylistInfo() {
        const playlistInfo = {
            currentPlaylistName: this.playlistManager.getCurrentName(),
            playlistCount: this.playlistManager.getCurrent().length,
            allPlaylists: this.playlistManager.getAll().map(p => ({
                id: p.id,
                name: p.name,
                songCount: p.songs?.length || 0
            }))
        };
        if (this.elements.debugPlaylist) {
            const timestamp = new Date().toLocaleTimeString();
            const logsHtml = Object.entries(playlistInfo || {}).map(([key, value]) => {
                const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                return `<div style="color: #51cf66;">[${timestamp}] ${key}: ${valueStr}</div>`;
            }).join('');
            this.elements.debugPlaylist.innerHTML = logsHtml || '<div style="color: #888;">暂无数据</div>';
        }
    }

    // 更新本地存储信息
    updateStorageInfo() {
        const storageInfo = {
            localStorage: Object.keys(localStorage).reduce((obj, key) => {
                obj[key] = localStorage.getItem(key);
                return obj;
            }, {}),
            sessionStorage: Object.keys(sessionStorage).reduce((obj, key) => {
                obj[key] = sessionStorage.getItem(key);
                return obj;
            }, {})
        };
        if (this.elements.debugStorage) {
            const timestamp = new Date().toLocaleTimeString();
            const logsHtml = Object.entries(storageInfo || {}).map(([key, value]) => {
                const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                return `<div style="color: #51cf66;">[${timestamp}] ${key}: ${valueStr}</div>`;
            }).join('');
            this.elements.debugStorage.innerHTML = logsHtml || '<div style="color: #888;">暂无数据</div>';
        }
    }

    // 更新日志显示
    updateLogs() {
        if (this.elements.debugLogs) {
            const logsHtml = this.debugLogHistory.map(log =>
                `<div style="color: ${this.getLogColor(log.type)};">[${log.timestamp}] ${log.type}: ${log.message}</div>`
            ).join('');
            this.elements.debugLogs.innerHTML = logsHtml || '<div style="color: #888;">暂无日志</div>';
            // 自动滚到底部
            this.elements.debugLogs.scrollTop = this.elements.debugLogs.scrollHeight;
        }
    }

    // 更新推流统计信息
    async updateStreamStats() {
        try {
            const response = await fetch('/webrtc/status');
            const result = await response.json();
            
            // 处理响应数据
            const data = result.data || result || {};
            
            // WebRTC 状态：有活跃客户端即视为激活
            const isActive = (data.active_clients || 0) > 0;
            
            // 更新设备信息
            if (this.elements.streamSpeed) {
                const device = data.audio_device || '--';
                this.elements.streamSpeed.textContent = `设备: ${device}`;
            }
            
            // 更新 Offer 处理数
            if (this.elements.streamTotal) {
                const offers = data.total_offers_processed || 0;
                this.elements.streamTotal.textContent = `已处理Offer: ${offers}`;
            }
            
            // 更新 Answer 发送数
            if (this.elements.streamDuration) {
                const answers = data.total_answers_sent || 0;
                this.elements.streamDuration.textContent = `已发送Answer: ${answers}`;
            }
            
            // 更新活跃客户端
            if (this.elements.streamClients) {
                const clients = data.active_clients || 0;
                this.elements.streamClients.textContent = `活跃客户端: ${clients}`;
                // 根据实际连接数更新推流状态指示器
                this.updateStreamStatus(isActive);
            }
            
            // 更新峰值连接
            if (this.elements.streamFormat) {
                const peak = data.peak_concurrent || 0;
                this.elements.streamFormat.textContent = `峰值连接: ${peak}`;
            }
        } catch (err) {
            console.error('[调试] 获取推流统计失败:', err);
            // 显示离线状态
            if (this.elements.streamSpeed) {
                this.elements.streamSpeed.textContent = `设备: --`;
            }
            if (this.elements.streamTotal) {
                this.elements.streamTotal.textContent = `已处理Offer: --`;
            }
            if (this.elements.streamDuration) {
                this.elements.streamDuration.textContent = `已发送Answer: --`;
            }
            if (this.elements.streamClients) {
                this.elements.streamClients.textContent = `活跃客户端: --`;
            }
            if (this.elements.streamFormat) {
                this.elements.streamFormat.textContent = `峰值连接: --`;
            }
        }
    }

    // 获取日志颜色
    getLogColor(type) {
        switch (type) {
            case 'ERROR':
                return '#ff6b6b';
            case 'WARN':
                return '#ffd93d';
            case 'LOG':
            default:
                return '#51cf66';
        }
    }

    // 清空日志
    clearLogs() {
        this.debugLogHistory = [];
        this.updateLogs();
    }

    // 设置主题
    async setTheme(theme) {
        try {
            await this.themeManager.switchTheme(theme);
            this.updateThemeButtons();
            console.log(`[主题切换] 已切换到${theme === 'dark' ? '暗色' : '亮色'}主题`);
        } catch (err) {
            console.error(`[主题切换] 切换失败:`, err);
        }
    }

    // 更新主题按钮状态
    updateThemeButtons() {
        const currentTheme = this.themeManager.getCurrentTheme();
        if (this.elements.themeDarkBtn && this.elements.themeLightBtn) {
            if (currentTheme === 'dark') {
                this.elements.themeDarkBtn.style.borderColor = '#667eea';
                this.elements.themeDarkBtn.style.fontWeight = 'bold';
                this.elements.themeLightBtn.style.borderColor = '#999';
                this.elements.themeLightBtn.style.fontWeight = 'normal';
            } else {
                this.elements.themeDarkBtn.style.borderColor = '#999';
                this.elements.themeDarkBtn.style.fontWeight = 'normal';
                this.elements.themeLightBtn.style.borderColor = '#667eea';
                this.elements.themeLightBtn.style.fontWeight = 'bold';
            }
        }
    }

    // 开启浏览器推流
    startBrowserStream() {
        if (this.isStreaming) {
            console.log('[推流] 推流已在运行中');
            return;
        }
        
        const streamFormat = 'mp3';  // 默认格式 mp3
        console.log(`[推流] 手动开启推流 (格式: ${streamFormat})`);
        
        // 调用 player 的推流方法
        if (this.player && typeof this.player.startBrowserStream === 'function') {
            this.isStreaming = true;
            
            // 绑定推流事件以更新状态
            this.player.on('stream:connecting', () => {
                console.log('[推流] 正在连接...');
            });
            
            this.player.on('stream:ready', () => {
                console.log('[推流] 推流已就绪');
                this.updateStreamStatus(true);
            });
            
            this.player.on('stream:playing', () => {
                console.log('[推流] 推流播放中');
                this.updateStreamStatus(true);
            });
            
            this.player.on('stream:error', (data) => {
                console.error('[推流] 推流错误:', data.errorMsg);
                this.updateStreamStatus(false);
                this.isStreaming = false;
            });
            
            // 启动推流
            this.player.startBrowserStream(streamFormat);
            this.updateStreamStatus(true);
        }
    }

    // 停止浏览器推流
    stopBrowserStream() {
        const audioElement = document.getElementById('browserStreamAudio');
        if (audioElement && !audioElement.paused) {
            audioElement.pause();
            audioElement.currentTime = 0;
            audioElement.src = '';
            console.log('[推流] 已停止推流');
            this.isStreaming = false;
            this.updateStreamStatus(false);
        }
    }

    // 更新推流状态指示器
    updateStreamStatus(isActive) {
        if (this.elements.streamStatusDisplay && this.elements.streamStatusText) {
            if (isActive) {
                this.elements.streamStatusDisplay.textContent = '●';
                this.elements.streamStatusDisplay.style.color = '#4CAF50';
                this.elements.streamStatusText.textContent = '激活中';
                this.elements.streamStatusText.style.color = '#4CAF50';
            } else {
                this.elements.streamStatusDisplay.textContent = '●';
                this.elements.streamStatusDisplay.style.color = '#f44336';
                this.elements.streamStatusText.textContent = '未激活';
                this.elements.streamStatusText.style.color = '#f44336';
            }
        }
    }
}

// 导出单例
export const debug = new Debug();
