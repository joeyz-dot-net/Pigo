// 模块化主入口示例
// 这是一个使用新模块系统的示例文件

import { api } from './api.js';
import { player } from './player.js';
import { playlistManager, renderPlaylistUI } from './playlist.js';
import { playlistsManagement } from './playlists-management.js';
import { volumeControl } from './volume.js';
import { searchManager } from './search.js';
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
        // 【用户隔离】从 localStorage 恢复歌单选择，默认为 'default'
        this.currentPlaylistId = localStorage.getItem('selectedPlaylistId') || 'default';
        this.lastPlayStatus = null;  // 追踪上一次的播放状态，用于检测播放停止
        
        // 状态追踪变量 - 用于只在改变时输出日志
        this.lastLoopMode = null;  // 循环模式
        this.lastVolume = null;    // 音量
        this.lastPlaybackStatus = null;  // 播放状态
        this.lastUILoopMode = null;  // UI更新中的循环模式跟踪，防止重复日志
        this.lastThumbnailUrl = null;  // 缩略图URL追踪
        this._autoNextTriggered = false;  // 自动播放下一首的标记
        
        // ✅ playlistManager 会在 constructor 中自动从 localStorage 恢复选择歌单
    }

    async init() {
        if (this.initialized) return;
        
        console.log('🎵 初始化 ClubMusic...');
        
        try {
            // 0.1 初始化多语言系统
            i18n.init();
            
            // 1. 初始化 UI 元素
            this.initUIElements();
            
            // 2. 初始化播放器
            this.initPlayer();
            
            // 3. 初始化音量控制
            this.initVolumeControl();
            
            // 4. 初始化播放列表
            await this.initPlaylist();
            
            // 5. 初始化歌单管理模块
            playlistsManagement.init(async (playlistId) => {
                await this.switchSelectedPlaylist(playlistId);
            });
            
            // 5.5 初始化设置管理器（绑定关闭按钮等事件）
            await settingsManager.init();
            
            // 6. 绑定事件监听器
            this.bindEventListeners();
            
            // 7. 恢复播放状态
            await this.restorePlayState();
            
            // 8. 启动状态轮询 - 生产环境优化：缩短间隔从 2000ms 到 1000ms
            // 改进原因：降低网络延迟对播放状态更新的影响
            player.startPolling(1000);
            
            this.initialized = true;
            console.log('✅ ClubMusic 初始化完成');
            
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
        player.on('statusUpdate', async ({ status }) => {
            // 【用户隔离】不再从后端同步 current_playlist_id
            // 歌单选择由前端 localStorage 独立管理，每个浏览器独立
            // status.current_playlist_id 只用于调试，不覆盖前端状态
            
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
            
            // ✅【关键】自动播放完全由后端控制，前端只负责显示状态
            // 当歌曲播放完毕时，后端 handle_playback_end() 会：
            // 1. 通过 MPV 事件监听检测 end-file 事件
            // 2. 删除当前播放的歌曲（通过URL匹配）
            // 3. 播放删除后的 songs[0]
            // 前端只需等待后续 statusUpdate 中 current_meta 的变化即可
            
            this.lastPlayStatus = status;
            this.updatePlayerUI(status);
            
            // ✅【关键修复】歌曲变化时：先刷新播放列表数据，再重新渲染
            // 这样才能显示后端删除当前歌曲后的最新列表
            const currentUrl = status?.current_meta?.url || status?.current_meta?.rel || null;
            if (currentUrl !== this._lastRenderedSongUrl) {
                this._lastRenderedSongUrl = currentUrl;
                // 【步骤1】重新加载最新的播放列表数据（自动播放后会删除已播放的歌曲）
                await playlistManager.loadCurrent();
                // 【步骤2】重新渲染列表，显示最新数据
                this.renderPlaylist();
                console.log('[歌曲变化] ✓ 已刷新播放列表数据');
            }
        });

        // 监听播放事件
        player.on('play', ({ url, title }) => {
            Toast.success(`正在播放: ${title}`);
        });

        // 监听暂停事件
        player.on('pause', () => {
            console.log('播放已暂停');
        });

        // ✅【移除】自动播放完全由后端 handle_playback_end() 控制
        // 后端通过 MPV 事件监听器检测 end-file 事件并自动处理自动播放
        // 前端不应该在这里干涉自动播放流程，以避免竞态条件

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

    async restorePlayState() {
        try {
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
            
            // ✅ 从 playlistManager 恢复当前选择歌单的 ID（从 localStorage 中已恢复）
            const savedId = playlistManager.getSelectedPlaylistId();
            this.currentPlaylistId = savedId;
            console.log('[初始化] playlistManager.selectedPlaylistId:', savedId);
            console.log('[初始化] this.currentPlaylistId:', this.currentPlaylistId);
            console.log('[初始化] 恢复选择歌单:', this.currentPlaylistId);
            
            // 初始化时隐藏本地文件，点击本地标签时显示
            if (this.elements.tree) {
                this.elements.tree.classList.remove('tab-visible');
                console.log('✅ 隐藏tree');
            }
            
            // 显示playlist（添加tab-visible类以设置opacity=1）
            if (this.elements.playlist) {
                this.elements.playlist.classList.add('tab-visible');
                console.log('✅ 显示playlist');
            }
            
            this.renderPlaylist();
            
            // 初始化队列按钮图标
            this.updateQueueNavIcon();
            
            // 激活队列导航按钮
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                if (item.getAttribute('data-tab') === 'playlists') {
                    item.classList.add('active');
                }
            });
            
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

        // Mini 播放器已移除

        // 全屏播放器返回按钮 + 向下拖拽返回
        if (this.elements.fullPlayer) {
            // 返回上一导航栏的方法
            const goBackToNav = () => {
                this.elements.fullPlayer.classList.remove('show');
                setTimeout(() => {
                    this.elements.fullPlayer.style.display = 'none';
                }, 300);
            };

            // 点击返回按钮
            if (this.elements.fullPlayerBack) {
                this.elements.fullPlayerBack.addEventListener('click', goBackToNav);
            }

            // 拖拽返回逻辑
            let dragStart = { x: 0, y: 0 };
            let isDragging = false;
            let startOpacity = 1;
            
            this.elements.fullPlayer.addEventListener('touchstart', (e) => {
                dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                isDragging = true;
                startOpacity = 1;
            }, { passive: true });

            this.elements.fullPlayer.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                
                const currentY = e.touches[0].clientY;
                const deltaY = currentY - dragStart.y;
                
                // 只在向下拖拽时响应
                if (deltaY > 0) {
                    const dragThreshold = 80; // 拖拽阈值
                    const opacity = Math.max(0.3, 1 - (deltaY / 300));
                    
                    this.elements.fullPlayer.style.transform = `translateY(${deltaY}px)`;
                    this.elements.fullPlayer.style.opacity = opacity;
                }
            }, { passive: true });

            this.elements.fullPlayer.addEventListener('touchend', (e) => {
                if (!isDragging) return;
                isDragging = false;
                
                const endY = e.changedTouches[0].clientY;
                const deltaY = endY - dragStart.y;
                const dragThreshold = 80; // 拖拽阈值
                
                if (deltaY > dragThreshold) {
                    // 拖拽距离足够，执行返回
                    this.elements.fullPlayer.style.transition = 'all 0.3s ease-out';
                    this.elements.fullPlayer.style.transform = 'translateY(100%)';
                    this.elements.fullPlayer.style.opacity = '0';
                    
                    setTimeout(() => {
                        this.elements.fullPlayer.style.transition = '';
                        this.elements.fullPlayer.style.transform = '';
                        this.elements.fullPlayer.style.opacity = '';
                        goBackToNav();
                    }, 300);
                } else {
                    // 拖拽距离不足，回弹
                    this.elements.fullPlayer.style.transition = 'all 0.3s ease-out';
                    this.elements.fullPlayer.style.transform = 'translateY(0)';
                    this.elements.fullPlayer.style.opacity = '1';
                    
                    setTimeout(() => {
                        this.elements.fullPlayer.style.transition = '';
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

            // 前端只负责显示播放进度，自动播放完全由后端控制

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
                
                // 更新当前播放歌曲卡片的进度条
                const trackProgressFill = document.getElementById('currentTrackProgress');
                if (trackProgressFill) {
                    trackProgressFill.style.width = percent + '%';
                } else {
                    // 如果找不到进度条元素，尝试找到current-playing卡片并添加
                    const currentPlayingCard = document.querySelector('.playlist-track-item.current-playing');
                    if (currentPlayingCard && !currentPlayingCard.querySelector('.track-progress-bar')) {
                        const progressBar = document.createElement('div');
                        progressBar.className = 'track-progress-bar';
                        progressBar.innerHTML = '<div class="track-progress-fill" id="currentTrackProgress" style="width:' + percent + '%"></div>';
                        currentPlayingCard.appendChild(progressBar);
                    }
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
            // 检查是否是已知失败的URL（避免重复请求）
            if (this._failedCoverUrls && this._failedCoverUrls.has(thumbnailUrl)) {
                // 已知失败，不再尝试
                if (this.elements.miniPlayerCover) this.elements.miniPlayerCover.style.display = 'none';
                if (this.elements.fullPlayerCover) this.elements.fullPlayerCover.style.display = 'none';
                return;
            }
            
            // 只在缩略图改变时更新
            if (thumbnailUrl !== this.lastThumbnailUrl) {
                console.log('[播放器] 更新封面:', thumbnailUrl);
                this.lastThumbnailUrl = thumbnailUrl;
                
                // 初始化失败URL集合
                if (!this._failedCoverUrls) this._failedCoverUrls = new Set();
                
                // 为YouTube视频生成多个质量级别的URL备选方案
                const getYouTubeFallbackUrls = (url) => {
                    if (url.includes('img.youtube.com')) {
                        const baseUrl = url.split('/').slice(0, -1).join('/');
                        return [
                            url,
                            baseUrl + '/sddefault.jpg',
                            baseUrl + '/mqdefault.jpg',
                            baseUrl + '/default.jpg'
                        ];
                    }
                    return [url];
                };
                
                const urls = getYouTubeFallbackUrls(thumbnailUrl);
                const self = this;
                
                if (this.elements.miniPlayerCover) {
                    this.elements.miniPlayerCover.src = thumbnailUrl;
                    this.elements.miniPlayerCover.style.display = 'block';
                    this.elements.miniPlayerCover.onerror = function() {
                        const currentIndex = urls.indexOf(this.src);
                        if (currentIndex < urls.length - 1) {
                            this.src = urls[currentIndex + 1];
                        } else {
                            this.style.display = 'none';
                            self._failedCoverUrls.add(thumbnailUrl);  // 标记为失败
                        }
                    };
                }
                if (this.elements.fullPlayerCover) {
                    this.elements.fullPlayerCover.src = thumbnailUrl;
                    this.elements.fullPlayerCover.style.display = 'block';
                    this.elements.fullPlayerCover.onerror = function() {
                        const currentIndex = urls.indexOf(this.src);
                        if (currentIndex < urls.length - 1) {
                            this.src = urls[currentIndex + 1];
                        } else {
                            this.style.display = 'none';
                            self._failedCoverUrls.add(thumbnailUrl);  // 标记为失败
                        }
                    };
                }
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
            onPlay: (song) => this.playSong(song),
            currentMeta: status?.current_meta || null
        });
        
        // 应用相应的主题
        this.applyPlaylistTheme();
    }

    // 更新歌单歌曲数量显示（已移除playlist header，此方法不再需要）
    // updatePlaylistCount() {
    //     const countEl = document.getElementById('playListCount');
    //     if (countEl) {
    //         const songs = playlistManager.getSongs();
    //         const count = songs ? songs.length : 0;
    //         countEl.textContent = `${count} 首歌曲`;
    //     }
    // }

    // ✅ 新增：切换选择歌单
    async switchSelectedPlaylist(playlistId) {
        try {
            console.log('[应用] 切换选择歌单:', playlistId);
            
            // 更新 playlistManager 的当前选择歌单
            playlistManager.setSelectedPlaylist(playlistId);
            this.currentPlaylistId = playlistId;
            
            // 重新加载所选歌单的数据
            await playlistManager.loadCurrent();
            
            // 确保隐藏模态框，显示播放列表容器
            const playlistsModal = document.getElementById('playlistsModal');
            if (playlistsModal) {
                playlistsModal.classList.remove('modal-visible');
                setTimeout(() => {
                    playlistsModal.style.display = 'none';
                }, 300);
            }
            
            // 显示播放列表容器
            if (this.elements.playlist) {
                this.elements.playlist.style.display = 'block';
                setTimeout(() => {
                    this.elements.playlist.classList.add('tab-visible');
                }, 10);
            }
            
            // 隐藏本地文件
            if (this.elements.tree) {
                this.elements.tree.classList.remove('tab-visible');
                this.elements.tree.style.display = 'none';
            }
            
            // 刷新播放列表 UI
            this.renderPlaylist();
            
            // 动态更新队列按钮图标
            this.updateQueueNavIcon();
            
            console.log('[应用] ✓ 已切换到歌单:', playlistId);
            
        } catch (error) {
            console.error('[应用] 切换失败:', error);
            Toast.error('❌ 切换歌单失败: ' + error.message);
        }
    }

    // 停止推流（用于切换歌曲时的清理）
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
            
            // 清理前一次播放的超时
            if (this.playTimeouts && this.playTimeouts.length > 0) {
                this.playTimeouts.forEach(id => clearTimeout(id));
                this.playTimeouts = [];
            }
            
            loading.show('📀 准备播放歌曲...');
            
            // 播放歌曲，添加重试逻辑，网络歌曲特别容易失败
            let playSuccess = false;
            let lastError = null;
            const maxRetries = 3;
            
            for (let retry = 0; retry < maxRetries; retry++) {
                try {
                    await player.play(song.url, song.title, song.type);
                    playSuccess = true;
                    break; // 播放成功，跳出重试循环
                } catch (err) {
                    lastError = err;
                    console.warn(`[播放] 第 ${retry + 1} 次播放失败: ${err.message}`);
                    
                    // 如果是本地歌曲或最后一次重试，直接抛出
                    if (song.type === 'local' || retry === maxRetries - 1) {
                        throw err;
                    }
                    
                    // 网络歌曲失败，等待后重试
                    await new Promise(resolve => setTimeout(resolve, 500 * (retry + 1)));
                    console.log(`[播放] 等待后重试播放: ${song.title}`);
                }
            }
            
            if (playSuccess) {
                // 立即隐藏加载提示（不再等待推流）
                loading.hide();
                Toast.success(`🎵 正在播放: ${song.title}`);
            }
            
        } catch (error) {
            loading.hide();
            console.error('[播放错误] 播放失败:', error);
            Toast.error('播放失败: ' + (error.message || error));
        }
    }

    // 动态更新队列按钮图标
    updateQueueNavIcon() {
        const queueNavIcon = document.querySelector('[data-tab="playlists"] .nav-icon');
        if (!queueNavIcon) return;
        
        // 获取当前歌单信息
        const playlists = playlistManager.playlists || [];
        
        // 图标数组（与歌单管理页面保持一致）
        const icons = ['🎵', '🎧', '🎸', '🎹', '🎤', '🎼', '🎺', '🥁'];
        
        // 渐变色数组（与歌单列表保持一致）
        const gradients = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
            'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
            'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)'
        ];
        
        let icon;
        let gradient;
        let playlistIndex = -1;
        
        if (this.currentPlaylistId === 'default') {
            // 默认歌单使用星星图标和第一个渐变色
            icon = '⭐';
            gradient = gradients[0];
        } else {
            // 【修正】使用forEach的index，与歌单管理页面逻辑完全一致
            playlists.forEach((playlist, index) => {
                if (playlist.id === this.currentPlaylistId) {
                    playlistIndex = index;
                }
            });
            icon = playlistIndex >= 0 ? icons[playlistIndex % icons.length] : '🎵';
            gradient = playlistIndex >= 0 ? gradients[playlistIndex % gradients.length] : gradients[0];
        }
        
        // 更新图标和背景
        queueNavIcon.textContent = icon;
        queueNavIcon.style.background = gradient;
        queueNavIcon.style.borderRadius = '12px';
        queueNavIcon.style.padding = '8px';
        queueNavIcon.style.display = 'flex';
        queueNavIcon.style.alignItems = 'center';
        queueNavIcon.style.justifyContent = 'center';
        
        const currentPlaylist = playlists.find(p => p.id === this.currentPlaylistId);
        console.log(`[队列图标] 已更新为: ${icon} (歌单: ${currentPlaylist?.name || '未知'}, 索引: ${playlistIndex >= 0 ? playlistIndex : 'N/A'})`);  
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
            
            const currentMeta = status.current_meta;
            const currentUrl = currentMeta.url || currentMeta.rel || currentMeta.raw_url;
            const currentTitle = currentMeta.title || currentMeta.name;
            
            if (!playlistManager || !playlistManager.currentPlaylist) {
                console.log('[删除歌曲] 播放列表管理器或播放列表不可用');
                return;
            }
            
            console.log('[删除歌曲] 当前播放信息:', {
                url: currentUrl,
                title: currentTitle,
                type: currentMeta.type,
                playlistLength: playlistManager.currentPlaylist.length
            });
            
            // 多层级匹配策略：先按 URL，再按标题，最后按索引（考虑 YouTube URL 可能变化）
            let currentIndex = -1;
            
            // 策略1: 按 URL 精确匹配
            currentIndex = playlistManager.currentPlaylist.findIndex(
                song => song.url === currentUrl
            );
            
            // 策略2: 如果找不到，尝试按标题匹配（YouTube 歌曲 URL 可能被转换）
            if (currentIndex === -1 && currentTitle) {
                console.log('[删除歌曲] 标准 URL 匹配失败，尝试标题匹配...');
                currentIndex = playlistManager.currentPlaylist.findIndex(
                    song => (song.title || song.name) === currentTitle
                );
            }
            
            // 策略3: 如果仍未找到，假设当前播放的是列表第一首（最常见的自动播放情况）
            if (currentIndex === -1 && playlistManager.currentPlaylist.length > 0) {
                console.warn('[删除歌曲] ⚠️ URL 和标题都无法匹配，假设是列表第一首（可能是 YouTube URL 转换）');
                currentIndex = 0;
            }
            
            console.log('[删除歌曲] 最终匹配索引:', currentIndex);
            
            if (currentIndex !== -1) {
                const removedSong = playlistManager.currentPlaylist[currentIndex];
                console.log('[删除歌曲] 准备删除:', removedSong.title || removedSong.name);
                
                // 使用 PlaylistManager 的 removeAt 方法，它会自动重新加载播放列表
                const result = await playlistManager.removeAt(currentIndex);
                if (result.status === 'OK') {
                    console.log('[删除歌曲] ✓ 成功删除索引为', currentIndex, '的歌曲');
                    // 重新渲染UI确保界面立即更新
                    this.renderPlaylist();
                } else {
                    console.error('[删除歌曲] ✗ 删除失败:', result.error || result.message);
                }
            } else {
                console.error('[删除歌曲] ✗ 无法找到当前播放的歌曲，跳过删除');
            }
        } catch (err) {
            console.error('[删除歌曲错误]', err.message);
        }
    }

    // 简单防抖：将请求延迟 200ms，频繁触发只会发送最后一次
    _volumeDebounceTimer = null;
    setVolumeDebounced(value) {
        clearTimeout(this._volumeDebounceTimer);
        this._volumeDebounceTimer = setTimeout(() => {
            const form = new FormData();
            form.append('value', value);
            fetch('/volume', { method: 'POST', body: form }).catch(()=>{});
        }, 200);
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
        
        // 标签页内容映射
        const tabContents = {
            'local': this.elements.tree,
            'search': null    // 模态框
        };

        // 模态框映射
        const modals = {
            'search': document.getElementById('searchModal'),
            'debug': document.getElementById('debugModal')
        };
        const playlistsModal = document.getElementById('playlistsModal');

        // 导航历史栈
        // 保持导航栈为 app 实例属性，确保在外部回调也可访问
        this.navigationStack = this.navigationStack || ['playlists'];
        const navigationStack = this.navigationStack; // 局部引用（用于闭包）
         let currentModal = null; // 追踪当前打开的模态框
        
        // 获取当前栏目
        const getCurrentTab = () => navigationStack[navigationStack.length - 1];
        
        // 更新所有模态框的z-index，确保最后点击的在最上面
        const updateModalZIndex = () => {
            Object.values(modals).forEach(modal => {
                if (modal) {
                    modal.style.zIndex = '100';
                }
            });
            if (currentModal) {
                currentModal.style.zIndex = '1000';
            }
        };
        
        // 隐藏所有内容
        const hideAllContent = () => {
            // 隐藏所有tab内容
            Object.values(tabContents).forEach(tab => {
                if (tab) {
                    tab.classList.remove('tab-visible');
                    tab.style.display = 'none';
                }
            });
            
            // 隐藏所有模态框
            Object.values(modals).forEach(modal => {
                if (modal) {
                    modal.classList.remove('modal-visible');
                    modal.style.display = 'none';
                }
            });
            
            // 移除所有导航按钮的active状态
            navItems.forEach(item => item.classList.remove('active'));
            currentModal = null;
        };
        
        // 显示指定栏目
        const showTab = (tabName) => {
            console.log('📋 显示栏目:', tabName);
            
            // 关闭全屏播放器
            if (this.elements.fullPlayer && this.elements.fullPlayer.style.display !== 'none') {
                this.elements.fullPlayer.style.display = 'none';
                if (this.elements.miniPlayer) {
                    this.elements.miniPlayer.style.display = 'block';
                }
            }
            
            // 隐藏所有内容
            hideAllContent();
            
            // 激活对应的导航按钮
            const targetNavItem = Array.from(navItems).find(item => 
                item.getAttribute('data-tab') === tabName
            );
            if (targetNavItem) {
                targetNavItem.classList.add('active');
            }
            
            // 显示对应的内容
            if (tabName === 'playlists') {
                // ✅ 队列 - 直接打开歌单管理模态框
                if (playlistsModal) {
                    playlistsModal.style.display = 'block';
                    currentModal = playlistsModal;
                    setTimeout(() => {
                        playlistsModal.classList.add('modal-visible');
                        updateModalZIndex();
                    }, 10);
                    playlistsManagement.show();
                }
            } else if (tabName === 'local') {
                // 本地歌曲
                if (this.elements.tree) {
                    this.elements.tree.style.display = 'block';
                    setTimeout(() => {
                        this.elements.tree.classList.add('tab-visible');
                    }, 10);
                    localFiles.resetToRoot();
                }
            } else if (tabName === 'search') {
                // 搜索模态框
                const modal = modals.search;
                if (modal) {
                    modal.style.display = 'block';
                    currentModal = modal;
                    setTimeout(() => {
                        modal.classList.add('modal-visible');
                        updateModalZIndex();
                        const searchInput = document.getElementById('searchModalInput');
                        if (searchInput) {
                            searchInput.focus();
                        }
                    }, 10);
                }
            } else if (tabName === 'debug') {
                // 调试模态框
                const modal = modals.debug;
                if (modal) {
                    modal.style.display = 'flex';
                    currentModal = modal;
                    setTimeout(() => {
                        this.refreshDebugInfo();
                        updateModalZIndex();
                    }, 100);
                }
            }
        };
        
        // 导航到指定栏目
        const navigateTo = (tabName) => {
            const currentTab = getCurrentTab();
            
            // 如果点击当前栏目
            if (currentTab === tabName) {
                console.log('ℹ️ 已在当前栏目:', tabName);
                
                // 特殊处理：playlists 栏目被点击时，打开歌单管理模态框
                if (tabName === 'playlists') {
                    console.log('点击队列按钮，显示歌单管理页面');
                    // 隐藏播放列表容器
                    if (this.elements.playlist) {
                        this.elements.playlist.classList.remove('tab-visible');
                        this.elements.playlist.style.display = 'none';
                    }
                    // 显示歌单管理模态框
                    if (playlistsModal) {
                        playlistsModal.style.display = 'block';
                        currentModal = playlistsModal;
                        setTimeout(() => {
                            playlistsModal.classList.add('modal-visible');
                            updateModalZIndex();
                        }, 10);
                        playlistsManagement.show();
                    }
                    return;
                }
                
                // 其他栏目只更新z-index
                if (modals[tabName]) {
                    currentModal = modals[tabName];
                }
                updateModalZIndex();
                return;
            }
            
            // 添加到历史栈
            navigationStack.push(tabName);
            console.log('📚 导航栈:', navigationStack);
            
            // 显示栏目
            showTab(tabName);
        };
        
        // 返回上一个栏目
        const navigateBack = () => {
            // 如果栈中只有一个元素，不能再返回
            if (navigationStack.length <= 1) {
                console.log('ℹ️ 已是第一个栏目，无法返回');
                return;
            }
            
            // 弹出当前栏目
            navigationStack.pop();
            const previousTab = getCurrentTab();
            
            console.log('🔙 返回上一个栏目:', previousTab);
            console.log('📚 导航栈:', navigationStack);
            
            // 显示上一个栏目
            showTab(previousTab);
        };
        
        // 绑定导航项点击事件
        navItems.forEach((item, index) => {
            const tabName = item.getAttribute('data-tab');
            console.log(`📌 导航项${index}: data-tab="${tabName}"`);
            
            // 跳过没有 data-tab 属性的按钮
            if (!tabName) {
                console.log(`⏭️ 跳过 "${tabName}" 按钮（独立功能）`);
                return;
            }
            
            item.addEventListener('click', () => {
                console.log('🖱️ 点击导航项:', tabName);
                navigateTo(tabName);
            });
        });
        
        // 设置按钮点击处理
        const settingsBtn = document.getElementById('settingsNavBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                console.log('⚙️ 点击设置按钮');
                navigateTo('settings');
                hideAllContent();
                settingsBtn.classList.add('active');
                settingsManager.openPanel();
            });
        }
        
        // 修改设置管理器的关闭方法，添加恢复逻辑
        const originalClosePanel = settingsManager.closePanel;
        settingsManager.closePanel = function() {
            // 先调用原始关闭方法
            originalClosePanel.call(this);
            
            console.log('⚙️ 设置关闭，显示当前选择的歌单');
            
            // 移除设置按钮的active状态
            if (settingsBtn) settingsBtn.classList.remove('active');
            
            // ✅ 直接显示播放列表，而不是调用 navigateBack()
            setTimeout(() => {
                // 安全弹出导航栈（避免 navigationStack 未定义错误）
                try {
                    if (window.app && Array.isArray(window.app.navigationStack)) {
                        window.app.navigationStack.pop();
                    } else if (Array.isArray(navigationStack)) {
                        navigationStack.pop();
                    }
                } catch (e) { console.warn('[导航] 无法弹出 navigationStack:', e); }

                // 修复：settingsManager 的 this 不包含 UI 元素，使用全局 app.elements
                const appElements = (window.app && window.app.elements) || (typeof app !== 'undefined' && app.elements) || null;
                if (appElements && appElements.playlist) {
                    appElements.playlist.style.display = 'block';
                    setTimeout(() => {
                        appElements.playlist.classList.add('tab-visible');
                    }, 10);
                }
                if (appElements && appElements.tree) {
                    appElements.tree.classList.remove('tab-visible');
                    appElements.tree.style.display = 'none';
                }

                const playlistsNavBtn = navItems[0];
                if (playlistsNavBtn) {
                    playlistsNavBtn.classList.add('active');
                }
            }, 300);
        };
        
        // 初始化时显示"队列"模块
        const firstNavItem = navItems[0];
        if (firstNavItem) {
            firstNavItem.classList.add('active');
            
            // ✅ 【修复】初始化时只显示播放列表，不打开歌单管理模态框
            // 显示播放列表容器
            if (this.elements.playlist) {
                this.elements.playlist.style.display = 'block';
                setTimeout(() => {
                    this.elements.playlist.classList.add('tab-visible');
                }, 10);
            }
            
            // 隐藏本地文件
            if (this.elements.tree) {
                this.elements.tree.classList.remove('tab-visible');
                this.elements.tree.style.display = 'none';
            }
            
            // 隐藏所有模态框
            Object.values(modals).forEach(modal => {
                if (modal) {
                    modal.classList.remove('modal-visible');
                    modal.style.display = 'none';
                }
            });
            if (playlistsModal) {
                playlistsModal.classList.remove('modal-visible');
                playlistsModal.style.display = 'none';
            }
            
            // 【用户隔离】不再强制切换到 default，保持 initPlaylist() 中从 localStorage 恢复的歌单选择
            // 只渲染列表，不改变当前歌单ID
            this.renderPlaylist();
        }
        
        // 绑定本地歌曲关闭按钮
        this.setupLocalCloseButton(navItems, navigateBack);
        
        // 绑定模态框关闭事件
        this.setupModalClosing(playlistsModal, modals, navItems, navigateBack, updateModalZIndex);
    }

    // 切换标签页

    // 设置本地歌曲关闭按钮
    setupLocalCloseButton(navItems, navigateBack) {
        const localCloseBtn = document.getElementById('localCloseBtn');
        if (!localCloseBtn) return;
        
        localCloseBtn.addEventListener('click', () => {
            console.log('🔙 关闭本地歌曲页面，返回上一个栏目');
            
            // 隐藏本地歌曲页面
            if (this.elements.tree) {
                this.elements.tree.classList.remove('tab-visible');
                setTimeout(() => {
                    if (this.elements.tree) {
                        this.elements.tree.style.display = 'none';
                    }
                }, 300);
            }
            
            // 移除本地按钮的active状态
            navItems.forEach(item => {
                if (item.getAttribute('data-tab') === 'local') {
                    item.classList.remove('active');
                }
            });
            
            // 返回上一个栏目
            setTimeout(() => {
                navigateBack();
            }, 300);
        });
    }

    // 设置模态框关闭事件
    setupModalClosing(playlistsModal, modals, navItems, navigateBack, updateModalZIndex) {
        // 歌单模态框关闭 - 支持点击背景关闭
        if (playlistsModal) {
            playlistsModal.addEventListener('click', (e) => {
                if (e.target === playlistsModal) {
                    playlistsManagement.hide();
                    // 关闭时更新z-index
                    updateModalZIndex();
                    // 移除active状态
                    navItems.forEach(item => {
                        if (item.getAttribute('data-tab') === 'playlists') {
                            item.classList.remove('active');
                        }
                    });
                    // 返回上一个栏目
                    setTimeout(() => navigateBack(), 100);
                }
            });
            
            // 歌单模态框返回按钮
            const playlistsBackBtn = document.getElementById('playlistsBackBtn');
            if (playlistsBackBtn) {
                playlistsBackBtn.addEventListener('click', () => {
                    playlistsManagement.hide();
                    // 关闭时更新z-index
                    updateModalZIndex();
                    // 移除active状态
                    navItems.forEach(item => {
                        if (item.getAttribute('data-tab') === 'playlists') {
                            item.classList.remove('active');
                        }
                    });
                    // 返回上一个栏目
                    setTimeout(() => navigateBack(), 100);
                });
            }
        }

        // 调试模态框关闭 - 支持点击背景和关闭按钮
        const debugModal = modals.debug;
        if (debugModal) {
            debugModal.addEventListener('click', (e) => {
                if (e.target === debugModal) {
                    debugModal.style.display = 'none';
                    // 更新z-index
                    updateModalZIndex();
                    // 移除active状态
                    navItems.forEach(item => {
                        if (item.getAttribute('data-tab') === 'debug') {
                            item.classList.remove('active');
                        }
                    });
                    // ✅ 直接显示播放列表而不是调用navigateBack
                    setTimeout(() => {
                        navigationStack.pop();  // 弹出当前栏目
                        if (this.elements.playlist) {
                            this.elements.playlist.style.display = 'block';
                            setTimeout(() => {
                                this.elements.playlist.classList.add('tab-visible');
                            }, 10);
                        }
                        if (this.elements.tree) {
                            this.elements.tree.classList.remove('tab-visible');
                            this.elements.tree.style.display = 'none';
                        }
                        const playlistsNavBtn = navItems[0];
                        if (playlistsNavBtn) {
                            playlistsNavBtn.classList.add('active');
                        }
                    }, 100);
                }
            });
            
            const debugModalClose = document.getElementById('debugModalClose');
            if (debugModalClose) {
                debugModalClose.addEventListener('click', () => {
                    debugModal.style.display = 'none';
                    // 更新z-index
                    updateModalZIndex();
                    // 移除active状态
                    navItems.forEach(item => {
                        if (item.getAttribute('data-tab') === 'debug') {
                            item.classList.remove('active');
                        }
                    });
                    // ✅ 直接显示播放列表而不是调用navigateBack
                    setTimeout(() => {
                        navigationStack.pop();  // 弹出当前栏目
                        if (this.elements.playlist) {
                            this.elements.playlist.style.display = 'block';
                            setTimeout(() => {
                                this.elements.playlist.classList.add('tab-visible');
                            }, 10);
                        }
                        if (this.elements.tree) {
                            this.elements.tree.classList.remove('tab-visible');
                            this.elements.tree.style.display = 'none';
                        }
                        const playlistsNavBtn = navItems[0];
                        if (playlistsNavBtn) {
                            playlistsNavBtn.classList.add('active');
                        }
                    }, 100);
                });
            }
        }
        
        // 搜索栏目关闭时恢复之前的栏目
        const searchModal = modals.search;
        if (searchModal) {
            const searchModalBack = document.getElementById('searchModalBack');
            if (searchModalBack) {
                searchModalBack.addEventListener('click', () => {
                    console.log('🔍 搜索关闭，返回上一个栏目');
                    
                    // 移除样式
                    searchModal.classList.remove('modal-visible');
                    setTimeout(() => {
                        searchModal.style.display = 'none';
                        // 更新z-index
                        updateModalZIndex();
                    }, 300);
                    
                    // 移除active状态
                    navItems.forEach(item => {
                        if (item.getAttribute('data-tab') === 'search') {
                            item.classList.remove('active');
                        }
                    });
                    
                    // ✅ 直接显示播放列表而不是调用navigateBack
                    setTimeout(() => {
                        navigationStack.pop();  // 弹出当前栏目
                        if (this.elements.playlist) {
                            this.elements.playlist.style.display = 'block';
                            setTimeout(() => {
                                this.elements.playlist.classList.add('tab-visible');
                            }, 10);
                        }
                        if (this.elements.tree) {
                            this.elements.tree.classList.remove('tab-visible');
                            this.elements.tree.style.display = 'none';
                        }
                        const playlistsNavBtn = navItems[0];
                        if (playlistsNavBtn) {
                            playlistsNavBtn.classList.add('active');
                        }
                    }, 300);
                });
            }
        }
        
        // 初始化搜索功能
        searchManager.initUI(() => this.currentPlaylistId, async () => {
            await playlistManager.loadCurrent();
            this.renderPlaylist();
        });
        
        // 初始化调试面板
        this.initDebugPanel();
    }

    // 初始化调试面板
    initDebugPanel() {
        const debugRefresh = document.getElementById('debugRefresh');
        const debugClearLogs = document.getElementById('debugClearLogs');
        const debugLogToggle = document.getElementById('debugLogToggle');
        
        // 刷新按钮
        if (debugRefresh) {
            debugRefresh.addEventListener('click', () => {
                this.refreshDebugInfo();
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
    
   async refreshDebugInfo() {
        const debugPlayer = document.getElementById('debugPlayer');
        const debugPlaylist = document.getElementById('debugPlaylist');
        const debugStorage = document.getElementById('debugStorage');
        
        console.log('[DEBUG] refreshDebugInfo 开始...');
        console.log('debugPlayer:', debugPlayer);
        console.log('debugPlaylist:', debugPlaylist);
        console.log('debugStorage:', debugStorage);
        
        // 优先从本地 player 缓存获取状态，若不可用则主动调用后端 /status 拉取
        let status = null;
        try {
            if (player && typeof player.getStatus === 'function') {
                status = player.getStatus();
            }
        } catch (err) {
            console.warn('[DEBUG] player.getStatus() 报错:', err);
            status = null;
        }

        if (!status) {
            try {
                const res = await api.getStatus();
                // 后端返回 { status: "OK", ... }
                if (res && res.status === 'OK') {
                    // 兼容性：把后端字段直接当作 status 使用
                    status = res;
                    // 更新前端 player 缓存（如果有 updateStatus 方法）
                    try {
                        if (player && typeof player.updateStatus === 'function') {
                            player.updateStatus(status);
                        }
                    } catch (e) {
                        console.warn('[DEBUG] 更新 player 缓存失败:', e);
                    }
                } else {
                    status = null;
                }
            } catch (err) {
                console.warn('[DEBUG] api.getStatus() 失败:', err);
                status = null;
            }
        }
        
        if (debugPlayer) {
            if (status) {
                // 兼容后端不同字段名（mpv_state / mpv / mpv_state）
                const mpv = status.mpv || status.mpv_state || status.mpv_state || {};
                debugPlayer.innerHTML = `<pre style="margin: 0; color: #51cf66;">${JSON.stringify({
                    paused: mpv.paused ?? status.paused ?? false,
                    currentTime: mpv.time_pos ?? mpv.time ?? status.time_pos ?? 0,
                    duration: mpv.duration ?? status.duration ?? 0,
                    volume: mpv.volume ?? status.volume ?? 0,
                    loopMode: status.loop_mode ?? player?.loop_mode ?? 0,
                    currentSong: status.current_meta?.title || status.current_title || (status.current_meta && (status.current_meta.name || status.current_meta.title)) || 'N/A'
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
                    playlistLength: playlistManager.currentPlaylist?.length || (playlistManager.getCurrent()?.length || 0),
                    playlistCount: playlistManager.playlists?.length || (playlistManager.getAll?.()?.length || 0)
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
                storageInfo[key] = value && value.length > 200 ? value.substring(0, 200) + '...' : value;
            }
            debugStorage.innerHTML = `<pre style="margin: 0; color: #51cf66;">${JSON.stringify(storageInfo, null,  2)}</pre>`;
            console.log('[DEBUG] debugStorage 已更新');
        } else {
            console.warn('[DEBUG] debugStorage 元素不存在');
        }
    }

    // 更新推流状态
}

// ==========================================
// 应用启动
// ==========================================

// 创建全局应用实例
const app = new MusicPlayerApp();

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
    // 显式导出关键方法，确保可以被外部调用
    playSong: app.playSong.bind(app),
    renderPlaylist: app.renderPlaylist.bind(app),
    applyPlaylistTheme: app.applyPlaylistTheme.bind(app),
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

};

console.log('💡 模块化音乐播放器已加载');
console.log('💡 输入 app.diagnose.printHelp() 查看诊断命令');

console.log('💡 可通过 window.app.player、window.app.settingsManager 访问核心模块');
