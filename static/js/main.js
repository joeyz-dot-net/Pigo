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

// ==========================================
// 应用初始化
// ==========================================

class MusicPlayerApp {
    constructor() {
        this.initialized = false;
        this.currentPlaylistId = 'default';  // 跟踪当前选择的歌单ID
        this._autoNextTriggered = false;  // 自动播放下一首的标记
    }

    async init() {
        if (this.initialized) return;
        
        console.log('🎵 初始化音乐播放器...');
        
        try {
            // 0.1 初始化多语言系统
            i18n.init();
            
            // 0. 从后端获取推流配置
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
            
            // 2. 初始化播放器
            this.initPlayer();
            
            // 3. 初始化音量控制
            this.initVolumeControl();
            
            // 4. 初始化播放列表
            await this.initPlaylist();
            
            // 4.5 初始化本地歌曲
            await localFiles.init({
                treeEl: this.elements.tree,
                getCurrentPlaylistId: () => this.currentPlaylistId
            });
            
            // 5. 绑定事件监听器
            this.bindEventListeners();
            
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
            this.bindSettingsButton();
            
            // 7.7 初始化导航栏
            navManager.init();
            
            // 7.8 恢复推流激活状态和播放状态
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

    // 初始化播放器
    initPlayer() {
        // 监听播放状态更新
        player.on('statusUpdate', ({ status }) => {
            // 更新当前歌单ID
            if (status && status.current_playlist_id) {
                this.currentPlaylistId = status.current_playlist_id;
                console.log('📂 当前歌单已切换:', this.currentPlaylistId);
            }
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
        
        console.log('[循环模式] 已更新至:', loopModeText[loopMode]);
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

    // 绑定设置按钮
    bindSettingsButton() {
        /**绑定导航栏设置按钮*/
        const settingsBtn = document.getElementById('settingsNavBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                settingsManager.openPanel();
            });
        }
    }

    /**
     * 恢复播放状态和推流激活状态
     * 页面刷新后恢复：
     * 1. 推流激活状态
     * 2. 正在播放的音乐
     */
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

    // 初始化播放列表
    async initPlaylist() {
        try {
            await playlistManager.loadCurrent();
            await playlistManager.loadAll();
            
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
                if (e.target.closest('.mini-player-controls')) {
                    return;
                }
                // 隐藏迷你播放器，显示全屏播放器
                this.elements.miniPlayer.style.display = 'none';
                this.elements.fullPlayer.style.display = 'flex';
            });
        }

        // 迷你播放器控制
        if (this.elements.miniPlayPauseBtn) {
            this.elements.miniPlayPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，避免触发打开全屏播放器
                player.togglePlayPause();
            });
        }

        // 全屏播放器返回按钮
        if (this.elements.fullPlayerBack) {
            this.elements.fullPlayerBack.addEventListener('click', () => {
                // 隐藏全屏播放器，显示迷你播放器
                if (this.elements.fullPlayer) {
                    this.elements.fullPlayer.style.display = 'none';
                }
                if (this.elements.miniPlayer) {
                    this.elements.miniPlayer.style.display = 'block';
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
            console.log('[完整播放器] 更新标题:', title);
        }
        if (this.elements.fullPlayerArtist) {
            this.elements.fullPlayerArtist.textContent = artist;
            console.log('[完整播放器] 更新艺术家:', artist);
        }
        if (this.elements.fullPlayerPlaylist) {
            this.elements.fullPlayerPlaylist.textContent = playlistName;
            console.log('[完整播放器] 更新歌单:', playlistName);
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
                        
                        // 立即播放下一首
                        player.next().then(() => {
                            console.log('[自动播放] ✓ 成功切换到下一首');
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
                console.log('[迷你播放器] 更新封面:', thumbnailUrl);
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
                console.log('[完整播放器] 更新封面:', thumbnailUrl);
            }
        } else {
            // 如果没有封面，隐藏img并显示占位符
            if (this.elements.miniPlayerCover) {
                this.elements.miniPlayerCover.style.display = 'none';
            }
            if (this.elements.fullPlayerCover) {
                this.elements.fullPlayerCover.style.display = 'none';
            }
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
            console.log('🎵 歌单为空，应用深色主题');
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
        console.log(`🎵 歌单主题已应用: ${theme}, 包含YouTube: ${hasYoutube}, 歌曲数: ${playlist.length}`);
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
    // 停止推流（用于切换歌曲时的清理）
    stopBrowserStream() {
        const audioElement = document.getElementById('browserStreamAudio');
        if (audioElement && !audioElement.paused) {
            audioElement.pause();
            audioElement.currentTime = 0;
            audioElement.src = '';
            console.log('[推流] 已停止推流');
        }
    }

    // 播放歌曲
    async playSong(song) {
        try {
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

        navItems.forEach((item, index) => {
            const tabName = item.getAttribute('data-tab');
            console.log(`📌 导航项${index}: data-tab="${tabName}"`);
            
            item.addEventListener('click', (e) => {
                console.log('🖱️ 点击导航项:', tabName);
                
                // 关闭全屏播放器（如果打开）
                if (this.elements.fullPlayer && this.elements.fullPlayer.style.display !== 'none') {
                    this.elements.fullPlayer.style.display = 'none';
                    // 显示迷你播放器
                    if (this.elements.miniPlayer) {
                        this.elements.miniPlayer.style.display = 'block';
                    }
                    console.log('🔽 关闭全屏播放器，显示迷你播放器');
                }
                
                // 队列按钮：显示默认歌单
                if (tabName === 'playlists') {
                    console.log('📋 显示默认歌单');
                    // 更新导航按钮状态
                    navItems.forEach(navItem => navItem.classList.remove('active'));
                    item.classList.add('active');
                    
                    // 隐藏所有标签内容
                    Object.values(tabContents).forEach(tab => {
                        if (tab) tab.style.display = 'none';
                    });
                    
                    // 切换到默认歌单并显示
                    if (this.elements.playlist) {
                        this.elements.playlist.style.display = 'flex';
                        // 先切换到默认歌单，再渲染
                        playlistManager.switch('default').then(() => {
                            this.currentPlaylistId = 'default';
                            this.renderPlaylist();
                        }).catch(err => {
                            console.error('切换到默认歌单失败:', err);
                            this.renderPlaylist();
                        });
                    }
                    currentTab = 'playlists';
                    return;
                }
                
                if (tabName === 'ranking') {
                    const rankingModal = document.getElementById('rankingModal');
                    if (rankingModal) {
                        rankingModal.style.display = 'block';
                        // 这里可以触发加载排行榜数据
                    }
                    return;
                }
                
                if (tabName === 'search') {
                    const searchModal = document.getElementById('searchModal');
                    if (searchModal) {
                        searchModal.style.display = 'block';
                        const searchInput = document.getElementById('searchModalInput');
                        if (searchInput) {
                            searchInput.focus();
                        }
                    }
                    return;
                }
                
                // 本地标签的切换逻辑：点击已显示的本地按钮会收起，再次点击会展开
                if (tabName === 'local') {
                    const localButton = item;
                    if (currentTab === 'local') {
                        // 已显示本地，点击则收起（回到歌单）
                        console.log('📁 收起本地歌曲，返回歌单');
                        this.switchTab('playlists', navItems[0], navItems, tabContents);
                        currentTab = 'playlists';
                    } else {
                        // 未显示本地，点击则展开
                        console.log('📁 展开本地歌曲');
                        this.switchTab(tabName, localButton, navItems, tabContents);
                        currentTab = 'local';
                    }
                    return;
                }
                
                // 常规标签切换（目前只有本地文件）
                this.switchTab(tabName, e.currentTarget, navItems, tabContents);
                currentTab = tabName;
            });
        });
        
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
        }
    }

    // 设置模态框关闭事件
    setupModalClosing() {
        // 排行榜模态框关闭
        const rankingModalClose = document.getElementById('rankingModalClose');
        const rankingModal = document.getElementById('rankingModal');
        if (rankingModalClose && rankingModal) {
            rankingModalClose.addEventListener('click', () => {
                rankingModal.style.display = 'none';
            });
            
            // 点击背景关闭
            rankingModal.addEventListener('click', (e) => {
                if (e.target === rankingModal) {
                    rankingModal.style.display = 'none';
                }
            });
        }
        
        // 搜索模态框关闭
        // 初始化搜索功能
        searchManager.initUI(() => this.currentPlaylistId, () => this.renderPlaylist());
    }

    // 处理进度条点击（旧版本，已被上面的新版本替代）
    handleProgressClickOld(e) {
        const progressContainer = e.currentTarget.parentElement;
        const rect = progressContainer.getBoundingClientRect();
        const percent = ((e.clientX - rect.left) / rect.width) * 100;
        
        const status = player.getStatus();
        if (status?.mpv?.duration) {
            const seekTime = (percent / 100) * status.mpv.duration;
            player.seek(seekTime);
        }
    }
}

// ==========================================
// 应用启动
// ==========================================

// 创建全局应用实例
const app = new MusicPlayerApp();

// 页面卸载时的清理逻辑（处理页面刷新/关闭时的stream断开）
window.addEventListener('beforeunload', () => {
    // 停止推流
    const audioElement = document.getElementById('browserStreamAudio');
    if (audioElement) {
        try {
            audioElement.pause();
            audioElement.src = '';
            audioElement.load();
            console.log('[清理] 页面卸载时停止了推流');
        } catch (e) {
            // 忽略错误
        }
    }
    
    // 停止状态轮询
    if (player && typeof player.stopPolling === 'function') {
        player.stopPolling();
    }
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
    }
};

console.log('💡 模块化音乐播放器已加载');
console.log('💡 可通过 window.app.player、window.app.settingsManager 访问核心模块');
