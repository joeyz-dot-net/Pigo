// 歌单管理模块
import { playlistManager } from './playlist.js';
import { Toast } from './ui.js';

export class PlaylistsManagement {
    constructor() {
        this.modalBody = null;
        this.modal = null;
        this.onPlaylistSwitchCallback = null;
    }

    init(onPlaylistSwitch = null) {
        this.modalBody = document.getElementById('playlistsModalBody');
        this.modal = document.getElementById('playlistsModal');
        this.onPlaylistSwitchCallback = onPlaylistSwitch;
        this.bindEvents();
    }

    // 绑定事件
    bindEvents() {
        // 创建新歌单按钮
        const playlistsAddBtn = document.getElementById('playlistsAddBtn');
        if (playlistsAddBtn) {
            playlistsAddBtn.addEventListener('click', async () => {
                const name = prompt('请输入歌单名称：');
                if (name && name.trim()) {
                    try {
                        await playlistManager.create(name.trim());
                        Toast.success('歌单创建成功');
                        this.render();
                    } catch (error) {
                        Toast.error('创建失败: ' + error.message);
                    }
                }
            });
        }

        // 歌单模态框关闭按钮
        const playlistsBackBtn = document.getElementById('playlistsBackBtn');
        if (playlistsBackBtn && this.modal) {
            playlistsBackBtn.addEventListener('click', () => {
                this.hide();
            });
            
            // 点击背景关闭
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hide();
                }
            });
        }
    }

    // 显示歌单管理模态框
    show() {
        if (this.modal) {
            this.modal.style.display = 'block';
            setTimeout(() => {
                this.modal.classList.add('modal-visible');
            }, 10);
            this.render();
        }
    }

    // 隐藏模态框
    hide() {
        if (this.modal) {
            this.modal.classList.remove('modal-visible');
            setTimeout(() => {
                this.modal.style.display = 'none';
            }, 300);
        }
    }

    // 渲染歌单列表
    render(onPlaylistSwitch = null) {
        if (!this.modalBody) {
            console.warn('❌ playlistsModalBody 未找到');
            return;
        }

        const playlists = playlistManager.playlists || [];
        console.log('📋 渲染歌单列表，共', playlists.length, '个歌单');

        this.modalBody.innerHTML = '';

        if (playlists.length === 0) {
            this.modalBody.innerHTML = `
                <div class="playlists-empty">
                    <div class="playlists-empty-icon">📁</div>
                    <div class="playlists-empty-text">暂无歌单</div>
                    <div style="font-size: 14px; color: rgba(255, 255, 255, 0.4); margin-top: 8px;">
                        点击右上角 + 创建新歌单
                    </div>
                </div>
            `;
            return;
        }

        playlists.forEach((playlist, index) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            
            // 为不同歌单生成不同的渐变色
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
            const gradient = gradients[index % gradients.length];
            
            // 歌单图标
            const icons = ['🎵', '🎧', '🎸', '🎹', '🎤', '🎼', '🎺', '🥁'];
            const icon = playlist.id === 'default' ? '⭐' : icons[index % icons.length];
            
            item.innerHTML = `
                <div class="playlist-icon" style="background: ${gradient}">
                    ${icon}
                </div>
                <div class="playlist-info">
                    <div class="playlist-name">
                        ${playlist.name || '未命名歌单'}
                        ${playlist.id === 'default' ? '<span class="default-badge">默认</span>' : ''}
                    </div>
                    <div class="playlist-count">
                        ${playlist.songs?.length || 0} 首歌曲
                    </div>
                </div>
                <div class="playlist-actions">
                    ${playlist.id !== 'default' ? `
                        <button class="playlist-action-btn edit" title="编辑歌单">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
                                <path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                        </button>
                        <button class="playlist-action-btn delete" title="删除歌单">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            `;

            // 点击歌单切换
            item.querySelector('.playlist-info').addEventListener('click', async () => {
                try {
                    console.log('[歌单管理] 开始切换歌单:', playlist.id, playlist.name);
                    
                    // 第一步：调用后端切换API，更新服务器的CURRENT_PLAYLIST_ID
                    console.log('[歌单管理] 步骤1: 调用后端切换API');
                    const switchResult = await playlistManager.switch(playlist.id);
                    console.log('[歌单管理] 后端切换结果:', switchResult);
                    
                    // 第二步：更新前端本地状态
                    console.log('[歌单管理] 步骤2: 更新前端本地状态');
                    playlistManager.setSelectedPlaylist(playlist.id);
                    
                    // 第三步：重新加载数据确保同步
                    console.log('[歌单管理] 步骤3: 重新加载所有歌单数据');
                    await playlistManager.loadAll();
                    
                    console.log('[歌单管理] ✅ 歌单切换完成:', playlist.name);
                    Toast.success(`已切换到：${playlist.name}`);
                    this.hide();
                    
                    // 通知外部需要刷新播放列表
                    if (this.onPlaylistSwitchCallback && typeof this.onPlaylistSwitchCallback === 'function') {
                        console.log('[歌单管理] 步骤4: 触发回调函数');
                        this.onPlaylistSwitchCallback(playlist.id, playlist.name);
                    }
                } catch (error) {
                    console.error('[歌单管理] 切换失败:', error);
                    Toast.error('切换失败: ' + error.message);
                }
            });

            // 编辑歌单名称
            if (playlist.id !== 'default') {
                const editBtn = item.querySelector('.playlist-action-btn.edit');
                if (editBtn) {
                    editBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        
                        const newName = prompt(`编辑歌单名称：`, playlist.name);
                        if (newName !== null && newName.trim() && newName.trim() !== playlist.name) {
                            try {
                                await playlistManager.update(playlist.id, { name: newName.trim() });
                                Toast.success('歌单已重命名');
                                this.render(onPlaylistSwitch);
                            } catch (error) {
                                Toast.error('重命名失败: ' + error.message);
                            }
                        }
                    });
                }
            }

            // 删除歌单
            if (playlist.id !== 'default') {
                const deleteBtn = item.querySelector('.playlist-action-btn.delete');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        
                        // 优化删除确认对话框
                        const confirmed = confirm(
                            `确定要删除歌单"${playlist.name}"吗？\n\n` +
                            `该歌单包含 ${playlist.songs?.length || 0} 首歌曲，删除后无法恢复。`
                        );
                        
                        if (confirmed) {
                            try {
                                // 添加删除动画
                                item.style.transition = 'all 0.3s ease';
                                item.style.opacity = '0';
                                item.style.transform = 'translateX(-100%)';
                                
                                await new Promise(resolve => setTimeout(resolve, 300));
                                await playlistManager.delete(playlist.id);
                                Toast.success('歌单已删除');
                                this.render(onPlaylistSwitch);
                            } catch (error) {
                                item.style.opacity = '1';
                                item.style.transform = 'translateX(0)';
                                Toast.error('删除失败: ' + error.message);
                            }
                        }
                    });
                }
            }

            this.modalBody.appendChild(item);
        });
    }
}

// 导出单例
export const playlistsManagement = new PlaylistsManagement();
