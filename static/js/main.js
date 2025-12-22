// 模块化主入口示例
// 这是一个使用新模块系统的示例文件

import { api } from './api.js';
import { player } from './player.js';
import { playlistManager, renderPlaylistUI } from './playlist.js';
import { playlistsManagement } from './playlists-management.js';
import { volumeControl } from './volume.js';
import { searchManager } from './search.js';
import { rankingManager } from './ranking.js';
import { themeManager } from './themeManager.js';
import { debug } from './debug.js';
import { Toast, loading, formatTime } from './ui.js';
import { isMobile } from './utils.js';
import { localFiles } from './local.js';
import { settingsManager } from './settingsManager.js';
import { navManager } from './navManager.js';
import { i18n } from './i18n.js';
import { streamManager } from './stream.js'; // 【新增】推流格式管理器

// ==========================================
// 应用初始化
// ==========================================

class MusicPlayerApp {
    constructor() {
        this.initialized = false;
        this.currentPlaylistId = 'default';  // 跟踪当前选择的歌单ID
        this._autoNextTriggered = false;  // 自动播放下一首的标记
        this.lastPlayStatus = null;  // 追踪上一次的播放状态，用于检测播放停止
        this.isRestoringStream = false;  // 标记是否正在恢复流，避免竞态
        
        // 状态追踪变量 - 用于只在改变时输出日志
        this.lastLoopMode = null;  // 循环模式
        this.lastVolume = null;    // 音量
        this.lastPlaybackStatus = null;  // 播放状态
        this.lastUILoopMode = null;  // UI更新中的循环模式跟踪，防止重复日志
        this.lastThumbnailUrl = null;  // 缩略图URL追踪
        
        // ✅ playlistManager 会在 constructor 中自动从 localStorage 恢复选择歌单
    }

    async init() {
        if (this.initialized) return;
        
        console.log('🎵 初始化音乐播放器...');
        
        try {
            // 0. 保护浏览器音频元素，防止非法 URL 被设置
            this.protectBrowserStreamAudio();
            
            // 0.1 清理旧的 localStorage 数据（迁移支持）
            try {
                const savedStreamState = localStorage.getItem('currentStreamState');
                if (savedStreamState) {
                    const streamState = JSON.parse(savedStreamState);
                    // 如果有旧的 url 或 title 字段，说明是旧格式，清理掉
                    if (streamState.url || streamState.title) {
                        console.log('[初始化] 检测到旧的推流状态格式，清理...');
                        localStorage.removeItem('currentStreamState');
                        localStorage.setItem('streamActive', 'false');
                    }
                }
            } catch (err) {
                console.warn('[初始化] 清理旧数据失败:', err);
            }
            
            // 0.1 初始化多语言系统
            i18n.init();
            
            // 0.2 从后端获取推流配置
            try {
                const configResp = await fetch('/config/stream');
                const configData = await configResp.json();
                if (configData.status === 'OK' && configData.data?.default_format) {
                    const defaultFormat = configData.data.default_format;
                    localStorage.setItem('streamFormat', defaultFormat);
                    console.log(`[配置] 推流默认格式: ${defaultFormat}`);
                }
            } catch (err) {
                console.warn('[配置] 获取推流配置失败:', err);
            }
            
            // 1. 初始化 UI 元素
            this.initUIElements();
            
            // 1.5 [关键] 页面刷新后快速恢复流连接（不等待其他初始化）
            this.fastRestoreStream();
            
            // 2. 初始化播放器
            this.initPlayer();
            
            // 3. 初始化音量控制
            this.initVolumeControl();
            
            // 4. 初始化播放列表
            await this.initPlaylist();
            
            // 4.5 初始化本地歌曲
            await localFiles.init({
                treeEl: this.elements.tree,
                getCurrentPlaylistId: () => this.currentPlaylistId,
                // ✅ 添加成功后的回调：返回到选择的歌单（仅刷新显示，不改变选择）
                onSongAdded: async () => {
                    console.log('[本地文件] 歌曲已添加，返回到选择的歌单');
                    await this.renderPlaylist();
                    
                    // 显示歌单区域
                    const navItems = document.querySelectorAll('.nav-item');
                    const playlistsNavItem = Array.from(navItems).find(item => item.getAttribute('data-tab') === 'playlists');
                    if (playlistsNavItem && !playlistsNavItem.classList.contains('active')) {
                        playlistsNavItem.classList.add('active');
                    }
                    const playlistEl = document.getElementById('playlist');
                    if (playlistEl) {
                        playlistEl.style.display = 'flex';
                    }
                }
            });
            
            // 5. 绑定事件监听器
            this.bindEventListeners();
            
            // 5.5 恢复 Mini 播放器折叠状态
            if (this.elements.miniPlayer) {
                const isCollapsed = localStorage.getItem('miniPlayerCollapsed') === 'true';
                if (isCollapsed) {
                    this.elements.miniPlayer.classList.add('collapsed');
                }
                // 更新箭头方向
                if (this.elements.miniPlayerCollapseBtn) {
                    this.elements.miniPlayerCollapseBtn.textContent = isCollapsed ? '▶' : '◀';
                }
            }
            
            // 6. 初始化歌单管理
            playlistsManagement.init(() => {
                this.renderPlaylist();
            });

            // 6.5 应用初始主题
            this.applyPlaylistTheme();

            // 6.7 歌单标题点击打开歌单管理
            if (this.elements.playListTitle) {
                this.elements.playListTitle.style.cursor = 'pointer';
                this.elements.playListTitle.addEventListener('click', () => {
                    playlistsManagement.show();
                });
            }
            
            // 7. 立即获取一次播放状态
            try {
                const status = await api.getStatus();
                player.updateStatus(status);
            } catch (err) {
                console.warn('首次获取状态失败:', err);
            }
            
            // 7.5 初始化排行榜
            await rankingManager.init();
            
            // 7.6 初始化设置管理器
            await settingsManager.init();
            // 注册 player 实例到 settingsManager，以便推流开关使用正确的启动方法
            settingsManager.setPlayer(player);
            
            // 7.7 初始化导航栏
            navManager.init();
            
            // 7.8 完整的状态恢复（备用，以防快速恢复失败）
            this.restorePlayState();
            
            // 8. 启动状态轮询（每200ms更新一次）
            player.startPolling(2000);
            
        } catch (error) {
            console.error('❌ 初始化失败:', error);
            Toast.error('初始化失败: ' + error.message);
        }
    }

    // 初始化 UI 元素引用
    initUIElements() {
        this.elements = {
            // 播放控制 - 底部播放栏
            playPauseBtn: document.getElementById('playPauseBtn'),
            nextBtn: document.getElementById('nextBtn'),
            prevBtn: document.getElementById('prevBtn'),
            loopBtn: document.getElementById('loopBtn'),
            
            // 迷你播放器
            miniPlayer: document.getElementById('miniPlayer'),
            miniPlayerCollapseBtn: document.getElementById('miniPlayerCollapseBtn'),
            miniPlayPauseBtn: document.getElementById('miniPlayPauseBtn'),
            miniNextBtn: document.getElementById('miniNextBtn'),
            miniPlayerTitle: document.getElementById('miniPlayerTitle'),
            miniPlayerArtist: document.getElementById('miniPlayerArtist'),
            miniPlayerPlaylist: document.getElementById('miniPlayerPlaylist'),
            miniPlayerCover: document.getElementById('miniPlayerCover'),
            
            // 全屏播放器
            fullPlayer: document.getElementById('fullPlayer'),
            fullPlayerBack: document.getElementById('fullPlayerBack'),
            fullPlayerPlayPause: document.getElementById('fullPlayerPlayPause'),
            fullPlayerPrev: document.getElementById('fullPlayerPrev'),
            fullPlayerNext: document.getElementById('fullPlayerNext'),
            fullPlayerTitle: document.getElementById('fullPlayerTitle'),
            fullPlayerArtist: document.getElementById('fullPlayerArtist'),
            fullPlayerPlaylist: document.getElementById('fullPlayerPlaylist'),
            fullPlayerCover: document.getElementById('fullPlayerCover'),
            fullPlayerProgressBar: document.getElementById('fullPlayerProgressBar'),
            fullPlayerProgressFill: document.getElementById('fullPlayerProgressFill'),
            fullPlayerProgressThumb: document.getElementById('fullPlayerProgressThumb'),
            fullPlayerCurrentTime: document.getElementById('fullPlayerCurrentTime'),
            fullPlayerDuration: document.getElementById('fullPlayerDuration'),
            fullPlayerShuffle: document.getElementById('fullPlayerShuffle'),
            fullPlayerRepeat: document.getElementById('fullPlayerRepeat'),
            fullPlayerVolumeSlider: document.getElementById('fullPlayerVolumeSlider'),
            
            // 音量控制已移至 fullPlayerVolumeSlider
            
            // 播放进度
            playerProgress: document.getElementById('playerProgress'),
            playerProgressFill: document.getElementById('playerProgressFill'),
            playerProgressThumb: document.getElementById('playerProgressThumb'),
            
            // 播放列表
            playListContainer: document.getElementById('playListContainer'),
            playListTitle: document.getElementById('playListTitle'),
            playerBar: document.getElementById('playerBar'),
            footerExpandBtn: document.getElementById('footerExpandBtn'),
            footerContent: document.getElementById('footerContent'),
            
            // 现在播放
            nowPlayingPlayBtn: document.getElementById('nowPlayingPlayBtn'),
            nowPlayingPrevBtn: document.getElementById('nowPlayingPrevBtn'),
            nowPlayingNextBtn: document.getElementById('nowPlayingNextBtn'),
            nowPlayingShuffleBtn: document.getElementById('nowPlayingShuffleBtn'),
            nowPlayingRepeatBtn: document.getElementById('nowPlayingRepeatBtn'),
            
            // 模态框
            historyModal: document.getElementById('historyModal'),
            historyList: document.getElementById('historyList'),
            youtubeSearchResults: document.getElementById('youtubeSearchResults'),
            youtubeSearchList: document.getElementById('youtubeSearchList'),
            
            // 标签导航
            bottomNav: document.getElementById('bottomNav'),
            playlist: document.getElementById('playlist'),
            tree: document.getElementById('tree')
        };
    }

    // 保护浏览器音频元素，防止非法 URL 被设置
    protectBrowserStreamAudio() {
        const audioElement = document.getElementById('browserStreamAudio');
        if (!audioElement) return;

        // 保存原始的 src setter
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        const originalSetter = descriptor?.set;

        if (originalSetter) {
            // 覆盖 src 属性的 setter
            Object.defineProperty(audioElement, 'src', {
                get() {
                    return this._src || '';
                },
                set(value) {
                    // 只允许设置 /stream/play 开头的 URL 或空字符串
                    if (!value || value.includes('/stream/play') || value === '') {
                        this._src = value;
                        // 调用原始 setter
                        if (originalSetter) {
                            originalSetter.call(this, value);
                        }
                        console.log('[音频保护] ✓ 允许设置 src:', value || '(清空)');
                    } else {
                        console.warn('[音频保护] ❌ 拒绝非法 src:', value);
                        // 不设置非法 URL，直接返回
                        return;
                    }
                },
                configurable: true
            });
        }
    }

    // 初始化播放器
    initPlayer() {
        // 监听播放状态更新
        player.on('statusUpdate', ({ status }) => {
            // 更新当前歌单ID
            if (status && status.current_playlist_id) {
                if (this.currentPlaylistId !== status.current_playlist_id) {
                    this.currentPlaylistId = status.current_playlist_id;
                    console.log('📂 当前歌单已切换:', this.currentPlaylistId);
                } else {
                    this.currentPlaylistId = status.current_playlist_id;
                }
            }
            
            // ✅ 只在循环模式改变时输出日志
            if (status && status.loop_mode !== this.lastLoopMode) {
                const loopModes = {
                    0: '❌ 不循环',
                    1: '🔂 单曲循环',
                    2: '🔁 全部循环'
                };
                console.log(`%c[播放器] 循环模式改变: ${loopModes[this.lastLoopMode] || '?'} → ${loopModes[status.loop_mode] || '?'}`, 
                    'color: #2196F3; font-weight: bold');
                this.lastLoopMode = status.loop_mode;
            }
            
            // ✅ 只在播放状态改变时输出日志
            if (status && status.paused !== this.lastPlaybackStatus) {
                const statusText = status.paused ? '⏸️ 已暂停' : '▶️ 正在播放';
                console.log(`%c[播放器] ${statusText}`, 
                    `color: ${status.paused ? '#FF9800' : '#4CAF50'}; font-weight: bold`);
                this.lastPlaybackStatus = status.paused;
            }
            
            // ✅ 只在音量改变时输出日志（避免频繁输出）
            if (status && status.volume !== null && status.volume !== undefined && !isNaN(status.volume)) {
                const roundedVolume = Math.round(status.volume);
                if (roundedVolume !== Math.round(this.lastVolume || 0)) {
                    console.log(`%c[播放器] 🔊 音量: ${roundedVolume}%`, 
                        'color: #FF9800; font-weight: bold');
                    this.lastVolume = status.volume;
                }
            }
            
            // [新增] 检测播放停止（本地文件播放完毕）
            if (this.lastPlayStatus && !this.lastPlayStatus.paused && status && status.paused) {
                // 从播放状态变为暂停状态
                const currentTime = status.time_pos || 0;
                const duration = status.duration || 0;
                
                // 判断是自然播放结束（时间接近结尾）还是被用户暂停
                if (duration > 0 && currentTime >= duration - 2) {
                    // 自然播放结束（在最后2秒内）
                    const title = status.current_meta?.title || status.current_meta?.name || '歌曲';
                    Toast.info(`${title} 已播放完毕`);
                    console.log('[播放] 当前音乐已停止');
                    
                    // 删除当前歌曲（播放完毕后删除）
                    this.removeCurrentSongFromPlaylist();
                    
                    // 播放默认歌单最顶部的歌曲
                    if (playlistManager && playlistManager.currentPlaylist && playlistManager.currentPlaylist.length > 0) {
                        const firstSong = playlistManager.currentPlaylist[0];
                        console.log('[播放完毕] 开始播放默认歌单首曲:', firstSong.title);
                        player.play(firstSong).catch(err => {
                            console.error('[播放错误]', err.message);
                        });
                    }
                } else {
                    // 被用户暂停
                    Toast.info('播放已暂停');
                }
            }
            
            this.lastPlayStatus = status;
            this.updatePlayerUI(status);
            // 更新播放列表显示（以反映当前播放状态）
            this.renderPlaylist();
        });

        // 监听播放事件
        player.on('play', ({ url, title }) => {
            Toast.success(`正在播放: ${title}`);
        });

        // 监听暂停事件
        player.on('pause', () => {
            console.log('播放已暂停');
        });

        // 监听推流相关事件
        player.on('stream:paused', () => {
            Toast.info('推流已暂停');
        });

        player.on('stream:ended', () => {
            Toast.info('当前音乐已停止');
            
            // 删除当前歌曲（播放完毕后删除）
            this.removeCurrentSongFromPlaylist();
            
            // 播放默认歌单最顶部的歌曲
            if (playlistManager && playlistManager.currentPlaylist && playlistManager.currentPlaylist.length > 0) {
                const firstSong = playlistManager.currentPlaylist[0];
                console.log('[播放完毕] 开始播放默认歌单首曲:', firstSong.title);
                player.play(firstSong).catch(err => {
                    console.error('[播放错误]', err.message);
                });
            }
        });

        player.on('stream:error', ({ errorMsg, silent }) => {
            // 静默错误不显示 toast（例如格式不支持错误）
            if (silent) {
                console.warn('[推流] 静默错误，已自动处理:', errorMsg);
                return;
            }
            Toast.error(`推流错误: ${errorMsg || '未知错误'}`);
        });

        // 监听循环模式变化
        player.on('loopChange', (loopMode) => {
            this.updateLoopButtonUI(loopMode);
        });
    }

    // 更新循环按钮的视觉状态
    updateLoopButtonUI(loopMode) {
        const buttons = [
            this.elements.loopBtn,
            this.elements.nowPlayingRepeatBtn,
            this.elements.fullPlayerRepeat
        ];

        // 循环模式: 0=不循环, 1=单曲循环, 2=全部循环
        const loopModeText = ['不循环', '单曲循环', '全部循环'];
        const loopModeEmoji = ['↻', '🔂', '🔁'];
        
        // 只在循环模式实际改变时输出日志
        if (loopMode !== this.lastUILoopMode) {
            console.log('[循环模式] 已更新至:', loopModeText[loopMode]);
            this.lastUILoopMode = loopMode;
        }
        
        buttons.forEach(btn => {
            if (btn) {
                // 更新文本内容和样式
                const emoji = loopModeEmoji[loopMode] || '↻';
                
                // 处理文本按钮（底部loopBtn）
                if (btn.id === 'loopBtn') {
                    btn.textContent = emoji;
                } else {
                    // 处理SVG按钮，需要添加active类来改变颜色
                    const title = loopModeText[loopMode];
                    btn.setAttribute('data-mode', loopMode);
                }
                
                // 添加/移除active类以显示视觉反馈
                if (loopMode === 0) {
                    btn.classList.remove('loop-active');
                    btn.style.opacity = '0.6';
                } else {
                    btn.classList.add('loop-active');
                    btn.style.opacity = '1';
                }
                
                // 更新title属性
                btn.title = `循环模式: ${loopModeText[loopMode]}`;
            }
        });
    }

    // 初始化音量控制
    initVolumeControl() {
        // 初始化音量控制
        const fullPlayerSlider = this.elements.fullPlayerVolumeSlider;
        
        if (fullPlayerSlider) {
            // 初始化 volumeControl，使用静默模式（默认仅在调试时输出日志）
            volumeControl.init(fullPlayerSlider, null, { silent: true });
            
            if (localStorage.getItem('DEBUG_MODE')) {
                console.log('✅ 音量控制已初始化');
            }
        }
    }

    /**
     * 恢复播放状态和推流激活状态
     * 页面刷新后恢复：
     * 1. 推流激活状态
     * 2. 正在播放的音乐
     */
    // [快速恢复] 页面刷新后立即恢复流连接（不等待其他初始化）
    fastRestoreStream() {
        try {
            console.log('%c[流恢复] 开始检查流状态...', 'color: #2196F3; font-weight: bold');
            
            const savedStreamState = localStorage.getItem('currentStreamState');
            if (!savedStreamState) {
                console.log('[流恢复] 没有保存的流状态');
                return;
            }
            
            // 检查推流是否被启用
            const streamActive = localStorage.getItem('streamActive') === 'true';
            console.log(`[流恢复] streamActive: ${streamActive}`);
            if (!streamActive) {
                console.log('[流恢复] 推流未被启用，跳过恢复');
                return;
            }
            
            const streamState = JSON.parse(savedStreamState);
            console.log('[流恢复] 保存的流状态:', streamState);
            
            // 检查状态是否仍然有效（30秒内）
            const age = Date.now() - streamState.timestamp;
            console.log(`[流恢复] 流状态年龄: ${Math.round(age / 1000)}秒`);
            if (age > 30 * 1000) {
                console.log('[流恢复] 流状态已过期（超过30秒），跳过恢复');
                localStorage.removeItem('currentStreamState');
                return;
            }
            
            // 检查音频元素是否存在
            const audioElement = document.getElementById('browserStreamAudio');
            if (!audioElement) {
                console.warn('[流恢复] 音频元素不存在，跳过恢复');
                return;
            }
            
            console.log('[流恢复] ✓ 音频元素存在');
            
            // 标记正在恢复流
            this.isRestoringStream = true;
            
            // 检测浏览器类型
            const userAgent = navigator.userAgent;
            const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
            const isEdge = /edg/i.test(userAgent);
            
            console.log(`%c[流恢复] 浏览器检测: Safari=${isSafari}, Edge=${isEdge}`, 'color: #FF9800');
            
            // 立即尝试恢复流
            console.log('%c[流恢复] 准备恢复流连接...', 'color: #4CAF50; font-weight: bold');
            
            // 使用异步处理以避免阻塞初始化
            Promise.resolve().then(async () => {
                console.log('[流恢复] 进入异步恢复流程...');
                
                // Safari 和 Edge 特殊处理：延迟以确保新音频元素已准备好
                if (isSafari || isEdge) {
                    console.log(`[流恢复] 应用 ${isSafari ? 'Safari' : 'Edge'} 延迟处理（200ms）`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
                // 确保 player 对象存在
                if (!window.app || !window.app.player) {
                    console.error('[流恢复] ❌ player 对象不存在，无法恢复流');
                    return;
                }
                
                const streamFormat = streamState.format || 'mp3';
                console.log(`%c[流恢复] 调用 player.startBrowserStream('${streamFormat}')`, 'color: #2196F3; font-weight: bold');
                
                try {
                    await player.startBrowserStream(streamFormat);
                    console.log('%c[流恢复] ✓ 流恢复成功！', 'color: #4CAF50; font-weight: bold');
                } catch (err) {
                    console.error('[流恢复] ❌ startBrowserStream 执行出错:', err);
                }
                
                // Safari 和 Edge 特殊处理：标记为活跃，防止重复连接
                if (isSafari || isEdge) {
                    localStorage.setItem('streamActive', 'true');
                }
            }).catch(err => {
                console.error('[流恢复] ❌ 恢复失败:', err);
            }).finally(() => {
                // 恢复完成后取消标记
                setTimeout(() => {
                    this.isRestoringStream = false;
                    console.log('[流恢复] 恢复标记已清除');
                }, 1000);
            });
            
        } catch (error) {
            console.error('[流恢复] ❌ 解析流状态失败:', error);
            this.isRestoringStream = false;
        }
    }

    async restorePlayState() {
        try {
            // 恢复推流激活状态
            const streamActive = localStorage.getItem('streamActive') === 'true';
            if (streamActive && settingsManager.settings.auto_stream) {
                const autoStreamEl = document.getElementById('autoStreamSetting');
                if (autoStreamEl) {
                    autoStreamEl.checked = true;
                }
                console.log('[恢复状态] ✓ 推流已恢复为激活状态');
            }
            
            // 恢复播放流的状态（页面刷新后）
            const savedStreamState = localStorage.getItem('currentStreamState');
            if (savedStreamState) {
                try {
                    const streamState = JSON.parse(savedStreamState);
                    
                    // 检查保存的状态是否仍然有效（5分钟内）
                    if (Date.now() - streamState.timestamp < 5 * 60 * 1000) {
                        console.log('[恢复状态] 检测到活跃的直播流，准备恢复:', {
                            format: streamState.format
                        });
                        
                        // 恢复当前歌单ID
                        if (streamState.playlistId) {
                            this.currentPlaylistId = streamState.playlistId;
                        }
                        
                        // 先检查后端流是否仍在运行，防止断开
                        try {
                            const streamStatus = await api.getStreamStatus();
                            console.log('[恢复状态] 后端流状态:', {
                                running: streamStatus.data?.running,
                                format: streamStatus.data?.format
                            });
                        } catch (err) {
                            console.warn('[恢复状态] 无法获取后端流状态:', err);
                        }
                        
                        // 立即（不延迟）恢复直播连接
                        try {
                            console.log('[恢复状态] 立即重新连接直播流...');
                            const streamFormat = streamState.format || 'mp3';
                            player.startBrowserStream(streamFormat);
                            console.log('[恢复状态] ✓ 直播流已恢复');
                        } catch (err) {
                            console.error('[恢复状态] 恢复直播流失败:', err);
                        }
                    } else {
                        // 状态已过期，清除
                        localStorage.removeItem('currentStreamState');
                    }
                } catch (err) {
                    console.warn('[恢复状态] 解析保存的流状态失败:', err);
                    localStorage.removeItem('currentStreamState');
                }
            }
            
            // 恢复播放状态
            try {
                const status = await api.getStatus();
                if (status && !status.paused) {
                    console.log('[恢复状态] 音乐正在播放，保持播放状态');
                    player.updateStatus(status);
                } else if (status && status.paused) {
                    console.log('[恢复状态] 音乐已暂停');
                    player.updateStatus(status);
                }
            } catch (err) {
                console.warn('[恢复状态] 无法恢复播放状态:', err);
            }
        } catch (error) {
            console.error('[恢复状态] 恢复失败:', error);
        }
    }

    // 保存当前播放流的状态（页面卸载时）
    saveStreamState() {
        try {
            const audioElement = document.getElementById('browserStreamAudio');
            
            // 激进的保存策略：只要音频元素存在并有 src，就保存状态
            // （即使暂停了，也可能需要恢复）
            if (audioElement && audioElement.src) {
                const streamState = {
                    // 注意：不保存 currentPlayingUrl，因为推流是从虚拟音频设备录制的，
                    // 与当前播放的歌曲无关。只保存流的状态信息
                    format: localStorage.getItem('streamFormat') || 'mp3',
                    playlistId: this.currentPlaylistId || 'default',
                    timestamp: Date.now(),
                    isPlaying: !audioElement.paused,
                    wasConnected: true  // 标记表示之前有活跃连接
                };
                
                localStorage.setItem('currentStreamState', JSON.stringify(streamState));
                console.log('[保存状态] 直播流状态已保存:', { 
                    isPlaying: streamState.isPlaying, 
                    format: streamState.format 
                });
            }
        } catch (error) {
            console.warn('[保存状态] 保存流状态失败:', error);
        }
    }

    // 设置页面可见性监听（用于刷新后自动恢复流）
    setupPageVisibilityListener() {
        document.addEventListener('visibilitychange', async () => {
            // 页面从隐藏变为可见时（页面被激活/刷新后焦点返回）
            if (!document.hidden) {
                console.log('%c[可见性] 页面已重新激活，检查推流状态...', 'color: #2196F3; font-weight: bold');
                
                // 延迟200ms确保DOM完全渲染
                setTimeout(async () => {
                    try {
                        const streamActive = localStorage.getItem('streamActive') === 'true';
                        console.log(`[可见性] streamActive: ${streamActive}`);
                        
                        if (!streamActive) {
                            console.log('[可见性] 推流未启用，跳过恢复');
                            return;
                        }
                        
                        const savedStreamState = localStorage.getItem('currentStreamState');
                        if (!savedStreamState) {
                            console.log('[可见性] 没有保存的流状态');
                            return;
                        }
                        
                        const streamState = JSON.parse(savedStreamState);
                        console.log('[可见性] 检查到保存的流状态:', streamState);
                        
                        // 检查流状态是否仍然有效（30秒内）
                        const age = Date.now() - streamState.timestamp;
                        if (age > 30 * 1000) {
                            console.log(`[可见性] 流状态已过期 (${Math.round(age / 1000)}秒)，清除`);
                            localStorage.removeItem('currentStreamState');
                            return;
                        }
                        
                        const audioElement = document.getElementById('browserStreamAudio');
                        const isStreamActive = audioElement && audioElement.src && !audioElement.paused;
                        const elementStatus = audioElement 
                            ? `src=${audioElement.src ? '✓' : '✗'}, paused=${audioElement.paused}, readyState=${audioElement.readyState}`
                            : 'element not found';
                        
                        console.log(`[可见性] 音频元素状态: ${elementStatus}`);
                        
                        // 如果流已断开，立即恢复
                        if (!isStreamActive) {
                            console.log('%c[可见性] 推流已断开，准备恢复...', 'color: #FF9800');
                            
                            const streamFormat = streamState.format || 'mp3';
                            
                            if (player && player.startBrowserStream) {
                                console.log(`[可见性] 调用 player.startBrowserStream('${streamFormat}')`);
                                await player.startBrowserStream(streamFormat);
                                console.log('%c[可见性] ✓ 推流已恢复', 'color: #4CAF50; font-weight: bold');
                            } else {
                                console.error('[可见性] ❌ player 不可用');
                            }
                        } else {
                            console.log('[可见性] 推流仍在运行，无需恢复');
                        }
                    } catch (err) {
                        console.error('[可见性] 恢复流失败:', err);
                    }
                }, 200);
            }
        });
    }

    // 初始化播放列表
    async initPlaylist() {
        try {
            await playlistManager.loadCurrent();
            await playlistManager.loadAll();
            
            // ✅ 从 playlistManager 恢复当前选择歌单的 ID（从 localStorage 中已恢复）
            const savedId = playlistManager.getSelectedPlaylistId();
            this.currentPlaylistId = savedId;
            console.log('[初始化] playlistManager.selectedPlaylistId:', savedId);
            console.log('[初始化] this.currentPlaylistId:', this.currentPlaylistId);
            console.log('[初始化] 恢复选择歌单:', this.currentPlaylistId);
            
            // 确保playlist可见
            if (this.elements.playlist) {
                this.elements.playlist.style.display = 'flex';
                console.log('✅ 设置playlist为可见');
            }
            
            // 初始化时隐藏本地文件，点击本地标签时显示
            if (this.elements.tree) {
                this.elements.tree.style.display = 'none';
                console.log('✅ 隐藏tree');
            }
            
            this.renderPlaylist();
            console.log('✅ 播放列表初始化完成');
        } catch (error) {
            console.error('加载播放列表失败:', error);
        }
    }

    // 绑定事件监听器
    bindEventListeners() {
        // 播放/暂停 - 主播放按钮
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.addEventListener('click', () => {
                player.togglePlayPause();
            });
        }

        // 点击迷你播放器打开全屏播放器
        if (this.elements.miniPlayer && this.elements.fullPlayer) {
            this.elements.miniPlayer.addEventListener('click', (e) => {
                // 检查是否点击了按钮，如果是则不展开全屏播放器
                if (e.target.closest('.mini-player-controls') || e.target.closest('.mini-player-collapse-btn')) {
                    return;
                }
                // 隐藏迷你播放器，显示全屏播放器
                this.elements.miniPlayer.style.display = 'none';
                this.elements.fullPlayer.style.display = 'flex';
                // 触发动画：先设置 display，然后添加 show 类
                setTimeout(() => {
                    this.elements.fullPlayer.classList.add('show');
                }, 10);
            });
        }

        // 迷你播放器控制
        if (this.elements.miniPlayPauseBtn) {
            this.elements.miniPlayPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，避免触发打开全屏播放器
                player.togglePlayPause();
            });
        }

        // Mini 播放器折叠按钮
        if (this.elements.miniPlayerCollapseBtn && this.elements.miniPlayer) {
            this.elements.miniPlayerCollapseBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.elements.miniPlayer.classList.toggle('collapsed');
                // 改变箭头方向
                const isCollapsed = this.elements.miniPlayer.classList.contains('collapsed');
                this.elements.miniPlayerCollapseBtn.textContent = isCollapsed ? '▶' : '◀';
                // 保存折叠状态到 localStorage
                localStorage.setItem('miniPlayerCollapsed', isCollapsed);
            });
        }

        // 全屏播放器返回按钮
        if (this.elements.fullPlayerBack) {
            this.elements.fullPlayerBack.addEventListener('click', () => {
                // 移除 show 类触发淡出动画
                if (this.elements.fullPlayer) {
                    this.elements.fullPlayer.classList.remove('show');
                    // 等待动画完成后再隐藏
                    setTimeout(() => {
                        this.elements.fullPlayer.style.display = 'none';
                        if (this.elements.miniPlayer) {
                            this.elements.miniPlayer.style.display = 'flex';
                        }
                    }, 300);
                }
            });
        }

        // 全屏播放器控制
        if (this.elements.fullPlayerPlayPause) {
            this.elements.fullPlayerPlayPause.addEventListener('click', () => {
                player.togglePlayPause();
            });
        }

        // 下一首
        if (this.elements.nextBtn) {
            this.elements.nextBtn.addEventListener('click', () => {
                player.next().catch(err => {
                    console.error('[下一首] 错误:', err);
                    Toast.error('下一首播放失败');
                });
            });
        }
        if (this.elements.fullPlayerNext) {
            this.elements.fullPlayerNext.addEventListener('click', () => {
                player.next().catch(err => {
                    console.error('[下一首] 错误:', err);
                    Toast.error('下一首播放失败');
                });
            });
        }
        if (this.elements.miniNextBtn) {
            this.elements.miniNextBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，避免触发打开全屏播放器
                player.next().catch(err => {
                    console.error('[下一首] 错误:', err);
                    Toast.error('下一首播放失败');
                });
            });
        }

        // 上一首
        if (this.elements.prevBtn) {
            this.elements.prevBtn.addEventListener('click', () => {
                player.prev().catch(err => {
                    console.error('[上一首] 错误:', err);
                    Toast.error('上一首播放失败');
                });
            });
        }
        if (this.elements.fullPlayerPrev) {
            this.elements.fullPlayerPrev.addEventListener('click', () => {
                player.prev().catch(err => {
                    console.error('[上一首] 错误:', err);
                    Toast.error('上一首播放失败');
                });
            });
        }

        // 循环模式
        if (this.elements.loopBtn) {
            this.elements.loopBtn.addEventListener('click', () => {
                player.cycleLoop();
            });
        }
        if (this.elements.nowPlayingRepeatBtn) {
            this.elements.nowPlayingRepeatBtn.addEventListener('click', () => {
                player.cycleLoop();
            });
        }
        if (this.elements.fullPlayerRepeat) {
            this.elements.fullPlayerRepeat.addEventListener('click', () => {
                player.cycleLoop();
            });
        }
        
        // 随机播放按钮（暂时禁用或隐藏）
        if (this.elements.fullPlayerShuffle) {
            this.elements.fullPlayerShuffle.style.opacity = '0.3';
            this.elements.fullPlayerShuffle.style.cursor = 'not-allowed';
            this.elements.fullPlayerShuffle.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('随机播放功能尚未实现');
            });
        }

        // 展开/收起播放栏
        if (this.elements.footerExpandBtn && this.elements.playerBar) {
            this.elements.footerExpandBtn.addEventListener('click', () => {
                this.elements.playerBar.classList.toggle('footer-collapsed');
            });
        }

        // 进度条控制
        if (this.elements.playerProgress) {
            this.elements.playerProgress.addEventListener('click', (e) => {
                this.handleProgressClick(e);
            });
        }
        if (this.elements.fullPlayerProgressBar) {
            // 点击跳转
            this.elements.fullPlayerProgressBar.addEventListener('click', (e) => {
                this.handleFullPlayerProgressClick(e);
            });
            
            // 添加拖拽功能
            let isDragging = false;
            
            const startDrag = (e) => {
                isDragging = true;
                this.elements.fullPlayerProgressBar.classList.add('dragging');
                handleDrag(e);
            };
            
            const handleDrag = (e) => {
                if (!isDragging) return;
                
                e.preventDefault();
                const rect = this.elements.fullPlayerProgressBar.getBoundingClientRect();
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                
                // 实时更新进度条显示
                if (this.elements.fullPlayerProgressFill) {
                    this.elements.fullPlayerProgressFill.style.width = percent + '%';
                }
                if (this.elements.fullPlayerProgressThumb) {
                    this.elements.fullPlayerProgressThumb.style.left = percent + '%';
                }
                
                // 更新时间显示
                const status = player.getStatus();
                if (status?.mpv?.duration && this.elements.fullPlayerCurrentTime) {
                    const currentTime = (percent / 100) * status.mpv.duration;
                    this.elements.fullPlayerCurrentTime.textContent = formatTime(currentTime);
                }
                
                // 实时seek到拖拽位置（拖拽中实时播放）
                player.seek(percent).catch(err => {
                    console.warn('实时seek失败:', err);
                });
            };
            
            const endDrag = (e) => {
                if (!isDragging) return;
                isDragging = false;
                this.elements.fullPlayerProgressBar.classList.remove('dragging');
                
                // 拖拽结束，位置已经在handleDrag中更新了，这里只需清理状态
                // 不需要再次seek
            };
            
            // 鼠标事件
            this.elements.fullPlayerProgressBar.addEventListener('mousedown', startDrag);
            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', endDrag);
            
            // 触摸事件（移动端）
            this.elements.fullPlayerProgressBar.addEventListener('touchstart', startDrag, { passive: false });
            document.addEventListener('touchmove', handleDrag, { passive: false });
            document.addEventListener('touchend', endDrag);
        }

        // 完整播放器的音量控制
        if (this.elements.fullPlayerVolumeSlider) {
            this.elements.fullPlayerVolumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value);
                // 通过 volumeControl 来设置音量，保持同步
                volumeControl.updateDisplay(volume);
            });
            this.elements.fullPlayerVolumeSlider.addEventListener('change', (e) => {
                const volume = parseInt(e.target.value);
                // 通过 volumeControl 来设置音量到服务器
                volumeControl.setVolume(volume);
            });
        }

        // 初始化调试面板模块
        debug.init(player, playlistManager);
        
        // 安全地初始化音频格式按钮
        if (debug && typeof debug.initAudioFormatButtons === 'function') {
            debug.initAudioFormatButtons();
        }
        
        // 标签页切换
        this.setupTabNavigation();
    }
    
    // 更新播放器 UI
    updatePlayerUI(status) {
        if (!status) return;

        // 更新标题和信息
        const title = status.current_title || status.title || status.current_meta?.title || '未播放';
        const artist = status.current_meta?.artist || status.artist || '--';
        const playlistName = status.current_playlist_name || '默认';
        
        // 更新迷你播放器标题和信息
        if (this.elements.miniPlayerTitle) {
            this.elements.miniPlayerTitle.textContent = title;
        }
        if (this.elements.miniPlayerArtist) {
            this.elements.miniPlayerArtist.textContent = artist;
        }
        if (this.elements.miniPlayerPlaylist) {
            this.elements.miniPlayerPlaylist.textContent = playlistName;
        }
        
        // 更新全屏播放器标题和艺术家
        if (this.elements.fullPlayerTitle) {
            this.elements.fullPlayerTitle.textContent = title;
        }
        if (this.elements.fullPlayerArtist) {
            this.elements.fullPlayerArtist.textContent = artist;
        }
        if (this.elements.fullPlayerPlaylist) {
            this.elements.fullPlayerPlaylist.textContent = playlistName;
        }

        // 更新进度信息（支持两种字段名）
        const mpvData = status.mpv || status.mpv_state || {};
        if (mpvData) {
            const currentTime = mpvData.time_pos || mpvData.time || 0;
            const duration = mpvData.duration || 0;

            // 检测播放结束，自动播放下一首
            if (duration > 1 && currentTime >= 0) {  // duration > 1 确保有效
                // 判断是否正在播放：paused === false 或 paused 不为true
                const isPlaying = (mpvData.paused === false) || 
                                 (mpvData.paused === null) ||
                                 (mpvData.paused === undefined);
                
                const timeRemaining = duration - currentTime;
                const autoPlayThreshold = 2.5;  // 当剩余时间少于2.5秒时触发
                
                // 详细的日志用于调试（只在接近结尾时打印）
                if (timeRemaining < 4 && timeRemaining > 0) {
                    if (!window._lastAutoPlayLog || Date.now() - window._lastAutoPlayLog > 2000) {
                        console.log('[自动播放检测]', {
                            isPlaying,
                            timeRemaining: timeRemaining.toFixed(2),
                            duration: duration.toFixed(2),
                            currentTime: currentTime.toFixed(2),
                            paused: mpvData.paused,
                            threshold: autoPlayThreshold,
                            willTrigger: isPlaying && timeRemaining < autoPlayThreshold,
                            flagSet: this._autoNextTriggered
                        });
                        window._lastAutoPlayLog = Date.now();
                    }
                }
                
                // 当剩余时间小于阈值且正在播放时，触发下一首
                if (isPlaying && timeRemaining < autoPlayThreshold && timeRemaining >= -0.5) {
                    // 使用标记避免重复触发
                    if (!this._autoNextTriggered) {
                        this._autoNextTriggered = true;
                        console.log('[自动播放] 触发！剩余时间:', timeRemaining.toFixed(2), '秒，即将播放下一首');
                        
                        // 先删除当前歌曲，然后播放下一首
                        this.removeCurrentSongFromPlaylist().then(() => {
                            // 立即播放下一首
                            return player.next();
                        }).then(() => {
                            console.log('[自动播放] ✓ 成功切换到下一首 已删除刚才的歌曲');
                            // 延迟1秒后重置标记，防止抖动
                            setTimeout(() => {
                                this._autoNextTriggered = false;
                            }, 1000);
                        }).catch(err => {
                            console.error('[自动播放] ✗ 失败:', err.message || err);
                            // 失败时立即重置，允许重试
                            setTimeout(() => {
                                this._autoNextTriggered = false;
                            }, 500);
                        });
                    }
                } else if (timeRemaining >= 3 || !isPlaying) {
                    // 当还有较长时间或暂停时，重置标记
                    this._autoNextTriggered = false;
                }
            }

            // 更新全屏播放器时间
            if (this.elements.fullPlayerCurrentTime) {
                this.elements.fullPlayerCurrentTime.textContent = formatTime(currentTime);
            }
            if (this.elements.fullPlayerDuration) {
                this.elements.fullPlayerDuration.textContent = formatTime(duration);
            }

            // 更新播放进度条
            if (this.elements.playerProgressFill && duration > 0) {
                const percent = (currentTime / duration) * 100;
                if (this.elements.playerProgress) {
                    this.elements.playerProgressFill.style.width = percent + '%';
                }
            }

            // 更新全屏播放器进度条
            if (this.elements.fullPlayerProgressFill && duration > 0) {
                const percent = (currentTime / duration) * 100;
                if (this.elements.fullPlayerProgressBar) {
                    this.elements.fullPlayerProgressFill.style.width = percent + '%';
                }
                // 更新进度条拖拽手柄位置
                if (this.elements.fullPlayerProgressThumb) {
                    this.elements.fullPlayerProgressThumb.style.left = percent + '%';
                }
            }

            // 更新迷你播放器进度条
            if (duration > 0) {
                const percent = (currentTime / duration) * 100;
                // 查找迷你播放器进度条（如果没有缓存元素）
                const miniProgressFill = document.getElementById('miniPlayerProgressFill');
                if (miniProgressFill) {
                    miniProgressFill.style.width = percent + '%';
                }
            }
        }

        // 更新播放/暂停按钮状态
        const isPlaying = (status.mpv?.paused || status.mpv_state?.paused) === false;
        
        // 更新按钮文本/图标
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
            this.elements.playPauseBtn.title = isPlaying ? '暂停' : '播放';
        }
        if (this.elements.miniPlayPauseBtn) {
            this.elements.miniPlayPauseBtn.textContent = isPlaying ? '⏸' : '▶';
        }
        if (this.elements.fullPlayerPlayPause) {
            // 更新SVG path的d属性以显示正确的图标
            const svg = this.elements.fullPlayerPlayPause.querySelector('svg');
            const path = this.elements.fullPlayerPlayPause.querySelector('svg path');
            if (path && svg) {
                // 暂停: 两个竖条 | |  播放: 三角形 ▶
                path.setAttribute('d', isPlaying ? 
                    'M6 4h4v16H6V4zm8 0h4v16h-4V4z' :  // 暂停按钮
                    'M8 5v14l11-7z'  // 播放按钮
                );
            }
        }

        // 更新封面 - 支持高质量缩略图和备用方案
        const thumbnailUrl = status.thumbnail_url || status.current_meta?.thumbnail_url || '';
        
        if (thumbnailUrl) {
            // 只在缩略图改变时输出日志
            if (thumbnailUrl !== this.lastThumbnailUrl) {
                console.log('[迷你播放器] 更新封面:', thumbnailUrl);
                console.log('[完整播放器] 更新封面:', thumbnailUrl);
                this.lastThumbnailUrl = thumbnailUrl;
            }
            
            // 为YouTube视频生成多个质量级别的URL备选方案
            const getYouTubeFallbackUrls = (url) => {
                if (url.includes('img.youtube.com')) {
                    const baseUrl = url.split('/').slice(0, -1).join('/');
                    // 优先级: maxresdefault > sddefault > mqdefault > default
                    return [
                        url, // 原始URL (通常是maxresdefault)
                        baseUrl + '/sddefault.jpg',  // 备用1: 640x480
                        baseUrl + '/mqdefault.jpg',  // 备用2: 320x180
                        baseUrl + '/default.jpg'     // 备用3: 120x90
                    ];
                }
                return [url];
            };
            
            const urls = getYouTubeFallbackUrls(thumbnailUrl);
            
            if (this.elements.miniPlayerCover) {
                this.elements.miniPlayerCover.src = thumbnailUrl;
                this.elements.miniPlayerCover.style.display = 'block';
                // 添加备用URL逻辑
                this.elements.miniPlayerCover.onerror = function() {
                    const currentIndex = urls.indexOf(this.src);
                    if (currentIndex < urls.length - 1) {
                        this.src = urls[currentIndex + 1];
                    } else {
                        this.style.display = 'none';
                    }
                };
            }
            if (this.elements.fullPlayerCover) {
                this.elements.fullPlayerCover.src = thumbnailUrl;
                this.elements.fullPlayerCover.style.display = 'block';
                // 添加备用URL逻辑
                this.elements.fullPlayerCover.onerror = function() {
                    const currentIndex = urls.indexOf(this.src);
                    if (currentIndex < urls.length - 1) {
                        this.src = urls[currentIndex + 1];
                        console.log('[完整播放器] 缩略图加载失败，尝试备用:', urls[currentIndex + 1]);
                    } else {
                        this.style.display = 'none';
                        console.log('[完整播放器] 所有缩略图备用均失败');
                    }
                };
            }
        } else {
            // 如果没有封面，隐藏img并显示占位符
            if (this.elements.miniPlayerCover) {
                this.elements.miniPlayerCover.style.display = 'none';
            }
            if (this.elements.fullPlayerCover) {
                this.elements.fullPlayerCover.style.display = 'none';
            }
            this.lastThumbnailUrl = null;  // 重置缩略图追踪
        }

        // 更新循环按钮状态（从status中获取最新的循环模式）
        if (status && status.loop_mode !== undefined) {
            this.updateLoopButtonUI(status.loop_mode);
        }
    }

    // 检测歌单类型并应用相应主题
    applyPlaylistTheme() {
        const playlist = playlistManager.getCurrent();
        const playlistEl = document.getElementById('playlist');
        const playlistsModal = document.getElementById('playlistsModal');
        
        if (!playlistEl) return;
        
        // 移除旧的主题类
        playlistEl.classList.remove('bright-theme', 'dark-theme');
        if (playlistsModal) {
            playlistsModal.classList.remove('bright-theme', 'dark-theme');
        }
        
        // 如果歌单为空，使用默认主题（深色主题）
        if (!playlist || playlist.length === 0) {
            playlistEl.classList.add('dark-theme');
            if (playlistsModal) {
                playlistsModal.classList.add('dark-theme');
            }
            return;
        }
        
        // 检查歌单中是否有YouTube歌曲 或 网络歌曲
        const hasYoutube = playlist.some(song => {
            const isYoutube = song.type === 'youtube' || song.type === 'stream';
            const isUrl = song.url && (song.url.startsWith('http') || song.url.startsWith('youtu'));
            return isYoutube || isUrl;
        });
        
        // 如果全是本地歌曲，使用亮色主题；否则使用深色主题
        const theme = !hasYoutube ? 'bright-theme' : 'dark-theme';
        playlistEl.classList.add(theme);
        if (playlistsModal) {
            playlistsModal.classList.add(theme);
        }
    }

    // 渲染播放列表
    renderPlaylist() {
        const status = player.getStatus();
        renderPlaylistUI({
            container: this.elements.playListContainer,
            titleEl: this.elements.playListTitle,
            onPlay: (song) => this.playSong(song),
            currentMeta: status?.current_meta || null
        });
        
        // 应用相应的主题
        this.applyPlaylistTheme();
    }

    // ✅ 新增：切换选择歌单
    async switchSelectedPlaylist(playlistId) {
        try {
            console.log('[应用] 切换选择歌单:', playlistId);
            
            // 更新 playlistManager 的当前选择歌单
            playlistManager.setSelectedPlaylist(playlistId);
            this.currentPlaylistId = playlistId;
            
            // 刷新播放列表 UI
            this.renderPlaylist();
            
            console.log('[应用] ✓ 已切换到歌单:', playlistId);
            
        } catch (error) {
            console.error('[应用] 切换失败:', error);
            Toast.error('切换歌单失败: ' + error.message);
        }
    }

    // 停止推流（用于切换歌曲时的清理）
    stopBrowserStream() {
        // 如果正在恢复流，不要停止它
        if (this.isRestoringStream) {
            console.log('[停止推流] 正在恢复流，跳过停止操作');
            return;
        }
        
        const audioElement = document.getElementById('browserStreamAudio');
        if (audioElement && !audioElement.paused) {
            try {
                // 使用更安全的方式停止
                audioElement.pause();
                audioElement.currentTime = 0;
                audioElement.src = '';
                audioElement.load();
                
                // 标记推流已停止
                localStorage.setItem('streamActive', 'false');
                
                console.log('[推流] 已停止推流');
            } catch (err) {
                console.warn('[推流] 停止推流失败:', err);
            }
        }
    }

    // 播放歌曲
    async playSong(song) {
        try {
            // 获取当前播放的歌曲信息
            const status = player.getStatus();
            const currentMeta = status?.current_meta;
            
            // 检查是否是当前正在播放的歌曲
            if (currentMeta && currentMeta.url === song.url && !status?.paused) {
                // 如果是当前正在播放的歌曲，则显示完整播放器（像点击mini播放器一样）
                if (this.elements.miniPlayer && this.elements.fullPlayer) {
                    this.elements.miniPlayer.style.display = 'none';
                    this.elements.fullPlayer.style.display = 'flex';
                    // 触发动画：先设置 display，然后添加 show 类
                    setTimeout(() => {
                        this.elements.fullPlayer.classList.add('show');
                    }, 10);
                }
                return;
            }
            
            // 首先停止旧的推流
            this.stopBrowserStream();
            
            // 清理前一次播放的超时
            if (this.playTimeouts && this.playTimeouts.length > 0) {
                this.playTimeouts.forEach(id => clearTimeout(id));
                this.playTimeouts = [];
            }
            
            loading.show('📀 准备播放歌曲...');
            
            // 从 localStorage 读取用户选择的格式，默认为 mp3
            const streamFormat = localStorage.getItem('streamFormat') || 'mp3';
            
            // 播放歌曲
            await player.play(song.url, song.title, song.type, streamFormat);
            
            // 立即隐藏加载提示（不再等待推流）
            loading.hide();
            Toast.success(`🎵 正在播放: ${song.title}`);
            
        } catch (error) {
            loading.hide();
            Toast.error('播放失败: ' + error.message);
        }
    }

    // 设置音频格式
    setStreamFormat(format) {
        localStorage.setItem('streamFormat', format);
        console.log(`[设置] 音频推流格式已更改为: ${format}`);
    }

    // 获取当前音频格式
    getStreamFormat() {
        return localStorage.getItem('streamFormat') || 'mp3';
    }

    // 播放/暂停
    togglePlayPause() {
        player.togglePlayPause();
    }

    // 下一首
    playNext() {
        player.next();
    }

    // 上一首
    playPrev() {
        player.prev();
    }

    // 从默认歌单中删除当前正在播放的歌曲
    async removeCurrentSongFromPlaylist() {
        try {
            const status = player.getStatus();
            if (!status || !status.current_meta) {
                console.log('[删除歌曲] 没有正在播放的歌曲');
                return; // 没有正在播放的歌曲
            }
            
            const currentUrl = status.current_meta.url;
            if (!playlistManager || !playlistManager.currentPlaylist) {
                console.log('[删除歌曲] 播放列表管理器或播放列表不可用');
                return;
            }
            
            // 找到当前正在播放的歌曲索引
            const currentIndex = playlistManager.currentPlaylist.findIndex(
                song => song.url === currentUrl
            );
            
            console.log('[删除歌曲] 当前URL:', currentUrl);
            console.log('[删除歌曲] 当前播放列表:', playlistManager.currentPlaylist);
            console.log('[删除歌曲] 找到的索引:', currentIndex);
            
            if (currentIndex !== -1) {
                // 使用 PlaylistManager 的 removeAt 方法，它会自动重新加载播放列表
                const result = await playlistManager.removeAt(currentIndex);
                if (result.status === 'OK') {
                    console.log('[删除歌曲] 已删除索引为', currentIndex, '的歌曲');
                } else {
                    console.error('[删除歌曲] 删除失败:', result.error || result.message);
                }
            } else {
                console.log('[删除歌曲] 未找到当前播放的歌曲');
            }
        } catch (err) {
            console.error('[删除歌曲错误]', err.message);
        }
    }

    // 处理进度条点击
    handleProgressClick(e) {
        if (!this.elements.playerProgress) return;
        
        const rect = this.elements.playerProgress.getBoundingClientRect();
        const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        
        // 将百分比发送到后端 /seek
        player.seek(percent);
    }

    // 处理全屏播放器进度条点击
    handleFullPlayerProgressClick(e) {
        if (!this.elements.fullPlayerProgressBar) return;
        
        const rect = this.elements.fullPlayerProgressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        
        // 将百分比发送到后端 /seek
        player.seek(percent);
    }

    // 处理搜索
    async handleSearch() {
        // 搜索功能由search模块处理
        // 这里可以作为备用接口
        console.log('搜索功能已集成到search模块');
    }

    // 设置标签页切换
    setupTabNavigation() {
        if (!this.elements.bottomNav) {
            console.warn('❌ 底部导航栏未找到');
            return;
        }

        console.log('✅ 初始化标签页切换');
        const navItems = this.elements.bottomNav.querySelectorAll('.nav-item');
        console.log('🔍 找到', navItems.length, '个导航项');
        
        const tabContents = {
            'playlists': this.elements.playlist,
            'local': this.elements.tree,
            'ranking': null,  // 排行榜使用模态框，不需要tab-content
            'search': null    // 搜索使用模态框，不需要tab-content
        };

        // 跟踪当前显示的标签页
        let currentTab = 'playlists';
        let previousTab = 'playlists';  // 记录上一个标签页，用于设置关闭时恢复
        const hideAllContent = () => {
            return new Promise(resolve => {
                navItems.forEach(navItem => navItem.classList.remove('active'));
                Object.values(tabContents).forEach(tab => {
                    if (tab) {
                        tab.classList.remove('tab-visible');
                    }
                });
                setTimeout(() => {
                    Object.values(tabContents).forEach(tab => {
                        if (tab) tab.style.display = 'none';
                    });
                    resolve();
                }, 300);
            });
        };

        const showContent = (tab, tabName) => {
            if (tab) {
                tab.style.display = tab === this.elements.playlist ? 'flex' : 'block';
                setTimeout(() => {
                    if (tab) tab.classList.add('tab-visible');
                }, 10);
            }
        };

        navItems.forEach((item, index) => {
            const tabName = item.getAttribute('data-tab');
            console.log(`📌 导航项${index}: data-tab="${tabName}"`);
            
            // 跳过没有 data-tab 属性的按钮（如推流和设置）
            if (!tabName || tabName === 'stream') {
                console.log(`⏭️ 跳过 "${tabName}" 按钮（独立功能）`);
                return;
            }
            
            item.addEventListener('click', async (e) => {
                console.log('🖱️ 点击导航项:', tabName, '当前:', currentTab);
                
                // 关闭全屏播放器（如果打开）
                if (this.elements.fullPlayer && this.elements.fullPlayer.style.display !== 'none') {
                    this.elements.fullPlayer.style.display = 'none';
                    if (this.elements.miniPlayer) {
                        this.elements.miniPlayer.style.display = 'block';
                    }
                    console.log('🔽 关闭全屏播放器，显示迷你播放器');
                }
                
                // 如果点击相同的标签，则切换到上一个栏目；否则显示该标签
                // ✅ 队列按钮除外（始终显示队列，不返回上一个页面）
                if (currentTab === tabName && item.classList.contains('active') && tabName !== 'playlists') {
                    console.log('🔄 再次点击，恢复到上一个栏目:', previousTab);
                    
                    // 如果有上一个栏目，则切换到上一个栏目
                    if (previousTab && previousTab !== tabName) {
                        const targetNavItem = Array.from(navItems).find(navItem => 
                            navItem.getAttribute('data-tab') === previousTab
                        );
                        
                        if (targetNavItem) {
                            console.log('📌 触发点击', previousTab);
                            targetNavItem.click();
                            return;
                        }
                    }
                    
                    // 如果没有上一个栏目，就不做任何动作
                    return;
                }
                
                console.log('📋 显示', tabName);
                previousTab = currentTab;  // 保存上一个标签页
                await hideAllContent();
                
                // 隐藏所有模态框
                const rankingModal = document.getElementById('rankingModal');
                const searchModal = document.getElementById('searchModal');
                const playlistsModal = document.getElementById('playlistsModal');
                if (rankingModal) {
                    rankingModal.classList.remove('modal-visible');
                    rankingModal.style.display = 'none';
                }
                if (searchModal) {
                    searchModal.classList.remove('modal-visible');
                    searchModal.style.display = 'none';
                }
                if (playlistsModal) {
                    playlistsModal.classList.remove('modal-visible');
                    playlistsModal.style.display = 'none';
                }
                
                // 更新导航按钮状态
                item.classList.add('active');
                
                // 队列按钮
                if (tabName === 'playlists') {
                    if (this.elements.playlist) {
                        showContent(this.elements.playlist, tabName);
                        playlistManager.switch('default').then(() => {
                            this.currentPlaylistId = 'default';
                            // ✅ 确保设置选择歌单为默认歌单（并保存到 localStorage）
                            playlistManager.setSelectedPlaylist('default');
                            this.renderPlaylist();
                        }).catch(err => {
                            console.error('切换到默认歌单失败:', err);
                            playlistManager.setSelectedPlaylist('default');
                            this.renderPlaylist();
                        });
                    }
                } 
                // 本地文件
                else if (tabName === 'local') {
                    if (this.elements.tree) {
                        showContent(this.elements.tree, tabName);
                    }
                }
                // 排行榜
                else if (tabName === 'ranking') {
                    if (rankingModal) {
                        rankingModal.style.display = 'block';
                        setTimeout(() => {
                            if (rankingModal) rankingModal.classList.add('modal-visible');
                        }, 10);
                    }
                }
                // 搜索
                else if (tabName === 'search') {
                    previousTab = currentTab;  // 保存当前栏目
                    if (searchModal) {
                        searchModal.style.display = 'block';
                        setTimeout(() => {
                            if (searchModal) searchModal.classList.add('modal-visible');
                        }, 10);
                    }
                    setTimeout(() => {
                        const searchInput = document.getElementById('searchModalInput');
                        if (searchInput) {
                            searchInput.focus();
                        }
                    }, 310);
                }
                // 调试
                else if (tabName === 'debug') {
                    previousTab = currentTab;  // 保存当前栏目
                    const debugModal = document.getElementById('debugModal');
                    if (debugModal) {
                        debugModal.style.display = 'flex';
                        console.log('🐛 调试模态框已显示');
                        // 延迟刷新，确保DOM已更新
                        setTimeout(() => {
                            this.refreshDebugInfo();
                            this.updateStreamStatus();
                        }, 100);
                    }
                }
                
                currentTab = tabName;
            });
        });
        
        // 推流按钮点击处理
        const streamNavBtn = document.getElementById('streamNavBtn');
        if (streamNavBtn) {
            streamNavBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                console.log('📡 推流按钮被点击');
                
                try {
                    // 只开启推流，不关闭
                    console.log('📡 启动推流');
                    await player.startBrowserStream('mp3');
                    localStorage.setItem('streamActive', 'true');
                    this.updateStreamNavButton(true);
                    Toast.success('推流已启动');
                } catch (err) {
                    console.error('推流启动失败:', err);
                    Toast.error('推流启动失败: ' + (err.message || err));
                }
            });
            
            // 初始化推流按钮状态
            const streamActive = localStorage.getItem('streamActive') === 'true';
            this.updateStreamNavButton(streamActive);
        }
        
        // 设置按钮点击处理
        const settingsBtn = document.getElementById('settingsNavBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', async () => {
                console.log('⚙️ 点击设置按钮，当前栏目:', currentTab);
                previousTab = currentTab;  // 保存当前栏目
                await hideAllContent();
                
                // 隐藏所有模态框
                const rankingModal = document.getElementById('rankingModal');
                const searchModal = document.getElementById('searchModal');
                const playlistsModal = document.getElementById('playlistsModal');
                const debugModal = document.getElementById('debugModal');
                if (rankingModal) {
                    rankingModal.classList.remove('modal-visible');
                    rankingModal.style.display = 'none';
                }
                if (searchModal) {
                    searchModal.classList.remove('modal-visible');
                    searchModal.style.display = 'none';
                }
                if (playlistsModal) {
                    playlistsModal.classList.remove('modal-visible');
                    playlistsModal.style.display = 'none';
                }
                if (debugModal) {
                    debugModal.style.display = 'none';
                }
                
                settingsBtn.classList.add('active');
                settingsManager.openPanel();
                currentTab = 'settings';
            });
        }
        
        // 修改设置管理器的关闭方法，添加恢复逻辑
        const originalClosePanel = settingsManager.closePanel;
        settingsManager.closePanel = async function() {
            originalClosePanel.call(this);
            
            console.log('⚙️ 设置关闭，恢复栏目:', previousTab);
            
            // 移除设置按钮的active状态
            if (settingsBtn) settingsBtn.classList.remove('active');
            
            // 恢复之前的栏目
            if (previousTab && previousTab !== 'settings') {
                // 找到对应的导航按钮并触发点击
                const targetNavItem = Array.from(navItems).find(item => 
                    item.getAttribute('data-tab') === previousTab
                );
                
                if (targetNavItem) {
                    console.log('📌 恢复到栏目:', previousTab);
                    targetNavItem.click();
                }
            }
        };
        
        // 初始化时显示"队列"模块
        const firstNavItem = navItems[0];
        if (firstNavItem) {
            firstNavItem.classList.add('active');
            const playlistsContent = this.elements.playlist;
            if (playlistsContent) {
                playlistsContent.style.display = 'flex';
                setTimeout(() => {
                    if (playlistsContent) playlistsContent.classList.add('tab-visible');
                }, 10);
            }
            playlistManager.switch('default').then(() => {
                this.currentPlaylistId = 'default';
                this.renderPlaylist();
            }).catch(err => {
                console.error('初始化队列失败:', err);
                this.renderPlaylist();
            });
        }
        
        // 绑定模态框关闭事件
        this.setupModalClosing();
    }

    // 切换标签页
    switchTab(tabName, clickedItem, navItems, tabContents) {
        console.log('🔄 切换到标签:', tabName);
        
        // 更新导航按钮状态
        navItems.forEach(item => item.classList.remove('active'));
        clickedItem.classList.add('active');
        console.log('✅ 更新导航按钮状态');

        // 隐藏所有标签内容
        Object.entries(tabContents).forEach(([key, tab]) => {
            if (tab) {
                tab.style.display = 'none';
                console.log(`隐藏: ${key}`);
            }
        });

        // 显示选中的标签内容
        const selectedTab = tabContents[tabName];
        
        if (selectedTab) {
            // 本地文件树特殊处理
            if (tabName === 'local') {
                selectedTab.style.display = 'block';
            } else {
                selectedTab.style.display = 'flex';
            }
            console.log(`✅ 显示: ${tabName}`);
        } else if (tabName === 'ranking' || tabName === 'search') {
            console.log(`ℹ️  '${tabName}' 使用模态框显示`);
        } else {
            console.warn(`❌ 标签内容不存在: ${tabName}`);
            return;
        }
        
        // 根据不同标签页显示模态框或刷新内容
        switch(tabName) {
            case 'playlists':
                console.log('🎵 刷新歌单显示');
                this.renderPlaylist();
                break;
            case 'local':
                console.log('📂 刷新本地文件树');
                localFiles.loadTree();
                break;
            case 'ranking':
                console.log('🏆 显示排行榜');
                const rankingModal = document.getElementById('rankingModal');
                if (rankingModal) {
                    rankingModal.style.display = 'block';
                    console.log('📊 排行榜模态框已显示');
                }
                break;
            case 'search':
                console.log('🔍 显示搜索页面');
                const searchModal = document.getElementById('searchModal');
                if (searchModal) {
                    searchModal.style.display = 'block';
                    console.log('🔎 搜索模态框已显示');
                }
                break;
            case 'debug':
                console.log('🐞 显示调试面板');
                const debugModal = document.getElementById('debugModal');
                if (debugModal) {
                    debugModal.style.display = 'block';
                    console.log('🐛 调试面板已显示');
                }
                break;
        }
    }

    // 设置模态框关闭事件
    setupModalClosing() {
        // 排行榜模态框关闭 - 支持点击背景关闭
        const rankingModal = document.getElementById('rankingModal');
        if (rankingModal) {
            rankingModal.addEventListener('click', (e) => {
                if (e.target === rankingModal) {
                    rankingModal.style.display = 'none';
                }
            });
        }
        
        // 调试模态框关闭 - 支持点击背景和关闭按钮
        const debugModal = document.getElementById('debugModal');
        if (debugModal) {
            debugModal.addEventListener('click', (e) => {
                if (e.target === debugModal) {
                    debugModal.style.display = 'none';
                }
            });
            
            const debugModalClose = document.getElementById('debugModalClose');
            if (debugModalClose) {
                debugModalClose.addEventListener('click', () => {
                    debugModal.style.display = 'none';
                });
            }
        }
        
        // 搜索栏目关闭时恢复之前的栏目
        const searchModal = document.getElementById('searchModal');
        if (searchModal) {
            // 创建自定义的搜索关闭处理，恢复之前的栏目
            const setupSearchClosing = () => {
                const searchModalBack = document.getElementById('searchModalBack');
                if (searchModalBack) {
                    searchModalBack.addEventListener('click', async () => {
                        console.log('🔍 搜索关闭，恢复栏目:', previousTab);
                        
                        // 移除样式
                        searchModal.classList.remove('modal-visible');
                        setTimeout(() => {
                            searchModal.style.display = 'none';
                        }, 300);
                        
                        const navItems = document.querySelectorAll('.nav-item');
                        const searchNavItem = Array.from(navItems).find(item => item.getAttribute('data-tab') === 'search');
                        if (searchNavItem) {
                            searchNavItem.classList.remove('active');
                        }
                        
                        // 延迟后恢复之前的栏目
                        setTimeout(() => {
                            // 找到之前的栏目并点击它
                            if (previousTab && previousTab !== 'search') {
                                const targetNavItem = Array.from(navItems).find(item => 
                                    item.getAttribute('data-tab') === previousTab
                                );
                                
                                if (targetNavItem) {
                                    console.log('📌 恢复到栏目:', previousTab);
                                    targetNavItem.click();
                                }
                            }
                        }, 300);
                    });
                }
            };
            setupSearchClosing();
        }
        
        // 初始化搜索功能
        searchManager.initUI(() => this.currentPlaylistId, () => this.renderPlaylist());
        
        // 初始化调试面板
        this.initDebugPanel();
    }

    // 初始化调试面板
    initDebugPanel() {
        const debugRefresh = document.getElementById('debugRefresh');
        const startStreamBtn = document.getElementById('startStreamBtn');
        const stopStreamBtn = document.getElementById('stopStreamBtn');
        const debugClearLogs = document.getElementById('debugClearLogs');
        const debugLogToggle = document.getElementById('debugLogToggle');
        
        // 刷新按钮
        if (debugRefresh) {
            debugRefresh.addEventListener('click', () => {
                this.refreshDebugInfo();
            });
        }
        
        // 推流控制按钮
        if (startStreamBtn) {
            startStreamBtn.addEventListener('click', () => {
                console.log('🔴 调试面板: 启动推流');
                player.startStream('mp3').catch(err => {
                    console.error('启动推流失败:', err);
                });
            });
        }
        
        if (stopStreamBtn) {
            stopStreamBtn.addEventListener('click', () => {
                console.log('🔴 调试面板: 停止推流');
                player.stopStream().catch(err => {
                    console.error('停止推流失败:', err);
                });
            });
        }
        
        // 清空日志按钮
        if (debugClearLogs) {
            debugClearLogs.addEventListener('click', () => {
                const debugLogs = document.getElementById('debugLogs');
                if (debugLogs) {
                    debugLogs.innerHTML = '';
                }
                if (window.APP_DEBUG_LOGS) {
                    window.APP_DEBUG_LOGS = [];
                }
            });
        }
        
        // 日志捕获开关
        if (debugLogToggle) {
            debugLogToggle.addEventListener('change', (e) => {
                window.CAPTURE_LOGS = e.target.checked;
                if (e.target.checked && !window.APP_DEBUG_LOGS) {
                    window.APP_DEBUG_LOGS = [];
                    this.setupConsoleHijack();
                }
            });
        }
        
        // 初始化日志捕获
        this.setupConsoleHijack();
        
        // 初次显示时刷新信息
        this.refreshDebugInfo();
    }

    // 拦截控制台日志
    setupConsoleHijack() {
        if (window.CONSOLE_HIJACKED) return;
        
        window.APP_DEBUG_LOGS = window.APP_DEBUG_LOGS || [];
        window.CAPTURE_LOGS = true;
        window.CONSOLE_HIJACKED = true;
        
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        const originalInfo = console.info;
        const originalDebug = console.debug;
        
        const captureLog = (level, args) => {
            if (!window.CAPTURE_LOGS) return;
            
            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let message = '';
            
            for (let arg of args) {
                if (typeof arg === 'object') {
                    message += JSON.stringify(arg);
                } else {
                    message += String(arg);
                }
                message += ' ';
            }
            
            const logEntry = `[${timestamp}] [${level}] ${message.trim()}`;
            window.APP_DEBUG_LOGS.push(logEntry);
            
            // 限制日志数量，最多保留500条
            if (window.APP_DEBUG_LOGS.length > 500) {
                window.APP_DEBUG_LOGS.shift();
            }
            
            // 更新日志显示
            const debugLogs = document.getElementById('debugLogs');
            if (debugLogs) {
                debugLogs.innerHTML = window.APP_DEBUG_LOGS.map(log => `<div>${this.escapeHtml(log)}</div>`).join('');
                // 自动滚动到底部
                debugLogs.scrollTop = debugLogs.scrollHeight;
            }
        };
        
        console.log = function(...args) {
            originalLog.apply(console, args);
            captureLog('LOG', args);
        };
        
        console.warn = function(...args) {
            originalWarn.apply(console, args);
            captureLog('WARN', args);
        };
        
        console.error = function(...args) {
            originalError.apply(console, args);
            captureLog('ERROR', args);
        };
        
        console.info = function(...args) {
            originalInfo.apply(console, args);
            captureLog('INFO', args);
        };
        
        console.debug = function(...args) {
            originalDebug.apply(console, args);
            captureLog('DEBUG', args);
        };
    }

    // 转义HTML特殊字符
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 刷新调试信息
    // 更新推流按钮外观
    updateStreamNavButton(isActive) {
        const streamNavBtn = document.getElementById('streamNavBtn');
        const streamNavIcon = document.getElementById('streamNavIcon');
        const streamNavIndicator = document.getElementById('streamNavIndicator');
        
        if (!streamNavBtn) return;
        
        if (isActive) {
            // 推流激活
            streamNavBtn.classList.add('active');
            if (streamNavIcon) {
                streamNavIcon.textContent = '📡'; // 可以改为发光的图标
                streamNavIcon.style.color = '#51cf66';
            }
            if (streamNavIndicator) {
                streamNavIndicator.style.display = 'block';
                streamNavIndicator.style.background = '#51cf66';
                // 添加脉冲动画
                streamNavIndicator.style.animation = 'pulse 1.5s infinite';
            }
        } else {
            // 推流未激活
            streamNavBtn.classList.remove('active');
            if (streamNavIcon) {
                streamNavIcon.textContent = '📡';
                streamNavIcon.style.color = '';
            }
            if (streamNavIndicator) {
                streamNavIndicator.style.display = 'none';
                streamNavIndicator.style.animation = '';
            }
        }
    }

    refreshDebugInfo() {
        const debugPlayer = document.getElementById('debugPlayer');
        const debugPlaylist = document.getElementById('debugPlaylist');
        const debugStorage = document.getElementById('debugStorage');
        
        console.log('[DEBUG] refreshDebugInfo 开始...');
        console.log('debugPlayer:', debugPlayer);
        console.log('debugPlaylist:', debugPlaylist);
        console.log('debugStorage:', debugStorage);
        
        // 获取播放器状态
        const status = player.getStatus();
        console.log('[DEBUG] player.getStatus():', status);
        
        if (debugPlayer) {
            if (status) {
                debugPlayer.innerHTML = `<pre style="margin: 0; color: #51cf66;">${JSON.stringify({
                    paused: status.paused,
                    currentTime: status.time_pos || 0,
                    duration: status.duration || 0,
                    volume: status.volume || 0,
                    loopMode: status.loop_mode || 0,
                    currentSong: status.current_meta?.title || status.current_title || 'N/A'
                }, null, 2)}</pre>`;
                console.log('[DEBUG] debugPlayer 已更新');
            } else {
                debugPlayer.innerHTML = '<pre style="margin: 0; color: #ff6b6b;">无法获取播放器状态</pre>';
            }
        } else {
            console.warn('[DEBUG] debugPlayer 元素不存在');
        }
        
        // 获取歌单信息
        if (debugPlaylist) {
            if (playlistManager) {
                debugPlaylist.innerHTML = `<pre style="margin: 0; color: #51cf66;">${JSON.stringify({
                    currentPlaylistId: this.currentPlaylistId,
                    playlistLength: playlistManager.currentPlaylist?.length || 0,
                    playlistCount: playlistManager.playlists?.length || 0
                }, null, 2)}</pre>`;
                console.log('[DEBUG] debugPlaylist 已更新');
            } else {
                debugPlaylist.innerHTML = '<pre style="margin: 0; color: #ff6b6b;">playlistManager 未初始化</pre>';
            }
        } else {
            console.warn('[DEBUG] debugPlaylist 元素不存在');
        }
        
        // 获取本地存储信息
        if (debugStorage) {
            const storageInfo = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const value = localStorage.getItem(key);
                storageInfo[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
            }
            debugStorage.innerHTML = `<pre style="margin: 0; color: #51cf66;">${JSON.stringify(storageInfo, null, 2)}</pre>`;
            console.log('[DEBUG] debugStorage 已更新');
        } else {
            console.warn('[DEBUG] debugStorage 元素不存在');
        }
    }

    // 更新推流状态
    updateStreamStatus() {
        const streamStatusDisplay = document.getElementById('streamStatusDisplay');
        const streamStatusText = document.getElementById('streamStatusText');
        const streamSpeed = document.getElementById('streamSpeed');
        const streamTotal = document.getElementById('streamTotal');
        const streamDuration = document.getElementById('streamDuration');
        const streamClients = document.getElementById('streamClients');
        const streamFormat = document.getElementById('streamFormat');
        
        console.log('[DEBUG] updateStreamStatus 开始...');
        
        // 获取推流状态
        fetch('/stream/status')
            .then(res => res.json())
            .then(data => {
                console.log('[DEBUG] /stream/status 响应:', data);
                
                if (data.status === 'OK' && data.data) {
                    const streamData = data.data;
                    
                    if (streamStatusDisplay) {
                        streamStatusDisplay.textContent = streamData.is_active ? '●' : '●';
                        streamStatusDisplay.style.color = streamData.is_active ? '#51cf66' : '#f44336';
                    }
                    
                    if (streamStatusText) {
                        streamStatusText.textContent = streamData.status_text || '未激活';
                        streamStatusText.style.color = streamData.is_active ? '#51cf66' : '#f44336';
                    }
                    
                    if (streamSpeed) {
                        streamSpeed.innerHTML = `速度: <strong>${(streamData.avg_speed || 0).toFixed(2)} KB/s</strong>`;
                        streamSpeed.style.color = '#51cf66';
                    }
                    if (streamTotal) {
                        streamTotal.innerHTML = `总数据: <strong>${(streamData.total_mb || 0).toFixed(2)} MB</strong>`;
                        streamTotal.style.color = '#51cf66';
                    }
                    if (streamDuration) {
                        streamDuration.innerHTML = `用时: <strong>${streamData.duration || 0}s</strong>`;
                        streamDuration.style.color = '#51cf66';
                    }
                    if (streamClients) {
                        streamClients.innerHTML = `活跃客户端: <strong>${streamData.active_clients || 0}</strong>`;
                        streamClients.style.color = '#51cf66';
                    }
                    if (streamFormat) {
                        streamFormat.innerHTML = `格式: <strong>${streamData.format || '--'}</strong>`;
                        streamFormat.style.color = '#51cf66';
                    }
                    
                    console.log('[DEBUG] 推流状态已更新');
                }
            })
            .catch(err => {
                console.warn('[调试] 获取推流状态失败:', err);
                if (streamStatusText) {
                    streamStatusText.textContent = '无法获取状态';
                    streamStatusText.style.color = '#ff9800';
                }
                if (streamSpeed) streamSpeed.textContent = '速度: --';
                if (streamTotal) streamTotal.textContent = '总数据: --';
                if (streamDuration) streamDuration.textContent = '用时: --';
                if (streamClients) streamClients.textContent = '客户端: --';
                if (streamFormat) streamFormat.textContent = '格式: --';
            });
    }

}

// ==========================================
// 应用启动
// ==========================================

// 创建全局应用实例
const app = new MusicPlayerApp();

// 页面卸载时的清理逻辑（处理页面刷新/关闭时的stream断开）
window.addEventListener('beforeunload', () => {
    console.log('%c[页面卸载] 保存推流状态...', 'color: #FF9800; font-weight: bold');
    
    // 保存当前的推流状态（供刷新后恢复）
    // 即使流已断开，仍然保存最后的状态，以便恢复时快速重连
    
    // 检查推流是否被启用
    const streamActive = localStorage.getItem('streamActive') === 'true';
    console.log(`[页面卸载] streamActive: ${streamActive}`);
    
    if (streamActive) {
        // 获取当前推流状态
        const audioElement = document.getElementById('browserStreamAudio');
        const isPlaying = audioElement && !audioElement.paused;
        const streamFormat = localStorage.getItem('streamFormat') || 'mp3';
        
        // 保存详细状态供恢复
        const streamState = {
            format: streamFormat,
            isPlaying: isPlaying,
            timestamp: Date.now(),
            userAgent: navigator.userAgent.substring(0, 100)
        };
        
        localStorage.setItem('currentStreamState', JSON.stringify(streamState));
        localStorage.setItem('streamActive', 'true');
        
        console.log('[页面卸载] ✓ 推流状态已保存:', streamState);
    } else {
        console.log('[页面卸载] 推流未启用，清除保存的流状态');
        localStorage.removeItem('currentStreamState');
    }
    
    // 注意：不要在这里调用 stopBrowserStream() 或断开连接
    // 让浏览器自然断开，Safari 会自动清理音频连接
    // 我们的工作只是保存状态，让后续恢复时重新连接
});

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    await themeManager.init();
    app.init();
}

// 导出供调试使用
window.MusicPlayerApp = app;
window.app = {
    ...app,
    player,      // 播放器对象
    settingsManager,  // 设置管理器
    modules: {
        api,
        player,
        playlistManager,
        volumeControl,
        searchManager,
        themeManager,
        settingsManager,
        navManager
    },
    // 诊断工具
    diagnose: {
        stream: () => player.diagnoseStream(),  // 推流诊断
        printHelp: () => {
            console.log('%c🔧 可用诊断命令', 'color: #FF9800; font-size: 14px; font-weight: bold');
            console.log('  • app.diagnose.stream()     - 打印推流诊断信息');
            console.log('  • player.startBrowserStream() - 手动启动推流');
            console.log('  • player.stopBrowserStream()  - 手动停止推流');
            console.log('  • settingsManager.playStreamAudio() - 使用备用方法启动推流');
        }
    }
};

console.log('💡 模块化音乐播放器已加载');
console.log('💡 输入 app.diagnose.printHelp() 查看诊断命令');

console.log('💡 可通过 window.app.player、window.app.settingsManager 访问核心模块');
