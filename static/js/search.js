// 搜索功能模块
import { api } from './api.js';
import { Toast, formatTime } from './ui.js';
import { buildTrackItemHTML } from './templates.js';

export class SearchManager {
    constructor() {
        this.searchHistory = [];
        this.maxHistory = 20;
        this.searchTimeout = null;
        this.currentPlaylistId = 'default';
        this.lastQuery = '';
        this.isSearching = false;
        this.lastSearchAt = 0;
        this.minInterval = 800; // ms, 降低频率防止抖动
        this.lastSavedQuery = '';
        this.lastSavedAt = 0;
        this.saveInterval = 3000; // ms, 降低输入记录频率
        this.loadHistory();
    }

    // 初始化搜索UI
    initUI(currentPlaylistIdGetter, refreshPlaylistCallback) {
        this.getCurrentPlaylistId = currentPlaylistIdGetter;
        this.refreshPlaylist = refreshPlaylistCallback;
        
        const searchModalBack = document.getElementById('searchModalBack');
        const searchModal = document.getElementById('searchModal');
        const searchModalInput = document.getElementById('searchModalInput');
        const searchModalBody = document.getElementById('searchModalBody');
        const searchModalHistory = document.getElementById('searchModalHistory');
        const searchModalHistoryList = document.getElementById('searchModalHistoryList');
        const searchModalHistoryClear = document.getElementById('searchModalHistoryClear');
        
        if (searchModalBack && searchModal) {
            const closeAndRefresh = async () => {
                console.log('🔍 搜索关闭');
                
                // 移除搜索栏目的active状态和样式
                searchModal.classList.remove('modal-visible');
                setTimeout(() => {
                    searchModal.style.display = 'none';
                }, 300);
                
                const navItems = document.querySelectorAll('.nav-item');
                const searchNavItem = Array.from(navItems).find(item => item.getAttribute('data-tab') === 'search');
                if (searchNavItem) {
                    searchNavItem.classList.remove('active');
                }
                
                // 延迟后返回到当前选择的歌单（只刷新显示，不改变选择）
                setTimeout(() => {
                    // ✅ 仅刷新播放列表显示，保持当前选择的歌单
                    if (this.refreshPlaylist) {
                        this.refreshPlaylist();
                    } else {
                        document.dispatchEvent(new CustomEvent('playlist:refresh'));
                    }
                    
                    // ✅ 显示歌单区域（不点击队列按钮，这样能保持当前选择的歌单）
                    const playlistsNavItem = Array.from(navItems).find(item => item.getAttribute('data-tab') === 'playlists');
                    if (playlistsNavItem && !playlistsNavItem.classList.contains('active')) {
                        playlistsNavItem.classList.add('active');
                    }
                    // 显示歌单容器
                    const playlistEl = document.getElementById('playlist');
                    if (playlistEl) {
                        playlistEl.style.display = 'flex';
                    }
                }, 300);
            };

            searchModalBack.addEventListener('click', closeAndRefresh);
            
            // 点击背景关闭
            const searchModalOverlay = searchModal.querySelector('.search-modal-overlay');
            if (searchModalOverlay) {
                searchModalOverlay.addEventListener('click', closeAndRefresh);
            }
        }
        
        // 搜索功能实现
        if (searchModalInput && searchModalBody) {
            // 实时搜索
            searchModalInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                
                // 清除之前的定时器
                if (this.searchTimeout) {
                    clearTimeout(this.searchTimeout);
                }
                
                // 如果输入为空，显示搜索历史
                if (!query) {
                    this.showSearchHistory();
                    return;
                }
                
                // 延迟搜索（防抖）
                this.searchTimeout = setTimeout(async () => {
                    await this.performSearch(query);
                }, 3000);
            });
            
            // 按下回车搜索
            searchModalInput.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    const query = e.target.value.trim();
                    if (query) {
                        if (this.searchTimeout) {
                            clearTimeout(this.searchTimeout);
                        }
                        await this.performSearch(query);
                    }
                }
            });
            
            // 聚焦时显示搜索历史
            searchModalInput.addEventListener('focus', () => {
                if (!searchModalInput.value.trim()) {
                    this.showSearchHistory();
                }
            });
        }
        
        // 清空搜索历史
        if (searchModalHistoryClear) {
            searchModalHistoryClear.addEventListener('click', () => {
                this.clearHistory();
                this.showSearchHistory();
            });
        }
    }

    // 显示搜索历史
    showSearchHistory() {
        const searchModalHistory = document.getElementById('searchModalHistory');
        const searchModalHistoryList = document.getElementById('searchModalHistoryList');
        const searchModalBody = document.getElementById('searchModalBody');
        
        if (!searchModalHistory || !searchModalHistoryList || !searchModalBody) return;
        
        const history = this.getHistory();
        
        if (history.length === 0) {
            searchModalHistory.style.display = 'none';
            searchModalBody.innerHTML = '<div class="search-empty-state"><div class="search-empty-icon">🔍</div><p class="search-empty-text">输入关键词搜索歌曲</p></div>';
            return;
        }
        
        searchModalHistory.style.display = 'block';
        searchModalBody.innerHTML = '';
        
        // 创建历史记录标题
        const title = `最近搜索 <span class="search-history-count">(${history.length})</span>`;
        
        searchModalHistoryList.innerHTML = `
            <div class="search-history-header">${title}</div>
            ${history.map(item => `
                <div class="search-history-item">
                    <div class="search-history-icon">🔍</div>
                    <span class="search-history-text" data-query="${item}">${item}</span>
                    <button class="search-history-delete" data-query="${item}" title="删除此搜索">×</button>
                </div>
            `).join('')}
        `;
        
        // 绑定历史记录点击事件
        searchModalHistoryList.querySelectorAll('.search-history-text').forEach(el => {
            el.addEventListener('click', async () => {
                const query = el.getAttribute('data-query');
                const searchModalInput = document.getElementById('searchModalInput');
                if (searchModalInput) {
                    searchModalInput.value = query;
                }
                await this.performSearch(query);
            });
        });
        
        // 绑定删除按钮
        searchModalHistoryList.querySelectorAll('.search-history-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const query = el.getAttribute('data-query');
                this.removeFromHistory(query);
                this.showSearchHistory();
            });
        });
    }

    // 执行搜索
    async performSearch(query) {
        const searchModalBody = document.getElementById('searchModalBody');
        const searchModalHistory = document.getElementById('searchModalHistory');
        
        if (!searchModalBody) return;

        const now = Date.now();
        if (this.isSearching) return; // 正在搜索时不叠加
        if (query === this.lastQuery && now - this.lastSearchAt < this.minInterval) {
            return; // 相同关键词过快重复输入，直接忽略
        }
        this.lastQuery = query;
        this.lastSearchAt = now;
        this.isSearching = true;
        
        try {
            // 隐藏搜索历史
            if (searchModalHistory) {
                searchModalHistory.style.display = 'none';
            }
            
            // 显示加载状态
            searchModalBody.innerHTML = '<div style="padding: 40px; text-align: center; color: #888;">🔍 搜索中...</div>';
            
            // 调用搜索API
            const result = await this.search(query);
            
            if (!result || result.status !== 'OK') {
                throw new Error(result?.error || '搜索失败');
            }
            
            const localResults = result.local || [];
            const youtubeResults = result.youtube || [];
            
            // 渲染搜索结果
            this.renderSearchResults(localResults, youtubeResults);
            
        } catch (error) {
            console.error('搜索失败:', error);
            searchModalBody.innerHTML = `<div style="padding: 40px; text-align: center; color: #f44;">搜索失败: ${error.message}</div>`;
        } finally {
            this.isSearching = false;
            this.lastSearchAt = Date.now();
        }
    }

    // 渲染搜索结果
    renderSearchResults(localResults, youtubeResults) {
        const searchModalBody = document.getElementById('searchModalBody');
        if (!searchModalBody) return;

        const buildList = (items, type) => {
            if (!items || items.length === 0) {
                return '<div class="search-empty">暂无结果</div>';
            }
            return items.map(song => {
                const meta = type === 'local'
                    ? (song.url || '未知位置')
                    : (song.duration ? formatTime(song.duration) : '未知时长');
                return buildTrackItemHTML({
                    song,
                    type,
                    metaText: meta,
                    actionButtonClass: 'track-menu-btn search-result-add',
                    actionButtonIcon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
                });
            }).join('');
        };

        const defaultTab = localResults.length > 0 ? 'local' : 'youtube';

        searchModalBody.innerHTML = `
            <div class="search-tabs">
                <button class="search-tab ${defaultTab === 'local' ? 'active' : ''}" data-tab="local">本地 (${localResults.length})</button>
                <button class="search-tab ${defaultTab === 'youtube' ? 'active' : ''}" data-tab="youtube">网络 (${youtubeResults.length})</button>
            </div>
            <div class="search-tab-panels">
                <div class="search-results-panel ${defaultTab === 'local' ? 'active' : ''}" data-panel="local">
                    ${buildList(localResults, 'local')}
                </div>
                <div class="search-results-panel ${defaultTab === 'youtube' ? 'active' : ''}" data-panel="youtube">
                    ${buildList(youtubeResults, 'youtube')}
                </div>
            </div>
        `;

        const tabs = searchModalBody.querySelectorAll('.search-tab');
        const panels = searchModalBody.querySelectorAll('.search-results-panel');

        const setActive = (tabName) => {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
            panels.forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));
        };

        tabs.forEach(tab => {
            tab.addEventListener('click', () => setActive(tab.dataset.tab));
        });

        // 绑定添加按钮
        searchModalBody.querySelectorAll('.search-result-add').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = e.target.closest('.search-result-item');
                const songData = {
                    url: item.getAttribute('data-url'),
                    title: item.getAttribute('data-title'),
                    type: item.getAttribute('data-type'),
                    thumbnail_url: item.getAttribute('data-thumbnail_url') || ''
                };
                
                try {
                    const playlistId = this.getCurrentPlaylistId ? this.getCurrentPlaylistId() : this.currentPlaylistId;
                    const response = await fetch('/playlist_add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            playlist_id: playlistId,
                            song: songData
                        })
                    });
                    
                    if (response.ok) {
                        Toast.success(`已添加: ${songData.title}`);
                        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
                        btn.disabled = true;
                        
                        // 刷新播放列表显示
                        if (this.refreshPlaylist) {
                            await this.refreshPlaylist();
                        } else {
                            document.dispatchEvent(new CustomEvent('playlist:refresh'));
                        }
                    } else {
                        const error = await response.json();
                        // 重复歌曲使用警告提示
                        if (error.duplicate) {
                            Toast.warning(`${songData.title} 已在播放列表中`);
                        } else {
                            throw new Error(error.error || '添加失败');
                        }
                    }
                } catch (error) {
                    console.error('添加歌曲失败:', error);
                    Toast.error('添加失败');
                }
            });
        });
    }

    // 搜索歌曲
    async search(query) {
        if (!query || !query.trim()) {
            throw new Error('搜索关键词不能为空');
        }

        try {
            const result = await api.searchSong(query.trim());
            this.addToHistory(query.trim());
            return result;
        } catch (error) {
            console.error('搜索失败:', error);
            throw error;
        }
    }

    // 添加到搜索历史
    addToHistory(query) {
        const now = Date.now();
        if (query === this.lastSavedQuery && now - this.lastSavedAt < this.saveInterval) {
            return; // 同一关键词短时间内不重复写入
        }
        // 移除重复项
        this.searchHistory = this.searchHistory.filter(item => item !== query);
        
        // 添加到开头
        this.searchHistory.unshift(query);
        
        // 限制历史记录数量
        if (this.searchHistory.length > this.maxHistory) {
            this.searchHistory = this.searchHistory.slice(0, this.maxHistory);
        }
        
        this.saveHistory();
        this.lastSavedQuery = query;
        this.lastSavedAt = now;
    }

    // 获取搜索历史
    getHistory() {
        return this.searchHistory;
    }

    // 清除搜索历史
    clearHistory() {
        this.searchHistory = [];
        this.saveHistory();
    }

    // 从本地存储加载历史
    loadHistory() {
        try {
            const saved = localStorage.getItem('search_history');
            if (saved) {
                this.searchHistory = JSON.parse(saved);
            }
        } catch (error) {
            console.error('加载搜索历史失败:', error);
            this.searchHistory = [];
        }
    }

    // 保存历史到本地存储
    saveHistory() {
        try {
            localStorage.setItem('search_history', JSON.stringify(this.searchHistory));
        } catch (error) {
            console.error('保存搜索历史失败:', error);
        }
    }

    // 删除单条历史记录
    removeFromHistory(query) {
        this.searchHistory = this.searchHistory.filter(item => item !== query);
        this.saveHistory();
    }
}

// 导出单例
export const searchManager = new SearchManager();
