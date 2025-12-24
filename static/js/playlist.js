// 播放列表管理模块
import { api } from './api.js';
import { Toast } from './ui.js';

export class PlaylistManager {
    constructor() {
        this.currentPlaylist = [];
        this.playlists = [];
        this.urlSet = new Set();
        this.currentPlaylistName = '当前播放列表'; // 添加歌单名称
        // ✅ 从 localStorage 恢复当前选择的歌单ID，默认为 'default'
        this.selectedPlaylistId = this._loadSelectedPlaylistFromStorage();
        console.log('[PlaylistManager] ✓ 初始化完成，selectedPlaylistId:', this.selectedPlaylistId);
        console.log('[PlaylistManager] ℹ localStorage 中的完整值:', localStorage.getItem('selectedPlaylistId'));
    }

    // ✅ 新增：从 localStorage 读取保存的歌单ID
    _loadSelectedPlaylistFromStorage() {
        try {
            const saved = localStorage.getItem('selectedPlaylistId');
            console.log('[PlaylistManager] localStorage中的值:', saved);
            if (saved && saved !== 'undefined' && saved !== '') {
                console.log('[歌单管理] 从本地存储恢复选择歌单:', saved);
                return saved;
            }
        } catch (e) {
            console.warn('[歌单管理] 读取 localStorage 失败:', e);
        }
        console.log('[歌单管理] 使用默认歌单: default');
        return 'default';
    }

    // 加载当前播放队列
    async loadCurrent() {
        const result = await api.getPlaylist();
        if (result.status === 'OK' && Array.isArray(result.playlist)) {
            this.currentPlaylist = result.playlist;
            this.currentPlaylistName = result.playlist_name || '当前播放列表'; // 获取歌单名称
            this.updateUrlSet();
            return result;
        }
        throw new Error('加载播放列表失败');
    }

    // 加载所有歌单
    async loadAll() {
        const result = await api.getPlaylists();
        if (result.status === 'OK') {
            this.playlists = result.playlists || [];
            return this.playlists;
        }
        throw new Error('加载歌单列表失败');
    }

    // 创建新歌单
    async create(name) {
        const result = await api.createPlaylist(name);
        await this.loadAll(); // 重新加载
        return result;
    }

    // 删除歌单
    async delete(id) {
        const result = await api.deletePlaylist(id);
        await this.loadAll(); // 重新加载
        // ✅ 如果删除的是当前选择的歌单，重置为 'default'
        if (this.selectedPlaylistId === id) {
            console.log('[歌单管理] 被删除的歌单是当前选择，重置为 default');
            this.setSelectedPlaylist('default');
        }
        return result;
    }

    // 更新歌单
    async update(id, data) {
        const result = await api.updatePlaylist(id, data);
        await this.loadAll(); // 重新加载
        return result;
    }

    // 切换歌单
    async switch(id) {
        const result = await api.switchPlaylist(id);
        await this.loadCurrent(); // 重新加载当前队列
        return result;
    }

    // ✅ 新增：设置当前选择的歌单（并保存到 localStorage）
    setSelectedPlaylist(playlistId) {
        this.selectedPlaylistId = playlistId;
        // 保存到 localStorage
        try {
            localStorage.setItem('selectedPlaylistId', playlistId);
            console.log('[歌单管理] 设置当前选择歌单:', playlistId, '(已保存到本地存储)');
        } catch (e) {
            console.warn('[歌单管理] 保存到 localStorage 失败:', e);
        }
        return this.selectedPlaylistId;
    }

    // ✅ 新增：获取当前选择的歌单ID
    getSelectedPlaylistId() {
        return this.selectedPlaylistId;
    }

    // 从当前播放列表删除指定索引的歌曲
    async removeAt(index) {
        const result = await api.removeFromPlaylist(index);
        if (result.status === 'OK') {
            await this.loadCurrent();
        }
        return result;
    }

    // 调整当前播放列表顺序
    async reorder(fromIndex, toIndex) {
        const result = await api.reorderPlaylist(fromIndex, toIndex);
        if (result.status === 'OK') {
            // 后端已更新，重新加载以保持一致
            await this.loadCurrent();
        }
        return result;
    }

    // 检查URL是否已存在
    hasUrl(url) {
        return this.urlSet.has(url);
    }

    // 更新URL集合
    updateUrlSet() {
        this.urlSet.clear();
        this.currentPlaylist.forEach(song => {
            if (song.url) {
                this.urlSet.add(song.url);
            }
        });
    }

    // 获取当前播放列表
    getCurrent() {
        return this.currentPlaylist;
    }

    // 获取当前歌单名称
    getCurrentName() {
        return this.currentPlaylistName;
    }

    // 获取所有歌单
    getAll() {
        return this.playlists;
    }
}

// 导出单例
export const playlistManager = new PlaylistManager();

// ✅ 点击歌曲：移动到队列顶部并播放
async function moveToTopAndPlay(song, currentIndex, onPlay, rerenderArgs) {
    try {
        const selectedPlaylistId = playlistManager.getSelectedPlaylistId();
        
        console.log('[播放列表] 点击歌曲，移动到顶部并播放:', {
            title: song.title,
            currentIndex: currentIndex,
            selectedPlaylistId: selectedPlaylistId
        });
        
        // 如果不是第一首，先移动到顶部
        if (currentIndex > 0) {
            const result = await api.reorderPlaylist(selectedPlaylistId, currentIndex, 0);
            if (result.status !== 'OK') {
                console.error('[播放列表] 移动失败:', result);
                Toast.error('移动失败');
                return;
            }
            console.log('[播放列表] ✓ 已移动到队列顶部');
        }
        
        // 刷新数据
        await playlistManager.loadCurrent();
        await playlistManager.loadAll();
        
        // 播放歌曲（现在已经在索引0）
        if (onPlay) {
            onPlay(song);
        }
        
        // 重新渲染列表
        if (rerenderArgs) {
            renderPlaylistUI(rerenderArgs);
        }
        
    } catch (error) {
        console.error('[播放列表] 操作失败:', error);
        Toast.error('操作失败: ' + error.message);
    }
}

// ✅ 新增：从当前选择歌单点击歌曲播放
export async function playSongFromSelectedPlaylist(song, onPlay) {
    try {
        const selectedPlaylistId = playlistManager.getSelectedPlaylistId();
        
        console.log('[播放列表] 从当前选择歌单点击歌曲:', {
            title: song.title,
            url: song.url,
            selectedPlaylistId: selectedPlaylistId
        });
        
        // ✅ 情况 A: 当前选择 === 默认歌单 → 直接播放
        if (selectedPlaylistId === 'default') {
            console.log('[播放列表] ✓ 当前选择是默认歌单，直接播放');
            if (onPlay) {
                onPlay(song);
            }
        } else {
            // ✅ 情况 B: 当前选择 ≠ 默认歌单 → 仅添加到默认歌单下一曲位置，不播放
            console.log('[播放列表] ⚠️ 当前选择不是默认歌单，添加到队列但不播放');
            
            // 获取默认歌单
            const defaultPlaylist = playlistManager.playlists.find(p => p.id === 'default');
            if (!defaultPlaylist) {
                Toast.error('默认歌单不存在');
                return;
            }
            
            // 检查歌曲是否已在默认歌单
            const songExists = defaultPlaylist.songs.some(s => s.url === song.url);
            
            if (!songExists) {
                console.log('[播放列表] 歌曲不在默认歌单，添加到下一曲位置');
                
                // 计算插入位置
                const currentIndex = defaultPlaylist.current_playing_index ?? -1;
                const insertIndex = Math.max(0, currentIndex + 1);
                
                console.log('[播放列表] 计算插入位置:', {
                    currentIndex: currentIndex,
                    insertIndex: insertIndex
                });
                
                // 调用 API 添加到默认歌单
                const result = await api.addToPlaylist({
                    playlist_id: 'default',
                    song: song,
                    insert_index: insertIndex
                });
                
                if (result.status !== 'OK') {
                    Toast.error('添加失败: ' + result.error);
                    return;
                }
                
                console.log('[播放列表] ✓ 已添加到默认歌单下一曲位置');
            } else {
                console.log('[播放列表] 歌曲已在默认歌单，跳过添加');
            }
            
            // 通知用户，但不播放
            Toast.success(`✅ 已添加 "${song.title}" 到队列`);
            console.log('[播放列表] ⚠️ 歌曲已添加，但未播放（非默认歌单）');
        }
        
    } catch (error) {
        console.error('[播放列表] 播放错误:', error);
        Toast.error('操作失败: ' + error.message);
    }
}

// UI 渲染：当前播放列表
export function renderPlaylistUI({ container, titleEl, onPlay, currentMeta }) {
    if (!container) return;

    const selectedPlaylistId = playlistManager.getSelectedPlaylistId();
    
    // ✅ 根据当前选择的歌单ID，获取对应的歌单数据
    let playlist = [];
    let playlistName = '当前播放列表';
    
    if (selectedPlaylistId === 'default') {
        // 显示默认歌单（当前播放队列）
        playlist = playlistManager.getCurrent();
        playlistName = playlistManager.getCurrentName();
    } else {
        // 显示用户选择的非默认歌单
        const selectedPlaylist = playlistManager.playlists.find(p => p.id === selectedPlaylistId);
        if (selectedPlaylist) {
            playlist = selectedPlaylist.songs || [];
            playlistName = selectedPlaylist.name || '未命名歌单';
            console.log('[渲染列表] 显示非默认歌单:', selectedPlaylistId, '名称:', playlistName);
        } else {
            console.warn('[渲染列表] 找不到歌单:', selectedPlaylistId, '，回退到默认歌单');
            playlist = playlistManager.getCurrent();
            playlistName = playlistManager.getCurrentName();
        }
    }

    if (titleEl) {
        let titleText = playlistName;
        // ✅ 如果当前选择不是默认歌单，添加标识
        if (selectedPlaylistId !== 'default') {
            titleText += ' (当前选择)';
        }
        titleEl.textContent = titleText;
    }

    // 更新歌曲数量显示
    const countEl = document.getElementById('playListCount');
    if (countEl) {
        countEl.textContent = `${playlist.length} 首歌曲`;
    }

    container.innerHTML = '';

    if (!playlist || playlist.length === 0) {
        container.innerHTML = `
            <div class="playlist-empty">暂无歌曲</div>
        `;
        return;
    }

    // 获取当前播放歌曲的URL（用于匹配）
    // 对于本地文件使用 rel，对于 YouTube 使用 raw_url
    const currentPlayingUrl = currentMeta?.rel || currentMeta?.raw_url || currentMeta?.url || null;

    // 播放队列列表 - 统一样式
    playlist.forEach((song, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-track-item';
        
        // 根据URL匹配当前播放的歌曲，而不是简单地标记第一首
        const isCurrentPlaying = currentPlayingUrl && song.url === currentPlayingUrl;
        
        if (isCurrentPlaying) {
            item.classList.add('current-playing');
            
            // 添加垂直进度条
            const progressBar = document.createElement('div');
            progressBar.className = 'track-progress-bar';
            progressBar.innerHTML = '<div class="track-progress-fill" id="currentTrackProgress"></div>';
            item.appendChild(progressBar);
        }
        
        item.dataset.index = index;

        // 为本地歌曲生成封面URL
        let coverUrl = song.thumbnail_url || '';
        if (!coverUrl && song.type !== 'youtube' && song.url) {
            // 本地歌曲：使用 /cover/ 接口获取封面
            coverUrl = `/cover/${encodeURIComponent(song.url)}`;
        }

        const cover = document.createElement('div');
        cover.className = 'track-cover';
        cover.innerHTML = `
            <img src="${coverUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="track-cover-placeholder">🎵</div>
        `;

        // 左侧：cover + type
        const leftContainer = document.createElement('div');
        leftContainer.className = 'track-left';
        
        const typeEl = document.createElement('div');
        typeEl.className = 'track-type';
        const songType = song.type === 'youtube' ? 'YouTube' : '本地音乐';
        typeEl.textContent = songType;
        
        leftContainer.appendChild(cover);
        leftContainer.appendChild(typeEl);

        // 中间：title + meta
        const info = document.createElement('div');
        info.className = 'track-info';
        
        const songTitleEl = document.createElement('div');
        songTitleEl.className = 'track-title';
        songTitleEl.textContent = song.title || '未知歌曲';
        
        const metaEl = document.createElement('div');
        metaEl.className = 'track-meta';
        
        if (isCurrentPlaying) {
            const playlistNameEl = document.createElement('div');
            playlistNameEl.className = 'track-playlist-name';
            playlistNameEl.textContent = playlistName;
            metaEl.appendChild(playlistNameEl);
        } else {
            const playlistNameEl = document.createElement('div');
            playlistNameEl.className = 'track-playlist-name';
            playlistNameEl.textContent = playlistName;
            metaEl.appendChild(playlistNameEl);
        }
        
        info.appendChild(songTitleEl);
        info.appendChild(metaEl);

        // 右侧：删除按钮或序列号
        if (isCurrentPlaying) {
            item.appendChild(leftContainer);
            item.appendChild(info);

            // 序列号放在右下角，与类型垂直对齐
            const seqEl = document.createElement('div');
            seqEl.className = 'track-seq';
            seqEl.textContent = `${index + 1}/${playlist.length}`;
            item.appendChild(seqEl);
        } else {
            // 添加拖拽手柄（移动端触摸拖拽）
            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="5" r="2"/>
                    <circle cx="15" cy="5" r="2"/>
                    <circle cx="9" cy="12" r="2"/>
                    <circle cx="15" cy="12" r="2"/>
                    <circle cx="9" cy="19" r="2"/>
                    <circle cx="15" cy="19" r="2"/>
                </svg>
            `;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'track-menu-btn';
            deleteBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                </svg>
            `;
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`确定删除《${song.title}》吗？`)) {
                    try {
                        await playlistManager.removeAt(index);
                        Toast.success('已删除');
                        renderPlaylistUI({ container, titleEl, onPlay, currentMeta });
                    } catch (err) {
                        Toast.error('删除失败');
                    }
                }
            });
            
            item.appendChild(leftContainer);
            item.appendChild(info);
            item.appendChild(deleteBtn);
            item.appendChild(dragHandle);
        }

        item.addEventListener('click', async (e) => {
            // 如果点击的是拖拽手柄，不触发播放
            if (e.target.closest('.drag-handle')) return;
            // 如果点击的是删除按钮，不触发播放
            if (e.target.closest('.track-menu-btn')) return;
            
            // 如果点击的是当前正在播放的歌曲，打开全屏播放器
            if (isCurrentPlaying) {
                const fullPlayer = document.getElementById('fullPlayer');
                if (fullPlayer) {
                    fullPlayer.style.display = 'flex';
                    setTimeout(() => {
                        fullPlayer.classList.add('show');
                    }, 10);
                }
                return;
            }
            
            // ✅ 点击歌曲：移动到队列顶部并播放
            await moveToTopAndPlay(song, index, onPlay, { container, titleEl, onPlay, currentMeta });
        });

        container.appendChild(item);
    });

    // 初始化触摸拖拽排序
    initTouchDragSort(container, renderPlaylistUI, { container, titleEl, onPlay, currentMeta });
}

// 触摸拖拽排序 - 移动端优化
function initTouchDragSort(container, rerenderFn, rerenderArgs) {
    let draggedItem = null;
    let draggedIndex = -1;
    let placeholder = null;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isDragging = false;
    let longPressTimer = null;
    const LONG_PRESS_DURATION = 300; // 长按300ms触发拖拽
    const DRAG_THRESHOLD = 10; // 拖拽阈值（像素）

    // 创建占位符
    function createPlaceholder() {
        const el = document.createElement('div');
        el.className = 'drag-placeholder';
        return el;
    }

    // 获取拖拽手柄
    container.querySelectorAll('.drag-handle').forEach((handle, idx) => {
        const item = handle.closest('.playlist-track-item');
        if (!item) return;

        // 触摸开始
        handle.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            draggedItem = item;
            draggedIndex = parseInt(item.dataset.index);

            // 长按检测
            longPressTimer = setTimeout(() => {
                startDrag(e);
            }, LONG_PRESS_DURATION);
        }, { passive: false });

        // 触摸移动
        handle.addEventListener('touchmove', (e) => {
            if (!draggedItem) return;

            const touch = e.touches[0];
            const moveDistance = Math.abs(touch.clientY - touchStartY);

            // 如果移动距离超过阈值，立即开始拖拽
            if (!isDragging && moveDistance > DRAG_THRESHOLD) {
                clearTimeout(longPressTimer);
                startDrag(e);
            }

            if (isDragging) {
                e.preventDefault();
                moveDrag(e);
            }
        }, { passive: false });

        // 触摸结束
        handle.addEventListener('touchend', (e) => {
            clearTimeout(longPressTimer);
            if (isDragging) {
                endDrag(e);
            }
            resetDragState();
        });

        // 触摸取消
        handle.addEventListener('touchcancel', () => {
            clearTimeout(longPressTimer);
            cancelDrag();
            resetDragState();
        });
    });

    function startDrag(e) {
        if (isDragging || !draggedItem) return;
        isDragging = true;

        // 添加拖拽中样式
        draggedItem.classList.add('dragging');
        document.body.style.overflow = 'hidden'; // 禁止滚动

        // 创建占位符
        placeholder = createPlaceholder();
        placeholder.style.height = draggedItem.offsetHeight + 'px';
        draggedItem.parentNode.insertBefore(placeholder, draggedItem);

        // 设置拖拽元素样式
        const rect = draggedItem.getBoundingClientRect();
        draggedItem.style.position = 'fixed';
        draggedItem.style.left = rect.left + 'px';
        draggedItem.style.top = rect.top + 'px';
        draggedItem.style.width = rect.width + 'px';
        draggedItem.style.zIndex = '9999';

        // 触觉反馈（如果支持）
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    function moveDrag(e) {
        if (!isDragging || !draggedItem) return;

        const touch = e.touches[0];
        const deltaY = touch.clientY - touchStartY;
        
        // 移动拖拽元素
        const originalTop = parseFloat(draggedItem.dataset.originalTop || draggedItem.style.top);
        if (!draggedItem.dataset.originalTop) {
            draggedItem.dataset.originalTop = draggedItem.style.top;
        }
        draggedItem.style.top = (parseFloat(draggedItem.dataset.originalTop) + deltaY) + 'px';

        // 检测放置位置
        const items = Array.from(container.querySelectorAll('.playlist-track-item:not(.dragging)'));
        let insertBefore = null;
        
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            
            if (touch.clientY < midY) {
                insertBefore = item;
                break;
            }
        }

        // 移动占位符
        if (insertBefore && insertBefore !== placeholder.nextSibling) {
            container.insertBefore(placeholder, insertBefore);
        } else if (!insertBefore && placeholder.nextSibling) {
            container.appendChild(placeholder);
        }
    }

    async function endDrag(e) {
        if (!isDragging || !draggedItem || !placeholder) return;

        // 计算新位置
        const items = Array.from(container.querySelectorAll('.playlist-track-item:not(.dragging)'));
        let newIndex = items.indexOf(placeholder.nextSibling ? 
            items.find(item => item === placeholder.nextSibling) : null);
        
        if (newIndex === -1) {
            newIndex = items.length;
        }
        
        // 调整索引（考虑占位符位置）
        const placeholderIndex = Array.from(container.children).indexOf(placeholder);
        const draggedItemOriginalIndex = draggedIndex;
        
        // 计算实际的新索引
        let actualNewIndex = 0;
        const allChildren = Array.from(container.children);
        for (let i = 0; i < allChildren.length; i++) {
            if (allChildren[i] === placeholder) {
                actualNewIndex = i;
                break;
            }
        }
        
        // 移除占位符，恢复拖拽元素
        placeholder.remove();
        draggedItem.classList.remove('dragging');
        draggedItem.style.position = '';
        draggedItem.style.left = '';
        draggedItem.style.top = '';
        draggedItem.style.width = '';
        draggedItem.style.zIndex = '';
        delete draggedItem.dataset.originalTop;

        // 如果位置变化了，调用 API 更新顺序
        if (actualNewIndex !== draggedItemOriginalIndex) {
            try {
                const selectedPlaylistId = playlistManager.getSelectedPlaylistId();
                const result = await api.reorderPlaylist(selectedPlaylistId, draggedItemOriginalIndex, actualNewIndex);
                
                if (result.status === 'OK') {
                    Toast.success('已调整顺序');
                    // 先刷新数据，再重新渲染列表
                    await playlistManager.loadCurrent();
                    await playlistManager.loadAll();
                    rerenderFn(rerenderArgs);
                } else {
                    Toast.error('调整失败: ' + (result.error || result.message));
                    await playlistManager.loadCurrent();
                    await playlistManager.loadAll();
                    rerenderFn(rerenderArgs);
                }
            } catch (err) {
                console.error('调整顺序失败:', err);
                Toast.error('调整失败');
                await playlistManager.loadCurrent();
                await playlistManager.loadAll();
                rerenderFn(rerenderArgs);
            }
        }
    }

    function cancelDrag() {
        if (placeholder) {
            placeholder.remove();
        }
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem.style.position = '';
            draggedItem.style.left = '';
            draggedItem.style.top = '';
            draggedItem.style.width = '';
            draggedItem.style.zIndex = '';
            delete draggedItem.dataset.originalTop;
        }
    }

    function resetDragState() {
        draggedItem = null;
        draggedIndex = -1;
        placeholder = null;
        isDragging = false;
        document.body.style.overflow = '';
    }
}

// 兼容性导出，确保可被按名导入
export { renderPlaylistUI as playlistRenderer };
