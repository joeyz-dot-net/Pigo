// API 调用封装模块
export class MusicAPI {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async get(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`);
        return response.json();
    }

    async post(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    }

    async postForm(endpoint, formData) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'POST',
            body: formData
        });
        return response.json();
    }

    async delete(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'DELETE'
        });
        return response.json();
    }

    async put(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    }

    // 播放器相关 API
    async getStatus() {
        return this.get('/status');
    }

    async play(url, title, type = 'local') {
        const formData = new FormData();
        formData.append('url', url);
        formData.append('title', title);
        formData.append('type', type);
        return this.postForm('/play', formData);
    }

    async pause() {
        return this.post('/pause', {});
    }

    async next() {
        return this.post('/next', {});
    }

    async prev() {
        return this.post('/prev', {});
    }

    async setVolume(value) {
        const formData = new FormData();
        formData.append('value', value);
        return this.postForm('/volume', formData);
    }

    async seek(percent) {
        const formData = new FormData();
        formData.append('percent', percent);
        return this.postForm('/seek', formData);
    }

    async loop() {
        return this.post('/loop', {});
    }

    async getVolume() {
        return this.post('/volume', {});
    }

    // 播放列表 API
    async getPlaylist(playlistId = null) {
        const url = playlistId ? `/playlist?playlist_id=${encodeURIComponent(playlistId)}` : '/playlist';
        return this.get(url);
    }

    async getPlaylists() {
        return this.get('/playlists');
    }

    async createPlaylist(name) {
        return this.post('/playlists', { name });
    }

    async deletePlaylist(id) {
        return this.delete(`/playlists/${id}`);
    }

    async updatePlaylist(id, data) {
        return this.put(`/playlists/${id}`, data);
    }

    async switchPlaylist(id) {
        return this.post(`/playlists/${id}/switch`, {});
    }

    async removeFromPlaylist(index) {
        const formData = new FormData();
        formData.append('index', index);
        return this.postForm('/playlist_remove', formData);
    }

    async removeFromSpecificPlaylist(playlistId, index) {
        const formData = new FormData();
        formData.append('index', index);
        return this.postForm(`/playlists/${playlistId}/remove`, formData);
    }

    async reorderPlaylist(playlistId, fromIndex, toIndex) {
        return this.post('/playlist_reorder', {
            playlist_id: playlistId,
            from_index: fromIndex,
            to_index: toIndex
        });
    }

    async addSongToPlaylistTop(playlistId, song) {
        const formData = new FormData();
        formData.append('url', song.url || '');
        formData.append('title', song.title || '');
        formData.append('type', song.type || 'local');
        if (song.thumbnail_url) formData.append('thumbnail_url', song.thumbnail_url);
        return this.postForm(`/playlists/${playlistId}/add_next`, formData);
    }

    // ✅ 新增：添加歌曲到歌单（支持指定插入位置）
    async addToPlaylist(data) {
        return this.post('/playlist_add', data);
    }

    // 搜索 API
    async searchSong(query) {
        return this.post('/search_song', { query });
    }

    async searchYoutube(query) {
        const formData = new FormData();
        formData.append('query', query);
        return this.postForm('/search_youtube', formData);
    }

    // 播放历史 API
    async addSongToHistory({ url, title, type = 'local', thumbnail_url = '' }) {
        const formData = new FormData();
        formData.append('url', url || '');
        formData.append('title', title || url || '');
        formData.append('type', type || 'local');
        if (thumbnail_url) formData.append('thumbnail_url', thumbnail_url);
        return this.postForm('/song_add_to_history', formData);
    }

    // ✅ 新增：获取已合并的播放历史（相同歌曲仅显示最后播放时间）
    async getPlaybackHistoryMerged() {
        return this.get('/playback_history_merged');
    }
}

// 导出单例
export const api = new MusicAPI();
