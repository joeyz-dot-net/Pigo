(() => {
	// YouTube tab logic - now integrated into the main tab interface
	const youtubeInput = document.getElementById('youtubeInput');
	const youtubeStatus = document.getElementById('youtubeStatus');
	const youtubeSubmit = document.getElementById('youtubeSubmit');
	const youtubeHistoryList = document.getElementById('youtubeHistoryList');
	const youtubeQueueSection = document.getElementById('youtubeQueueSection');
	const youtubeQueueList = document.getElementById('youtubeQueueList');
	
	// localStorage keys and limits
	const STORAGE_KEY = 'youtube_history';
	const MAX_LOCAL_HISTORY = 100;

	// Load local history from localStorage
	function getLocalHistory(){
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch (e) {
			console.warn('[Storage] Failed to parse YouTube history:', e);
			return [];
		}
	}

	// Save history to localStorage
	function saveLocalHistory(history){
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
		} catch (e) {
			console.warn('[Storage] Failed to save YouTube history:', e);
		}
	}

	// Add new history item (called after successful play)
	function addToHistory(url, title){
		try {
			let history = getLocalHistory();
			// Remove if already exists (to move to top)
			history = history.filter(item => item.url !== url);
			// Add new item to front
			history.unshift({
				url: url,
				name: title || new URL(url).hostname,
				ts: Math.floor(Date.now() / 1000)
			});
			// Keep only MAX_LOCAL_HISTORY items
			history = history.slice(0, MAX_LOCAL_HISTORY);
			saveLocalHistory(history);
		} catch (e) {
			console.error('[Storage] Error adding to history:', e);
		}
	}

	function loadYoutubeHistory(){
		if(!youtubeHistoryList) return;
		
		// Try to load from server first, fall back to localStorage
		fetch('/youtube_history?limit=50')
			.then(r => r.json())
			.then(res => {
				if(res && res.status === 'OK' && res.history && res.history.length > 0){
					youtubeHistoryList.innerHTML = '';
					res.history.forEach(item => {
						const div = document.createElement('div');
						div.className = 'youtube-history-item';
						div.title = item.url;
						const displayName = item.name && item.name !== '加载中…' ? item.name : new URL(item.url).hostname;
						div.textContent = displayName;
						div.addEventListener('click', () => {
							youtubeInput.value = item.url;
							youtubeStatus.textContent = '';
						});
						youtubeHistoryList.appendChild(div);
					});
					// Sync server history to localStorage
					try {
						saveLocalHistory(res.history.slice(0, MAX_LOCAL_HISTORY));
					} catch (e) {
						console.warn('[Storage] Failed to sync history:', e);
					}
				} else {
					renderLocalHistory();
				}
			})
			.catch(e => {
				console.warn('[UI] 加载YouTube历史失败，使用本地存储:', e);
				renderLocalHistory();
			});
	}

	function renderLocalHistory(){
		const localHistory = getLocalHistory();
		if(!youtubeHistoryList) return;
		
		if(localHistory && localHistory.length > 0){
			youtubeHistoryList.innerHTML = '';
			localHistory.forEach(item => {
				const div = document.createElement('div');
				div.className = 'youtube-history-item';
				div.title = item.url;
				const displayName = item.name || new URL(item.url).hostname;
				div.textContent = displayName;
				div.addEventListener('click', () => {
					youtubeInput.value = item.url;
					youtubeStatus.textContent = '';
				});
				youtubeHistoryList.appendChild(div);
			});
		} else {
			youtubeHistoryList.innerHTML = '<div class="youtube-history-item empty">暂无播放历史</div>';
		}
	}

	// Load and display current YouTube queue
	function loadYoutubeQueue(){
		if(!youtubeQueueList || !youtubeQueueSection) return;
		
		fetch('/youtube_queue')
			.then(r => r.json())
			.then(res => {
				if(res && res.status === 'OK' && res.queue && res.queue.length > 0){
					youtubeQueueSection.style.display = 'block';
					youtubeQueueList.innerHTML = '';
					const currentIndex = res.current_index || 0;
					res.queue.forEach((item, idx) => {
						const div = document.createElement('div');
						div.className = 'youtube-queue-item';
						if(idx === currentIndex) {
							div.classList.add('current');
							div.innerHTML = `<span class="queue-marker">▶</span> <span class="queue-title">${item.title}</span>`;
						} else {
							div.innerHTML = `<span class="queue-index">${idx + 1}.</span> <span class="queue-title">${item.title}</span>`;
							// 为非当前项添加点击事件
							div.style.cursor = 'pointer';
							div.addEventListener('click', () => {
								fetch('/youtube_queue_play', {
									method: 'POST',
									headers: {'Content-Type': 'application/x-www-form-urlencoded'},
									body: `index=${idx}`
								})
								.then(r => r.json())
								.then(res => {
									if(res && res.status === 'OK') {
										console.debug('[UI] 播放队列项:', idx);
										// 重新加载队列显示当前项
										setTimeout(() => loadYoutubeQueue(), 100);
									} else {
										console.error('[UI] 播放失败:', res && res.error);
									}
								})
								.catch(e => console.error('[UI] 请求失败:', e));
							});
						}
						youtubeQueueList.appendChild(div);
					});
				} else {
					youtubeQueueSection.style.display = 'none';
				}
			})
			.catch(e => {
				console.warn('[UI] 加载YouTube队列失败:', e);
				youtubeQueueSection.style.display = 'none';
			});
	}

	// Handle Enter key in textarea (Ctrl+Enter or just Enter for submit)
	youtubeInput && youtubeInput.addEventListener('keydown', (e) => {
		if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			youtubeSubmit && youtubeSubmit.click();
		}
	});

	youtubeSubmit && youtubeSubmit.addEventListener('click', ()=>{
		const url = (youtubeInput.value || '').trim();
		
		// Validate URL
		if(!url){
			youtubeStatus.textContent = '请输入YouTube地址';
			return;
		}
		
		// Check if it's a valid HTTP(S) URL and contains youtube/youtu.be domain
		let isValidYouTubeUrl = false;
		try {
			const urlObj = new URL(url);
			const host = urlObj.hostname.toLowerCase();
			isValidYouTubeUrl = host.includes('youtube.com') || host.includes('youtu.be');
		} catch (e) {
			// Not a valid URL
		}
		
		if(!isValidYouTubeUrl){
			youtubeStatus.textContent = '请输入有效的YouTube视频或播放列表地址';
			return;
		}
		
		youtubeStatus.textContent = '正在开始流式播放...';
		console.debug('[UI] play_youtube 请求:', url);
		fetch('/play_youtube', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'url=' + encodeURIComponent(url)
		}).then(r => r.json()).then(res => {
			console.debug('[UI] /play_youtube 响应:', res);
			if(res && res.status === 'OK'){
				youtubeStatus.textContent = '已开始流式播放！';
				youtubeInput.value = '';
				// Add to local history immediately
				addToHistory(url, '');
				// 刷新历史记录和队列
				setTimeout(() => {
					loadYoutubeHistory();
					loadYoutubeQueue();
					youtubeStatus.textContent = '';
				}, 1000);
			}else{
				youtubeStatus.textContent = '播放失败：' + (res && res.error || '未知错误');
			}
		}).catch(e=>{
			console.error('[UI] play_youtube 请求失败', e);
			youtubeStatus.textContent = '请求失败：' + e;
		});
	});

	// 当标签页显示时加载历史和队列
	window.addEventListener('tabswitched', (e) => {
		if(e.detail && e.detail.tab === 'youtube'){
			loadYoutubeHistory();
			loadYoutubeQueue();
			// 每2秒刷新一次队列，以显示当前播放进度
			const queueRefreshInterval = setInterval(() => {
				if(document.getElementById('youtubePlaylist').style.display === 'none') {
					clearInterval(queueRefreshInterval);
				} else {
					loadYoutubeQueue();
				}
			}, 2000);
		}
	});

	// 初始化加载历史记录和队列（当DOM就绪时）
	window.addEventListener('DOMContentLoaded', () => {
		loadYoutubeHistory();
		loadYoutubeQueue();
	});
	
	// 备用方案：如果DOM已经加载完毕，直接加载
	if(document.readyState === 'interactive' || document.readyState === 'complete'){
		loadYoutubeHistory();
		loadYoutubeQueue();
	}

})();
