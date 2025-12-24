import { Toast } from './ui.js';

// 当前导航路径
let currentNavPath = [];

// 防抖：记录正在添加的歌曲
const pendingAdds = new Set();

// 获取目录的封面URL（使用目录中第一个歌曲的封面）
const getDirCoverUrl = (dir) => {
    // 优先使用目录中的第一个文件
    if (dir.files && dir.files.length > 0) {
        return `/cover/${encodeURIComponent(dir.files[0].rel)}`;
    }
    // 或者递归查找子目录中的第一个文件
    if (dir.dirs && dir.dirs.length > 0) {
        for (const subDir of dir.dirs) {
            const url = getDirCoverUrl(subDir);
            if (url) return url;
        }
    }
    return '';
};

// 统计目录中的文件数量
const countFiles = (dir) => {
    let count = (dir.files || []).length;
    (dir.dirs || []).forEach(subDir => {
        count += countFiles(subDir);
    });
    return count;
};

// 根据路径获取节点
const getNodeByPath = (root, path) => {
    let node = root;
    for (const dirName of path) {
        if (!node || !node.dirs) return null;
        node = node.dirs.find(d => d.name === dirName);
        if (!node) return null;
    }
    return node;
};

// 构建面包屑导航HTML
const buildBreadcrumbHTML = (path) => {
    let html = '<div class="local-breadcrumb">';
    html += '<span class="breadcrumb-home" data-nav-to="root">🏠 本地歌曲</span>';
    
    path.forEach((name, index) => {
        const navPath = path.slice(0, index + 1).join('/');
        html += `<span class="breadcrumb-sep">›</span>`;
        html += `<span class="breadcrumb-item" data-nav-to="${navPath}">${name}</span>`;
    });
    
    html += '</div>';
    return html;
};

// 构建当前目录内容HTML
const buildCurrentDirHTML = (node, path) => {
    let html = '';
    
    // 如果有路径，始终显示面包屑导航（包括空目录时）
    if (path.length > 0) {
        html += buildBreadcrumbHTML(path);
    }

    if (!node) {
        return html + '<div class="local-empty">暂无本地文件</div>';
    }

    const dirs = node.dirs || [];
    const files = node.files || [];

    if (!dirs.length && !files.length) {
        return html + '<div class="local-empty">此目录为空</div>';
    }

    // 子目录 - 使用专辑卡片方式展示
    if (dirs.length > 0) {
        html += '<div class="local-album-grid">';
        dirs.forEach(dir => {
            const coverUrl = getDirCoverUrl(dir);
            const fileCount = countFiles(dir);
            
            html += `
                <div class="local-album-card" data-dir-name="${dir.name}">
                    <div class="local-album-cover">
                        ${coverUrl ? `<img src="${coverUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" loading="lazy" />` : ''}
                        <div class="local-album-cover-placeholder" ${coverUrl ? '' : 'style="display:flex"'}>📁</div>
                    </div>
                    <div class="local-album-info">
                        <div class="local-album-title">${dir.name}</div>
                        <div class="local-album-count">${fileCount} 首歌曲</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // 文件项 - 使用播放列表样式展示
    if (files.length > 0) {
        html += '<div class="local-songs-list">';
        files.forEach((file, index) => {
            const coverUrl = `/cover/${encodeURIComponent(file.rel)}`;
            html += buildSongItemHTML(file, coverUrl, index + 1);
        });
        html += '</div>';
    }

    return html;
};

// 构建歌曲项HTML（播放列表样式）
const buildSongItemHTML = (file, coverUrl, seq) => {
    return `
        <div class="playlist-track-item local-song-item" data-file-path="${file.rel}" data-file-name="${file.name}">
            <div class="track-left">
                <div class="track-cover">
                    <img src="${coverUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" loading="lazy" />
                    <div class="track-cover-placeholder">🎵</div>
                </div>
                <div class="track-type">本地音乐</div>
            </div>
            <div class="track-info">
                <div class="track-title">${file.name}</div>
            </div>
            <div class="track-seq">${seq}</div>
        </div>
    `;
};

// 保持原来的函数名用于兼容性
const buildFileCardsHTML = (node, path = []) => {
    return buildCurrentDirHTML(node, path);
};

export const localFiles = {
    treeEl: null,
    contentEl: null,
    searchInput: null,
    getPlaylistId: () => 'default',
    fullTree: null,
    searchQuery: '',
    onSongAdded: null,

    async init({ treeEl, getCurrentPlaylistId, onSongAdded }) {
        this.treeEl = treeEl;
        this.contentEl = treeEl.querySelector('#localContent');
        this.searchInput = treeEl.querySelector('#localSearchInput');
        this.onSongAdded = onSongAdded;
        
        if (typeof getCurrentPlaylistId === 'function') {
            this.getPlaylistId = getCurrentPlaylistId;
        }
        
        // 绑定搜索输入事件
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderCurrentLevel();
            });
        }
        
        await this.loadTree();
    },

    async loadTree() {
        if (!this.contentEl) return;
        try {
            const response = await fetch('/tree');
            if (!response.ok) {
                console.warn('获取本地文件树失败');
                return;
            }

            const data = await response.json();
            if (data.status === 'OK' && data.tree) {
                this.fullTree = data.tree;
                currentNavPath = [];
                this.renderCurrentLevel();
            } else {
                this.contentEl.innerHTML = '<div class="local-empty">暂无本地文件</div>';
            }
        } catch (error) {
            console.error('加载本地文件树失败:', error);
        }
    },

    getCurrentNode() {
        return getNodeByPath(this.fullTree, currentNavPath);
    },

    filterNode(node, query) {
        if (!node || !query) {
            return node;
        }
        
        const filteredDirs = (node.dirs || []).filter(dir => {
            if (dir.name.toLowerCase().includes(query)) {
                return true;
            }
            const filteredFiles = (dir.files || []).filter(file =>
                file.name.toLowerCase().includes(query)
            );
            return filteredFiles.length > 0;
        });
        
        const filteredFiles = (node.files || []).filter(file =>
            file.name.toLowerCase().includes(query)
        );
        
        return {
            ...node,
            dirs: filteredDirs,
            files: filteredFiles
        };
    },

    renderCurrentLevel() {
        if (!this.contentEl) return;
        const currentNode = this.getCurrentNode();
        
        const displayNode = this.searchQuery ? this.filterNode(currentNode, this.searchQuery) : currentNode;
        
        this.contentEl.innerHTML = buildFileCardsHTML(displayNode, currentNavPath);
        this.bindClicks();
    },

    // 导航到指定目录
    navigateTo(path) {
        currentNavPath = path;
        this.renderCurrentLevel();
    },

    // 重置到根目录
    resetToRoot() {
        currentNavPath = [];
        this.searchQuery = '';
        if (this.searchInput) {
            this.searchInput.value = '';
        }
        this.renderCurrentLevel();
    },

    bindClicks() {
        if (!this.contentEl) return;
        
        // 绑定面包屑导航点击
        this.contentEl.querySelectorAll('.breadcrumb-home, .breadcrumb-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const navTo = el.getAttribute('data-nav-to');
                if (navTo === 'root') {
                    this.navigateTo([]);
                } else {
                    this.navigateTo(navTo.split('/'));
                }
            });
        });

        // 绑定专辑卡片（目录）点击 - 进入目录
        this.contentEl.querySelectorAll('.local-album-card').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dirName = el.getAttribute('data-dir-name');
                if (dirName) {
                    // 进入子目录
                    this.navigateTo([...currentNavPath, dirName]);
                }
            });
        });

        // 绑定歌曲项点击
        this.contentEl.querySelectorAll('.local-song-item').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const filePath = el.getAttribute('data-file-path');
                const fileName = el.getAttribute('data-file-name');
                if (filePath) {
                    await this.addFileToPlaylist(filePath, fileName);
                }
            });
        });
    },

    async addFileToPlaylist(filePath, fileName) {
        // 防抖：如果正在添加此歌曲，忽略重复点击
        if (pendingAdds.has(filePath)) {
            return;
        }
        
        pendingAdds.add(filePath);
        
        const playlistId = this.getPlaylistId();
        const songData = { url: filePath, title: fileName, type: 'local' };

        try {
            const response = await fetch('/playlist_add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playlist_id: playlistId,
                    song: songData
                })
            });

            if (response.ok) {
                Toast.success(`已添加: ${fileName}`);
                if (this.onSongAdded && typeof this.onSongAdded === 'function') {
                    setTimeout(() => {
                        this.onSongAdded();
                    }, 500);
                }
            } else {
                const error = await response.json();
                // 重复歌曲使用警告提示而不是错误
                if (error.duplicate) {
                    Toast.warning(`${fileName} 已在播放列表中`);
                } else {
                    Toast.error(`添加失败: ${error.error || '未知错误'}`);
                }
            }
        } catch (error) {
            console.error('添加文件失败:', error);
            Toast.error('添加失败');
        } finally {
            // 延迟移除防抖标记，防止快速连续点击
            setTimeout(() => {
                pendingAdds.delete(filePath);
            }, 1000);
        }
    }
};
