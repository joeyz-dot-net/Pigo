(() => {
	let ctx = { tree: {}, musicDir: '' };
	try { ctx = JSON.parse(document.getElementById('boot-data').textContent); } catch (e) { console.warn('Boot data parse error', e); }
	const ROOT = document.getElementById('tree');
	function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
	const MAX_VOLUME = 110;
	const clampVolume = v => Math.max(0, Math.min(MAX_VOLUME, Number(v)));
	
	// 当前队列中的URL集合，用于检测重复
	const queueUrlSet = new Set();
	window._queueUrlSet = queueUrlSet;  // 立即暴露到 window 对象
	
	// Add last paused state cache
	let lastPausedState = null;
	// Polling state cache to avoid redundant DOM updates
	let lastPolledRel = null;
	let fullPlayerSyncTimer = null;
	let lastStatusSnapshot = null;

	// Apply server status to mini player (no extra fetch)
	function applyStatusToMini(status) {
		const miniPlayerTitle = document.getElementById('miniPlayerTitle');
		const miniPlayerArtist = document.getElementById('miniPlayerArtist');
		const miniPlayerProgressFill = document.getElementById('miniPlayerProgressFill');
		const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
		const miniPlayerCover = document.getElementById('miniPlayerCover');
		const miniPlaceholder = miniPlayerCover ? miniPlayerCover.parentElement?.querySelector('.mini-player-cover-placeholder') : null;

		if(!miniPlayerTitle || !miniPlayerArtist || !miniPlayerProgressFill) return;
		const invalid = !status || status.status !== 'OK' || !status.playing;
		if(invalid) {
			miniPlayerTitle.textContent = '未播放';
			miniPlayerArtist.textContent = '--';
			miniPlayerProgressFill.style.width = '0%';
			if(miniPlayPauseBtn) miniPlayPauseBtn.textContent = '▶';
			if(miniPlayerCover) miniPlayerCover.style.display = 'none';
			if(miniPlaceholder) miniPlaceholder.style.display = 'flex';
			return;
		}

		const rel = status.playing.rel || status.playing.url || '';
		let displayName = (status.playing.media_title && status.playing.media_title.length) ? status.playing.media_title : null;
		if(!displayName) {
			const nameField = status.playing.name || rel || '';
			displayName = nameField.startsWith('http') ? '加载中…' : nameField;
		}
		miniPlayerTitle.textContent = displayName;
		miniPlayerArtist.textContent = status.playing.type === 'youtube' ? 'YouTube' : '本地音乐';

		const coverSrc = status.playing.thumbnail_url || status.playing.thumbnail || '';
		if(miniPlayerCover) {
			if(coverSrc) {
				miniPlayerCover.src = coverSrc;
				miniPlayerCover.style.display = 'block';
				miniPlayerCover.onerror = () => { miniPlayerCover.style.display = 'none'; if(miniPlaceholder) miniPlaceholder.style.display = 'flex'; };
				if(miniPlaceholder) miniPlaceholder.style.display = 'none';
			} else {
				miniPlayerCover.style.display = 'none';
				if(miniPlaceholder) miniPlaceholder.style.display = 'flex';
			}
		}

		if(status.mpv && status.mpv.time != null && status.mpv.duration) {
			const pct = Math.min(100, Math.max(0, (status.mpv.time / status.mpv.duration) * 100));
			miniPlayerProgressFill.style.width = pct.toFixed(2) + '%';
		}
		if(miniPlayPauseBtn && status.mpv) {
			miniPlayPauseBtn.textContent = status.mpv.paused ? '▶' : '⏸';
		}
	}

	// Apply server status to full player (title/cover/artist; progress handled elsewhere)
	function applyStatusToFull(status) {
		const fullPlayer = document.getElementById('fullPlayer');
		if(!fullPlayer || fullPlayer.style.display === 'none') return;

		const titleEl = document.getElementById('fullPlayerTitle');
		const artistEl = document.getElementById('fullPlayerArtist');
		const coverEl = document.getElementById('fullPlayerCover');
		const placeholderEl = document.getElementById('fullPlayerPlaceholder');

		const invalid = !status || status.status !== 'OK' || !status.playing;
		if(invalid) {
			if(titleEl) titleEl.textContent = '未播放';
			if(artistEl) artistEl.textContent = '--';
			if(coverEl) coverEl.style.display = 'none';
			if(placeholderEl) placeholderEl.style.display = 'flex';
			return;
		}

		const rel = status.playing.rel || status.playing.url || '';
		let displayName = (status.playing.media_title && status.playing.media_title.length) ? status.playing.media_title : null;
		if(!displayName) {
			const nameField = status.playing.name || rel || '';
			displayName = nameField.startsWith('http') ? '加载中…' : nameField;
		}
		if(titleEl) titleEl.textContent = displayName;
		const artist = status.playing.uploader || status.playing.channel || (status.playing.type === 'youtube' ? 'YouTube' : '本地音乐');
		if(artistEl) artistEl.textContent = artist;

		let coverSrc = status.playing.thumbnail_url || status.playing.thumbnail || status.playing.cover || '';
		// Fallback: reuse mini player cover if server did not provide one
		if(!coverSrc) {
			const miniCover = document.getElementById('miniPlayerCover');
			if(miniCover && miniCover.style.display !== 'none' && miniCover.src && miniCover.src !== window.location.href) {
				coverSrc = miniCover.src;
			}
		}
		if(coverEl) {
			if(coverSrc) {
				coverEl.src = coverSrc;
				coverEl.style.display = 'block';
				coverEl.onerror = () => { coverEl.style.display = 'none'; if(placeholderEl) placeholderEl.style.display = 'flex'; };
				if(placeholderEl) placeholderEl.style.display = 'none';
			} else {
				coverEl.style.display = 'none';
				if(placeholderEl) placeholderEl.style.display = 'flex';
			}
		}
	}

	function buildNode(node) {
		const li = el('li', 'dir');
		if (node.rel) li.dataset.rel = node.rel;
		const label = el('div', 'label');
		const arrow = el('span', 'arrow', '▶');
		const nameSpan = el('span', 'name', node.rel ? node.name : '根目录');
		label.appendChild(arrow); label.appendChild(nameSpan);
		label.onclick = () => li.classList.toggle('collapsed');
		li.appendChild(label);
		const ul = el('ul');
		(node.dirs || []).forEach(d => ul.appendChild(buildNode(d)));
		(node.files || []).forEach(f => {
			const fi = el('li', 'file', f.name);
			fi.dataset.rel = f.rel;
			fi.onclick = () => play(f.rel, fi);
			ul.appendChild(fi);
		});
		li.appendChild(ul);
		if (node.rel) li.classList.add('collapsed');
		return li;
	}

	// 渲染本地文件树
	function render() {
		if (!ROOT) return;
		ROOT.innerHTML = '';
		try {
			if (ctx.tree) {
				ROOT.appendChild(buildNode(ctx.tree));
			}
		} catch (e) {
			console.error('[Tree] 渲染失败', e);
		}
	}

	let lastLocatedRel = null;
	function expandTo(rel) {
		if (!rel) return;
		if (rel === lastLocatedRel) return; // 防止频繁跳动
		lastLocatedRel = rel;
		const parts = rel.split('/');
		let acc = '';
		for (let i = 0; i < parts.length - 1; i++) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i];
			const dir = Array.from(document.querySelectorAll('li.dir')).find(d => d.dataset.rel === acc);
			if (dir) {
				dir.classList.remove('collapsed');
				const lbl = dir.querySelector('.label');
				if (lbl) lbl.classList.add('active');
			}
		}
		const fileEl = Array.from(document.querySelectorAll('li.file')).find(f => f.dataset.rel === rel);
		if (fileEl) {
			fileEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	function play(rel, dom){
		// 添加本地文件到播放队列末尾（不立即播放）
		const title = dom?.textContent || rel;
		console.log('[PLAY] 被点击的DOM元素:', dom);
		console.log('[PLAY] 被点击的DOM的data-rel属性:', dom?.dataset?.rel);
		console.log('[PLAY] 收到的rel参数:', rel);
		console.log('[PLAY] 标题:', title);
		console.debug('[PLAY] 请求添加本地文件到队列:', rel, '标题:', title);
		
		// 立即高亮显示该文件
		document.querySelectorAll('.file.playing').forEach(e=>e.classList.remove('playing'));
		if(dom) {
			dom.classList.add('playing');
			console.log('[PLAY] 已高亮DOM元素，rel值:', dom?.dataset?.rel);
			expandTo(rel);
		}
		
		// 调用 /play 端点：添加到队列末尾，不立即播放
		const encodedPath = encodeURIComponent(rel);
		console.log('[PLAY] 编码后的路径:', encodedPath);
		const body = `path=${encodedPath}&play_now=0`;
		console.log('[PLAY] 请求body:', body);
		
		fetch('/play', {
			method:'POST',
			headers:{'Content-Type':'application/x-www-form-urlencoded'},
			body: body
		})
		.then(r=>r.json())
		.then(j=>{
			console.debug('[PLAY] /play 响应:', j);
			console.log('[PLAY] 响应状态:', j.status, '消息:', j.message || j.error);
			if(j.status!=='OK') { 
				console.warn('添加队列失败: ', j.error); 
				alert('添加队列失败: '+ j.error); 
				return; 
			}
			console.debug('[PLAY] 本地文件已添加到队列末尾');
			// 刷新队列UI显示新添加的项
			if(window.loadPlayList) {
				console.debug('[PLAY] 刷新队列UI');
				window.loadPlayList();
			}
		}).catch(e=>{ 
			console.error('[PLAY] 请求错误', e); 
			alert('添加队列请求错误: '+ e); 
		});
	}

	function pollStatus(){
		fetch('/status').then(r=>r.json()).then(j=>{
			if(j.status!=='OK') return;
			const bar = document.getElementById('nowPlaying');
			// 兼容 rel 和 url 字段名
			const rel = j.playing ? (j.playing.rel || j.playing.url) : null;
			if(!j.playing || !rel){ bar.textContent='未播放'; return; }
			// 优先使用服务器提供的 media_title（mpv 的 media-title）
			// 若不存在，则使用 name（仅当 name 不是 URL 时）；若仍为 URL，则显示加载占位文本
			let displayName = (j.playing.media_title && j.playing.media_title.length) ? j.playing.media_title : null;
			if(!displayName){
				const nameField = j.playing.name || rel || '';
				if(nameField.startsWith('http')){
					// 对于网络流，在没有真实标题之前显示加载提示，避免展示原始 URL 或域名造成误导
					displayName = '加载中…';
				} else {
					displayName = nameField;
				}
			}
			let label = '▶ '+ displayName;
			// 获取时长：优先使用 mpv duration，其次从队列数据中获取
			let duration = (j.mpv && j.mpv.duration) || 0;
			let currentTime = 0;
			let isPaused = false;
			
			if(j.mpv && j.mpv.time!=null){
				currentTime = j.mpv.time||0;
				isPaused = j.mpv.paused || false;
				const fmt = s=>{ if(isNaN(s)) return '--:--'; const m=Math.floor(s/60), ss=Math.floor(s%60); return m+':'+(ss<10?'0':'')+ss; };
				
				if(duration > 0) {
					label += ' ['+ fmt(currentTime) +' / '+ fmt(duration) + (isPaused?' | 暂停':'') +']';
				} else {
					// 没有时长信息，尝试从队列数据中获取
					const currentQueueItem = document.querySelector('.play-list-item.current');
					if(currentQueueItem && window._queueData && window._queueData.queue) {
						const currentIndex = window._queueData.current_index;
						if(currentIndex >= 0 && currentIndex < window._queueData.queue.length) {
							const queueItem = window._queueData.queue[currentIndex];
							const queueDuration = queueItem.duration || 0;
							if(queueDuration > 0) {
								duration = queueDuration;
								label += ' ['+ fmt(currentTime) +' / '+ fmt(queueDuration) + (isPaused?' | 暂停':'') +']';
							} else {
								label += ' ['+ fmt(currentTime) + (isPaused?' | 暂停':'') +']';
							}
						} else {
							label += ' ['+ fmt(currentTime) + (isPaused?' | 暂停':'') +']';
						}
					} else {
						label += ' ['+ fmt(currentTime) + (isPaused?' | 暂停':'') +']';
					}
				}
			}
			
			// 更新进度条（footer and full player）
			if(duration > 0 && !window._progressDragging) {
				const pct = Math.min(100, Math.max(0, currentTime/duration*100));
				const fill = document.getElementById('playerProgressFill');
				const thumb = document.getElementById('playerProgressThumb');
				if(fill) fill.style.width = pct.toFixed(2)+'%';
				if(thumb) thumb.style.left = pct.toFixed(2)+'%';
				// Sync full player progress
				if(fullPlayer && fullPlayer.style.display !== 'none') {
					if(fullPlayerProgressFill) fullPlayerProgressFill.style.width = pct.toFixed(2)+'%';
					if(fullPlayerProgressThumb) fullPlayerProgressThumb.style.left = pct.toFixed(2)+'%';
					if(fullPlayerCurrentTime) {
						const fmt = s=>{ if(isNaN(s)) return '--:--'; const m=Math.floor(s/60), ss=Math.floor(s%60); return m+':'+(ss<10?'0':'')+ss; };
						fullPlayerCurrentTime.textContent = fmt(currentTime);
					}
					if(fullPlayerDuration) {
						const fmt = s=>{ if(isNaN(s)) return '--:--'; const m=Math.floor(s/60), ss=Math.floor(s%60); return m+':'+(ss<10?'0':'')+ss; };
						fullPlayerDuration.textContent = fmt(duration);
					}
				}
			}
			
			// Sync volume only if changed and not user-dragging
			if(j.mpv && j.mpv.volume!=null){
				const vs = document.getElementById('volSlider') || document.getElementById('fullPlayerVolumeSlider');
				if(vs && !vs._dragging){
					const volVal = Math.round(clampVolume(j.mpv.volume));
					if(parseInt(vs.value) !== volVal) {
						vs.value = volVal;
						if(typeof updateVolumeDisplay === 'function') updateVolumeDisplay(volVal);
					}
				}
			}
			
			// Update play/pause only if state changed
			if(j.mpv && lastPausedState !== isPaused){
				lastPausedState = isPaused;
				const playPauseBtn = document.getElementById('playPauseBtn');
				if(playPauseBtn){
					playPauseBtn.textContent = isPaused ? '▶' : '⏸';
					playPauseBtn.dataset.icon = isPaused ? '▶' : '⏸';
				}
				// Update full player play/pause icon
				if(fullPlayer && fullPlayer.style.display !== 'none' && fullPlayerPlayPause) {
					if(isPaused) {
						fullPlayerPlayPause.classList.remove('playing');
						fullPlayerPlayPause.classList.add('paused');
						fullPlayerPlayPause.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
					} else {
						fullPlayerPlayPause.classList.remove('paused');
						fullPlayerPlayPause.classList.add('playing');
						fullPlayerPlayPause.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';
					}
				}
			}
			
			bar.textContent = label;
			document.querySelectorAll('.file.playing').forEach(e=>e.classList.remove('playing'));
			// 高亮 & 定位 (仅对本地文件)
			const target = Array.from(document.querySelectorAll('#tree .file')).find(f=>f.dataset.rel===rel);
			if(target){
				target.classList.add('playing');
				expandTo(rel);
			}
			// Only reload queue if song changed
			if(rel !== lastPolledRel && window.loadPlayList){
				if(window._lastPlayingUrl !== rel) {
					window._lastPlayingUrl = rel;
					setTimeout(() => window.loadPlayList(), 100);
				}
			}
			lastPolledRel = rel;
			lastStatusSnapshot = j;
			applyStatusToMini(j);
			applyStatusToFull(j);
			
			// Debounce full player sync to reduce DOM thrashing
			if(fullPlayer && fullPlayer.style.display !== 'none') {
				clearTimeout(fullPlayerSyncTimer);
				fullPlayerSyncTimer = setTimeout(() => updateFullPlayerUI(), 150);
			}
		}).catch(()=>{}).finally(()=> setTimeout(pollStatus, 2000));
	}

	setTimeout(pollStatus, 3000);

	// 播放控制按钮
	const playPauseBtn = document.getElementById('playPauseBtn');
	const prevBtn = document.getElementById('prevBtn');
	const nextBtn = document.getElementById('nextBtn');
	if(playPauseBtn) playPauseBtn.onclick = ()=>{
		fetch('/toggle_pause', {method:'POST'}).then(r=>r.json()).then(j=>{
			if(j.status==='OK'){
				playPauseBtn.textContent = j.paused ? '▶' : '⏸';
				playPauseBtn.dataset.icon = j.paused ? '▶' : '⏸';
			} else {
				console.warn('切换播放/暂停失败:', j.error);
			}
		}).catch(e => console.error('切换播放/暂停请求失败:', e));
	};
	if(prevBtn) prevBtn.onclick = ()=>{
		// 检查是否在 YouTube 页面并且有队列
		const youtubeTab = document.getElementById('youtubePlaylist');
		if(youtubeTab && youtubeTab.style.display !== 'none') {
			// 在 YouTube 页面，控制队列
			fetch('/play_queue')
				.then(r => r.json())
				.then(res => {
					if(res && res.status === 'OK' && res.queue && res.queue.length > 0) {
						const currentIndex = res.current_index || 0;
						const prevIndex = currentIndex - 1;
						if(prevIndex >= 0) {
							fetch('/play_queue_play', {
								method: 'POST',
								headers: {'Content-Type': 'application/x-www-form-urlencoded'},
								body: `index=${prevIndex}`
							})
							.then(r => r.json())
							.then(res => {
								if(res && res.status === 'OK') {
									console.debug('[UI] 播放上一首');
									// 重新加载队列显示
									if(window.loadPlayList) window.loadPlayList();
								}
							});
						} else {
							console.warn('已是第一首');
						}
					} else {
						// 没有队列，使用本地文件的上一个
						fetch('/prev', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
					}
				})
				.catch(e => {
					console.error('获取队列失败:', e);
					// 降级到本地文件的上一个
					fetch('/prev', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
				});
		} else {
			// 本地文件页面，使用原有逻辑
			fetch('/prev', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
		}
	};
	if(nextBtn) nextBtn.onclick = ()=>{
		// 检查是否在 YouTube 页面并且有队列
		const youtubeTab = document.getElementById('youtubePlaylist');
		if(youtubeTab && youtubeTab.style.display !== 'none') {
			// 在 YouTube 页面，控制队列
			fetch('/play_queue')
				.then(r => r.json())
				.then(res => {
					if(res && res.status === 'OK' && res.queue && res.queue.length > 0) {
						const currentIndex = res.current_index || 0;
						const nextIndex = currentIndex + 1;
						if(nextIndex < res.queue.length) {
							fetch('/play_queue_play', {
								method: 'POST',
								headers: {'Content-Type': 'application/x-www-form-urlencoded'},
								body: `index=${nextIndex}`
							})
							.then(r => r.json())
							.then(res => {
								if(res && res.status === 'OK') {
									console.debug('[UI] 播放下一首');
									// 重新加载队列显示
									if(window.loadPlayList) window.loadPlayList();
								}
							});
						} else {
							console.warn('已是最后一首');
						}
					} else {
						// 没有队列，使用本地文件的下一个
						fetch('/next', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
					}
				})
				.catch(e => {
					console.error('获取队列失败:', e);
					// 降级到本地文件的下一个
					fetch('/next', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
				});
		} else {
			// 本地文件页面，使用原有逻辑
			fetch('/next', {method:'POST'}).then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn(j.error); } });
		}
	};

	// 循环模式按钮 (0=不循环, 1=单曲循环, 2=全部循环)
	const loopBtn = document.getElementById('loopBtn');
	if(loopBtn) {
		loopBtn.onclick = ()=>{
			fetch('/loop', {method:'POST'}).then(r=>r.json()).then(j=>{
				if(j.status==='OK'){
					const mode = j.loop_mode;
					// 更新按钮显示和状态
					loopBtn.dataset.loop_mode = mode;
					if(mode === 0) {
						loopBtn.textContent = '↻';
						loopBtn.title = '不循环';
						loopBtn.classList.remove('loop-single', 'loop-all');
					} else if(mode === 1) {
						loopBtn.textContent = '↻¹';
						loopBtn.title = '单曲循环';
						loopBtn.classList.add('loop-single');
						loopBtn.classList.remove('loop-all');
					} else if(mode === 2) {
						loopBtn.textContent = '↻∞';
						loopBtn.title = '全部循环';
						loopBtn.classList.add('loop-all');
						loopBtn.classList.remove('loop-single');
					}
				}
			}).catch(e => console.error('循环模式请求失败:', e));
		};
	}

	// 音量滑块事件（全屏播放器）
	const vol = document.getElementById('volSlider') || document.getElementById('fullPlayerVolumeSlider');
	if(vol){
		vol.max = MAX_VOLUME;
		const send = val => {
			const value = clampVolume(val);
			fetch('/volume', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'value='+value})
				.then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn('设置音量失败', j); } })
				.catch(e=>console.warn('音量请求错误', e));
		};
		let debounceTimer;
		vol.addEventListener('input', ()=>{
			vol._dragging = true;
			const clamped = clampVolume(vol.value);
			if(typeof updateVolumeDisplay === 'function') updateVolumeDisplay(clamped);
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(()=>{ send(clamped); vol._dragging=false; }, 120);
		});
		// 初始化: 获取当前音量
		fetch('/volume', {method:'POST'}).then(r=>r.json()).then(j=>{
			if(j.status==='OK' && j.volume!=null){ 
				const volVal = Math.round(clampVolume(j.volume));
				vol.value = volVal;
				if(typeof updateVolumeDisplay === 'function') updateVolumeDisplay(volVal);
			}
		}).catch(()=>{});
	}

	const toggleBtn = document.getElementById('toggleExpand');
	function updateToggleLabel(){
		if(!toggleBtn) return;
		const dirs = Array.from(document.querySelectorAll('#tree .dir'));
		const anyCollapsed = dirs.some(d=>d.classList.contains('collapsed'));
		toggleBtn.textContent = anyCollapsed ? '+' : '-';
	}
	if(toggleBtn){
		toggleBtn.onclick = ()=>{
			const dirs = document.querySelectorAll('#tree .dir');
			const anyCollapsed = Array.from(dirs).some(d=>d.classList.contains('collapsed'));
			if(anyCollapsed){
				dirs.forEach(d=>d.classList.remove('collapsed'));
			} else {
				dirs.forEach(d=>d.classList.add('collapsed'));
			}
			updateToggleLabel();
		};
	}
	render();
	// Update toggle button label after render so it reflects current tree state
	setTimeout(()=>{ try{ updateToggleLabel(); }catch(e){} }, 50);



	// ========== 标签页切换 ========== 
	const headerBar = document.getElementById('headerBar');
	const headerContent = document.getElementById('headerContent');
	const tabBtns = document.querySelectorAll('.tab-btn');
	const localTab = document.querySelector('.local-tab');
	const playlistTab = document.querySelector('.playlist-tab');
	const youtubePlaylist = document.getElementById('youtubePlaylist');
	const tabsNav = document.querySelector('.tabs-nav');
	const bottomNav = document.getElementById('bottomNav');
	const navItems = bottomNav ? bottomNav.querySelectorAll('.nav-item') : [];
	const hasTabs = tabsNav && tabBtns.length > 0 && localTab && playlistTab;

	function showLocalTab() {
		if(localTab) localTab.style.display = '';
		if(playlistTab) playlistTab.style.display = 'none';
		if(tabsNav) {
			tabsNav.classList.remove('playlist-tab-nav');
			tabsNav.classList.add('local-tab-nav');
		}
		if(tabBtns && tabBtns.length) {
			tabBtns.forEach(b => b.classList.remove('active'));
			const localBtn = document.querySelector('.tab-btn[data-tab="local"]');
			if(localBtn) localBtn.classList.add('active');
		}
	}

	function showPlaylistTab() {
		if(localTab) localTab.style.display = 'none';
		if(playlistTab) playlistTab.style.display = '';
		if(tabsNav) {
			tabsNav.classList.remove('local-tab-nav');
			tabsNav.classList.add('playlist-tab-nav');
		}
		if(tabBtns && tabBtns.length) {
			tabBtns.forEach(b => b.classList.remove('active'));
			const ytBtn = document.querySelector('.tab-btn[data-tab="youtube"]');
			if(ytBtn) ytBtn.classList.add('active');
		}
	}

	// 头部始终显示，设置为 expanded 状态
	if(headerBar) {
		headerBar.classList.remove('header-collapsed');
		headerBar.classList.add('header-expanded');
	}

	if(hasTabs) {
		tabBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				const tab = btn.dataset.tab;
				
				// 如果头部被折叠，先展开
				if(headerBar && headerBar.classList.contains('header-collapsed')) {
					headerBar.classList.remove('header-collapsed');
					headerBar.classList.add('header-expanded');
					console.debug('[Header] 展开头部导航栏');
				}
				resetHeaderAutoCollapseTimer();
				
				// 更新按钮状态
				tabBtns.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				
				// 更新标签导航的主题
				tabsNav.classList.remove('local-tab-nav', 'playlist-tab-nav');
				if(tab === 'local') {
					showLocalTab();
				} else if(tab === 'youtube') {
					showPlaylistTab();
					window.dispatchEvent(new CustomEvent('tabswitched', { detail: { tab: 'youtube' } }));
				}
			}, { passive: true });
		});

		// 默认展示播放列表（本地隐藏）
		showPlaylistTab();
	} else {
		// 无标签时默认展示播放列表区域，本地隐藏
		showPlaylistTab();
	}

	// 底部导航切换（与 youtube.js 行为保持一致）
	if(navItems && navItems.length) {
		navItems.forEach(btn => {
			btn.addEventListener('click', () => {
				navItems.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				const tab = btn.dataset.tab;
				if(tab === 'playlist') {
					showPlaylistTab(); // 歌单按钮只切换到播放列表视图
				} else if(tab === 'browse') {
					if(window.openLocalSongsModal) window.openLocalSongsModal(); // 浏览按钮弹出本地歌曲
				} else if(tab === 'favorites') {
					// 可扩展：收藏页
				} else if(tab === 'search') {
					// 可扩展：搜索页
				}
			});
		});
	}

	// ========== 音量弹出控制 ==========
	const volumePopupBtn = document.getElementById('volumePopupBtn');
	const volumePopup = document.getElementById('volumePopup');
	const volumeSliderTrack = document.getElementById('volumeSliderTrack');
	const volumeSliderFill = document.getElementById('volumeSliderFill');
	const volumeSliderThumb = document.getElementById('volumeSliderThumb');
	const mainVolumeSlider = document.getElementById('fullPlayerVolumeSlider');
	const volSlider = document.getElementById('volSlider') || mainVolumeSlider;
	if(mainVolumeSlider) mainVolumeSlider.max = MAX_VOLUME;
	if(volSlider) volSlider.max = MAX_VOLUME;
	
	let isDraggingVolume = false;
	let volumeSendTimer = null;
	let pendingVolumeValue = null;
	
	// Update visual fill and thumb position based on value
	function updateVolumeDisplay(value) {
		if(!volumeSliderFill || !volumeSliderThumb || !volumeSliderTrack) return;
		const clamped = clampVolume(value);
		const percent = (clamped / MAX_VOLUME) * 100;
		volumeSliderFill.style.height = percent + '%';
		const thumbPos = (percent / 100) * Math.max(0, (volumeSliderTrack.offsetHeight - 20)); // 20 is thumb size
		volumeSliderThumb.style.bottom = thumbPos + 'px';
	}
	
	// Send volume to server (debounced to ~150ms)
	function sendVolumeToServer(value) {
		pendingVolumeValue = clampVolume(value);
		clearTimeout(volumeSendTimer);
		volumeSendTimer = setTimeout(() => {
			fetch('/volume', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'value='+pendingVolumeValue})
				.then(r=>r.json()).then(j=>{ if(j.status!=='OK'){ console.warn('设置音量失败', j); } })
				.catch(e=>console.warn('音量请求错误', e));
			volumeSendTimer = null;
		}, 150);
	}
	
	// Helper to set volume value
	function setVolumeValue(value) {
		value = clampVolume(value);
		if(volSlider) volSlider.value = value;
		if(mainVolumeSlider) mainVolumeSlider.value = value;
		updateVolumeDisplay(value);
		sendVolumeToServer(value);
	}

	// Show/hide volume popup
	volumePopupBtn && volumePopupBtn.addEventListener('click', () => {
		if(volumePopup.style.display === 'none'){
			// 获取当前音量并更新弹出框显示
			fetch('/volume', {method:'POST'})
				.then(r=>r.json())
				.then(j=>{
					if(j.status==='OK' && j.volume!=null){ 
						const currentVolume = Math.round(clampVolume(j.volume));
						setVolumeValue(currentVolume);
					}
				})
				.catch(e => {
					// 降级：使用主滑块的值
					if(volSlider) {
						updateVolumeDisplay(volSlider.value);
					}
				});
			volumePopup.style.display = 'block';
			volumePopupBtn.classList.add('active');
		} else {
			volumePopup.style.display = 'none';
			volumePopupBtn.classList.remove('active');
		}
	});
	
	// Mouse down on track - direct value setting
	volumeSliderTrack && volumeSliderTrack.addEventListener('mousedown', (e) => {
		if(e.target === volumeSliderThumb) return; // Let thumb handle its own drag
		isDraggingVolume = true;
		if(volSlider) volSlider._dragging = true;
		setVolumeFromEvent(e);
	});
	
	// Mouse down on thumb - start drag
	volumeSliderThumb && volumeSliderThumb.addEventListener('mousedown', () => {
		isDraggingVolume = true;
		if(volSlider) volSlider._dragging = true;
	});
	
	// Helper to calculate value from mouse position
	function setVolumeFromEvent(e) {
		const rect = volumeSliderTrack.getBoundingClientRect();
		const y = e.clientY - rect.top;
		// Convert y position to value (inverted: top=max, bottom=min)
		const percent = Math.max(0, Math.min(100, (1 - (y / rect.height)) * 100));
		const value = Math.round((percent / 100) * MAX_VOLUME);
		setVolumeValue(value);
	}
	
	// Mouse move - track drag
	document.addEventListener('mousemove', (e) => {
		if(isDraggingVolume && volumePopup.style.display === 'block') {
			setVolumeFromEvent(e);
		}
	});
	
	// Mouse up - end drag
	document.addEventListener('mouseup', () => {
		isDraggingVolume = false;
		if(volSlider) volSlider._dragging = false;
	});
	
	// Touch support
	volumeSliderTrack && volumeSliderTrack.addEventListener('touchstart', (e) => {
		if(e.target === volumeSliderThumb) {
			isDraggingVolume = true;
			if(volSlider) volSlider._dragging = true;
		} else {
			setVolumeFromTouchEvent(e);
		}
	});
	
	document.addEventListener('touchmove', (e) => {
		if(isDraggingVolume && volumePopup.style.display === 'block') {
			setVolumeFromTouchEvent(e);
		}
	});
	
	function setVolumeFromTouchEvent(e) {
		const touch = e.touches[0];
		const rect = volumeSliderTrack.getBoundingClientRect();
		const y = touch.clientY - rect.top;
		const percent = Math.max(0, Math.min(100, (1 - (y / rect.height)) * 100));
		const value = Math.round((percent / 100) * MAX_VOLUME);
		setVolumeValue(value);
	}
	
	document.addEventListener('touchend', () => {
		isDraggingVolume = false;
		if(volSlider) volSlider._dragging = false;
	});

	// ========== 进度条拖动功能 ==========
	const playerProgress = document.getElementById('playerProgress');
	const playerProgressFill = document.getElementById('playerProgressFill');
	const playerProgressThumb = document.getElementById('playerProgressThumb');
	
	window._progressDragging = false;
	
	if(playerProgress) {
		// 鼠标点击进度条
		playerProgress.addEventListener('mousedown', (e) => {
			// 检查是否在折叠状态，如果是则不拖动进度条
			const playerBar = document.getElementById('playerBar');
			if(playerBar && playerBar.classList.contains('footer-collapsed')) {
				return; // 在折叠状态下，不处理拖动
			}
			window._progressDragging = true;
			playerProgress.classList.add('dragging');
			seekToPosition(e);
		});
		
		// 鼠标移动
		document.addEventListener('mousemove', (e) => {
			if(window._progressDragging) {
				seekToPosition(e);
			}
		});
		
		// 鼠标释放
		document.addEventListener('mouseup', () => {
			if(window._progressDragging) {
				window._progressDragging = false;
				playerProgress.classList.remove('dragging');
			}
		});
		
		// 触摸支持
		playerProgress.addEventListener('touchstart', (e) => {
			// 检查是否在折叠状态，如果是则不拖动进度条
			const playerBar = document.getElementById('playerBar');
			if(playerBar && playerBar.classList.contains('footer-collapsed')) {
				return; // 在折叠状态下，不处理拖动
			}
			e.preventDefault(); // 防止触发其他事件
			window._progressDragging = true;
			playerProgress.classList.add('dragging');
			seekToPositionTouch(e);
		}, { passive: false });
		
		document.addEventListener('touchmove', (e) => {
			if(window._progressDragging) {
				e.preventDefault(); // 防止页面滚动
				seekToPositionTouch(e);
			}
		}, { passive: false });
		
		document.addEventListener('touchend', () => {
			if(window._progressDragging) {
				window._progressDragging = false;
				playerProgress.classList.remove('dragging');
			}
		});
		
	// 计算并跳转到指定位置
	function seekToPosition(e) {
		const rect = playerProgress.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
		
		// 更新视觉显示
		if(playerProgressFill) playerProgressFill.style.width = percent + '%';
		if(playerProgressThumb) playerProgressThumb.style.left = percent + '%';
		
		// 发送跳转请求
		sendSeekRequest(percent);
	}	function seekToPositionTouch(e) {
		const touch = e.touches[0];
		const rect = playerProgress.getBoundingClientRect();
		const x = touch.clientX - rect.left;
		const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
		
		// 更新视觉显示
		if(playerProgressFill) playerProgressFill.style.width = percent + '%';
		if(playerProgressThumb) playerProgressThumb.style.left = percent + '%';
		
		// 发送跳转请求
		sendSeekRequest(percent);
	}		// 发送跳转请求到服务器
		let seekTimer = null;
		let lastSeekTime = 0;
		let pendingSeekPercent = null;
		
		function sendSeekRequest(percent) {
			pendingSeekPercent = percent;
			const now = Date.now();
			
			// 如果距离上次请求已超过 2 秒，立即发送
			if(now - lastSeekTime >= 2000) {
				executeSeek();
			} else {
				// 否则安排在 2 秒后发送
				clearTimeout(seekTimer);
				seekTimer = setTimeout(() => {
					executeSeek();
				}, 2000 - (now - lastSeekTime));
			}
		}
		
		function executeSeek() {
			if(pendingSeekPercent === null) return;
			
			lastSeekTime = Date.now();
			const percent = pendingSeekPercent;
			
			fetch('/seek', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: 'percent=' + percent
			})
			.then(r => r.json())
			.then(j => {
				if(j.status !== 'OK') {
					console.warn('跳转失败:', j.error);
				}
			})
			.catch(e => console.error('跳转请求失败:', e));
		}
	}

	// Close popup when clicking outside
	document.addEventListener('click', (e) => {
		if(volumePopup && volumePopup.style.display === 'block' && 
		   !volumePopup.contains(e.target) && !volumePopupBtn.contains(e.target)){
			volumePopup.style.display = 'none';
			volumePopupBtn.classList.remove('active');
		}
	});

	// History modal functionality
	const historyBtn = document.getElementById('historyBtn');
	const historyModal = document.getElementById('historyModal');
	const historyList = document.getElementById('historyList');
	const historyModalClose = document.querySelector('.history-modal-close');

	// 展示播放历史函数
	function showYoutubeHistory() {
		loadHistoryModal();
		historyModal.classList.add('show');
	}

	if(historyBtn) {
		historyBtn.addEventListener('click', showYoutubeHistory);
	}

	if(historyModalClose) {
		historyModalClose.addEventListener('click', () => {
			historyModal.classList.remove('show');
		});
	}

	// Close history modal when clicking outside
	if(historyModal) {
		historyModal.addEventListener('click', (e) => {
			if(e.target === historyModal) {
				historyModal.classList.remove('show');
			}
		});
	}

	function loadHistoryModal() {
		fetch('/youtube_history?limit=50')
			.then(r => r.json())
			.then(j => {
				if(j.status !== 'OK') {
					historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">无法加载历史记录</div>';
					return;
				}
				const history = j.history || [];
				if(history.length === 0) {
					historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">暂无播放历史</div>';
					return;
				}
			historyList.innerHTML = history.map((item, idx) => {
				// 提取显示名称：优先使用 name，其次使用 title，最后从 URL 提取
				let displayName = item.name || item.title || '未知';
				if(!displayName || displayName === '加载中…') {
					// 如果是 URL，尝试提取更好的名称
					try {
						const url = item.url || '';
						if(url.includes('youtube')) {
							displayName = '播放列表或视频';
						} else {
							const urlObj = new URL(url);
							displayName = urlObj.hostname || displayName;
						}
					} catch(e) {
						displayName = '未知';
					}
				}
				const url = item.url || '';
				const itemType = item.type || 'unknown'; // 记录项目类型
				return `<div class="history-item" data-url="${url.replace(/"/g, '&quot;')}" data-type="${itemType}">
					<div class="history-item-info">
						<div class="history-item-name">${displayName}</div>
						<div class="history-item-url">${url.substring(0, 100)}${url.length > 100 ? '...' : ''}</div>
					</div>
					<button class="history-item-delete" data-index="${idx}" title="删除">✕</button>
				</div>`;
			}).join('');

			// Add click handlers for playback
			historyList.querySelectorAll('.history-item').forEach(item => {
				item.addEventListener('click', (e) => {
					// 忽略删除按钮的点击
					if(e.target.classList.contains('history-item-delete') || 
					   e.target.closest('.history-item-delete')) {
						return;
					}
					const url = item.dataset.url;
					const itemType = item.dataset.type;
					const titleEl = item.querySelector('.history-item-name');
					const title = titleEl ? titleEl.textContent : '';
					console.debug('[HISTORY-CLICK] url=', url, 'type=', itemType, 'title=', title);
					if(url) {
						playHistoryItem(url, itemType, title);
					}
				});
			});				// Add delete handlers
				historyList.querySelectorAll('.history-item-delete').forEach(btn => {
					btn.addEventListener('click', (e) => {
						e.stopPropagation();
						const item = e.target.closest('.history-item');
						item.remove();
						// Could add backend support for deletion later
					});
				});
			})
			.catch(e => {
				console.error('Failed to load history:', e);
				historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">加载失败</div>';
			});
	}

	function playHistoryItem(url, itemType, title) {
		console.debug('[HISTORY] 播放历史项目:', url, '类型:', itemType, '标题:', title);
		
		if(!url) {
			console.warn('[HISTORY] URL为空，中止操作');
			return;
		}
		
		if(itemType === 'local') {
			// 本地文件：添加到队列末尾（不立即播放）
			console.debug('[HISTORY] 添加本地文件到队列:', url);
			const body = 'path=' + encodeURIComponent(url) + '&play_now=0';
			fetch('/play', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: body
			})
			.then(r => r.json())
			.then(j => {
				console.debug('[HISTORY] /play API响应:', j);
				if(j.status === 'OK') {
					console.debug('[HISTORY] 本地文件已添加到队列:', url);
					// 刷新队列显示
					setTimeout(() => {
						console.debug('[HISTORY] 开始刷新队列显示...');
						if(window.loadPlayList) {
							window.loadPlayList();
						}
					}, 500);
				} else {
					console.warn('添加失败:', j.error);
					alert('添加失败: ' + j.error);
				}
			})
			.catch(e => console.error('请求错误:', e));
		} else {
			// YouTube URL：添加到队列末尾（不立即播放）
			const body = 'url=' + encodeURIComponent(url) + '&type=youtube' +
						(title ? '&title=' + encodeURIComponent(title) : '');
			console.debug('[HISTORY] 添加YouTube视频到队列:', url);
			fetch('/play_queue_add', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: body
			})
			.then(r => r.json())
			.then(j => {
				console.debug('[HISTORY] /play_queue_add API响应:', j);
				if(j.status === 'OK') {
					console.debug('[HISTORY] YouTube视频已添加到队列:', url, '队列长度:', j.queue_length);
					// 刷新队列显示
					setTimeout(() => {
						console.debug('[HISTORY] 开始刷新队列显示...');
						if(window.loadPlayList) {
							window.loadPlayList();
						}
					}, 500);
				} else {
					console.warn('添加失败:', j.error);
					alert('添加失败: ' + j.error);
				}
			})
			.catch(e => console.error('请求错误:', e));
		}
	}

	// ===== 页脚展开/折叠逻辑 =====
	const playerBar = document.getElementById('playerBar');
	const footerContent = document.getElementById('footerContent');
	let autoCollapseTimer = null;

	// 自动折叠功能 (10秒无操作)
	function resetAutoCollapseTimer() {
		if(autoCollapseTimer) clearTimeout(autoCollapseTimer);
		
		if(playerBar && playerBar.classList.contains('footer-expanded')) {
			autoCollapseTimer = setTimeout(() => {
				if(playerBar && playerBar.classList.contains('footer-expanded')) {
					playerBar.classList.remove('footer-expanded');
					playerBar.classList.add('footer-collapsed');
					console.debug('[Footer] 10秒无操作，自动折叠页脚控制栏');
					// 显示三个点
					const nowPlayingEl = document.getElementById('nowPlaying');
					if(nowPlayingEl) {
						nowPlayingEl._originalText = nowPlayingEl.textContent;
						nowPlayingEl.textContent = '...';
					}
				}
			}, 10000); // 10秒
		}
	}

	// 初始状态: 折叠
	if(playerBar) {
		playerBar.classList.add('footer-collapsed');
	}

	// 点击整个控制栏区域展开/折叠页脚
	if(playerBar) {
		playerBar.addEventListener('click', (e) => {
			// 如果点击的是进度条且展开状态，不处理展开/折叠逻辑（让进度条拖拽处理）
			if(playerProgress && playerProgress.contains(e.target) && playerBar.classList.contains('footer-expanded')) {
				return;
			}
			
			e.stopPropagation();
			
			const nowPlayingEl = document.getElementById('nowPlaying');
			
			// 折叠状态：展开控制栏
			if(playerBar.classList.contains('footer-collapsed')) {
				playerBar.classList.remove('footer-collapsed');
				playerBar.classList.add('footer-expanded');
				console.debug('[Footer] 展开页脚控制栏');
				// 恢复正常文本
				if(nowPlayingEl && nowPlayingEl._originalText) {
					nowPlayingEl.textContent = nowPlayingEl._originalText;
				}
				resetAutoCollapseTimer(); // 启动自动折叠计时器
			} else {
				// 展开状态：点击非进度条区域折叠
				playerBar.classList.remove('footer-expanded');
				playerBar.classList.add('footer-collapsed');
				console.debug('[Footer] 折叠页脚控制栏');
				// 保存原始文本，显示三个点
				if(nowPlayingEl) {
					nowPlayingEl._originalText = nowPlayingEl.textContent;
					nowPlayingEl.textContent = '...';
				}
				if(autoCollapseTimer) clearTimeout(autoCollapseTimer);
			}
		}, { passive: false });
	}

	// 进度条单独处理（用于展开状态下的拖拽，而不是展开/折叠）
	if(playerProgress) {
		playerProgress.addEventListener('click', (e) => {
			// 只在展开状态下处理进度条点击（用于调整进度）
			if(playerBar && playerBar.classList.contains('footer-expanded')) {
				e.stopPropagation();
				// 进度条拖拽逻辑由 mousedown/touchstart 处理
			}
		}, { passive: false });
	}

	// 点击footer-content区域不触发关闭，并重置计时器
	if(footerContent) {
		footerContent.addEventListener('click', (e) => {
			e.stopPropagation(); // 防止冒泡到playerBar的展开/折叠逻辑
			resetAutoCollapseTimer(); // 用户操作，重置计时器
		}, { passive: false });
	}

	// 页脚区域内的鼠标移动重置计时器
	if(playerBar) {
		playerBar.addEventListener('mousemove', () => {
			resetAutoCollapseTimer();
		}, { passive: true });
	}

	// 移动设备触摸事件也要重置计时器
	if(footerContent) {
		footerContent.addEventListener('touchstart', resetAutoCollapseTimer, { passive: true });
		footerContent.addEventListener('touchmove', resetAutoCollapseTimer, { passive: true });
		footerContent.addEventListener('touchend', resetAutoCollapseTimer, { passive: true });
	}

	// 可选: 点击页脚外部时自动折叠 (防止占用太多屏幕空间)
	document.addEventListener('click', (e) => {
		if(playerBar && playerBar.classList.contains('footer-expanded')) {
			// 检查点击是否在playerBar内
			if(!playerBar.contains(e.target)) {
				// 点击在页脚外，自动折叠
				playerBar.classList.remove('footer-expanded');
				playerBar.classList.add('footer-collapsed');
				console.debug('[Footer] 自动折叠页脚控制栏');
				if(autoCollapseTimer) clearTimeout(autoCollapseTimer);
			}
		}
	}, { passive: true });

	// ========== 全屏播放器 ==========
	const fullPlayer = document.getElementById('fullPlayer');
	const fullPlayerBack = document.getElementById('fullPlayerBack');
	const fullPlayerCover = document.getElementById('fullPlayerCover');
	const fullPlayerPlaceholder = document.getElementById('fullPlayerPlaceholder');
	const fullPlayerTitle = document.getElementById('fullPlayerTitle');
	const fullPlayerArtist = document.getElementById('fullPlayerArtist');
	const fullPlayerProgressBar = document.getElementById('fullPlayerProgressBar');
	const fullPlayerProgressFill = document.getElementById('fullPlayerProgressFill');
	const fullPlayerProgressThumb = document.getElementById('fullPlayerProgressThumb');
	const fullPlayerCurrentTime = document.getElementById('fullPlayerCurrentTime');
	const fullPlayerDuration = document.getElementById('fullPlayerDuration');
	const fullPlayerPlayPause = document.getElementById('fullPlayerPlayPause');
	const fullPlayerPrev = document.getElementById('fullPlayerPrev');
	const fullPlayerNext = document.getElementById('fullPlayerNext');
	const fullPlayerRepeat = document.getElementById('fullPlayerRepeat');
	const fullPlayerVolumeSlider = document.getElementById('fullPlayerVolumeSlider');
	const miniPlayer = document.getElementById('miniPlayer');

	// 打开全屏播放器
	function openFullPlayer() {
		if(fullPlayer) {
			fullPlayer.style.display = 'flex';
			if(!lastStatusSnapshot) {
				fetch('/status').then(r=>r.json()).then(j=>{ lastStatusSnapshot = j; applyStatusToFull(j); }).catch(()=>{});
			} else {
				updateFullPlayerUI();
			}
		}
	}

	// 关闭全屏播放器
	function closeFullPlayer() {
		if(fullPlayer) {
			fullPlayer.style.display = 'none';
		}
	}

	// 更新全屏播放器 UI
	function updateFullPlayerUI() {
		applyStatusToFull(lastStatusSnapshot);
	}

	// 点击 mini player 打开全屏播放器
	if(miniPlayer) {
		miniPlayer.addEventListener('click', (e) => {
			// 不要在点击控制按钮时打开
			if(e.target.closest('.mini-control-btn')) return;
			openFullPlayer();
		});
	}

	// 关闭按钮
	if(fullPlayerBack) {
		fullPlayerBack.addEventListener('click', closeFullPlayer);
	}

	// 播放/暂停按钮
	if(fullPlayerPlayPause && playPauseBtn) {
		fullPlayerPlayPause.addEventListener('click', () => {
			playPauseBtn.click();
		});
	}

	// 上一首
	if(fullPlayerPrev && prevBtn) {
		fullPlayerPrev.addEventListener('click', () => {
			console.debug('[FullPlayer] 点击上一首按钮');
			prevBtn.click();
		});
	}

	// 下一首
	if(fullPlayerNext && nextBtn) {
		fullPlayerNext.addEventListener('click', () => {
			console.debug('[FullPlayer] 点击下一首按钮');
			nextBtn.click();
		});
	}

	// 循环模式
	if(fullPlayerRepeat && loopBtn) {
		fullPlayerRepeat.addEventListener('click', () => {
			loopBtn.click();
			// 同步循环模式显示
			const mode = loopBtn.dataset.loop_mode;
			if(mode === '0') {
				fullPlayerRepeat.classList.remove('active');
			} else {
				fullPlayerRepeat.classList.add('active');
			}
		});
	}

	// 音量控制
	if(fullPlayerVolumeSlider && vol) {
		// 同步音量值 - 使用标志防止无限循环
		let isSyncingVolume = false;
		
		fullPlayerVolumeSlider.addEventListener('input', () => {
			if(isSyncingVolume) return; // 防止循环触发
			isSyncingVolume = true;
			vol.value = fullPlayerVolumeSlider.value;
			vol.dispatchEvent(new Event('input', { bubbles: true }));
			isSyncingVolume = false;
		});
		
		// 监听原始音量变化
		if(vol) {
			vol.addEventListener('input', (e) => {
				if(isSyncingVolume) return; // 防止循环触发
				isSyncingVolume = true;
				fullPlayerVolumeSlider.value = vol.value;
				isSyncingVolume = false;
			});
		}
	}

	// 进度条拖动
	let isDraggingProgress = false;
	let dragPercent = null;
	if(fullPlayerProgressBar) {
		fullPlayerProgressBar.addEventListener('mousedown', (e) => {
			isDraggingProgress = true;
			updateProgress(e);
		});

		document.addEventListener('mousemove', (e) => {
			if(isDraggingProgress) {
				updateProgress(e);
			}
		});

		document.addEventListener('mouseup', () => {
			if(isDraggingProgress) {
				isDraggingProgress = false;
				if(dragPercent !== null) {
					postSeek(dragPercent);
					dragPercent = null;
				}
			}
		});

		fullPlayerProgressBar.addEventListener('touchstart', (e) => {
			isDraggingProgress = true;
			updateProgress(e.touches[0]);
		}, { passive: true });

		document.addEventListener('touchmove', (e) => {
			if(isDraggingProgress) {
				updateProgress(e.touches[0]);
			}
		}, { passive: true });

		document.addEventListener('touchend', () => {
			if(isDraggingProgress) {
				isDraggingProgress = false;
				if(dragPercent !== null) {
					postSeek(dragPercent);
					dragPercent = null;
				}
			}
		}, { passive: true });

		function updateProgress(e) {
			const rect = fullPlayerProgressBar.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
			dragPercent = percent;
			
			if(fullPlayerProgressFill) {
				fullPlayerProgressFill.style.width = percent + '%';
			}
			if(fullPlayerProgressThumb) {
				fullPlayerProgressThumb.style.left = percent + '%';
			}
			const playerProgressFill = document.getElementById('playerProgressFill');
			const playerProgressThumb = document.getElementById('playerProgressThumb');
			if(playerProgressFill) playerProgressFill.style.width = percent + '%';
			if(playerProgressThumb) playerProgressThumb.style.left = percent + '%';
		}

		function postSeek(percent) {
			fetch('/seek', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: `percent=${percent}`
			}).catch(err => console.warn('[Seek] 请求失败', err));
		}
	}

	// Full-player UI syncs via unified main 5s status poll now
	// (removed redundant 500ms setInterval)
})();
(() => {
	// YouTube tab logic - now integrated into the main tab interface
	const youtubeSearchSection = document.getElementById('youtubeSearchSection');
	const playListSection = document.getElementById('playListSection');
	const playListContainer = document.getElementById('playListContainer');
	const clearQueueBtn = document.getElementById('clearQueueBtn');
	// localStorage keys and limits
	const STORAGE_KEY = 'youtube_history';
	const SEARCH_HISTORY_KEY = 'youtube_search_history';
	const MAX_LOCAL_HISTORY = 100;
	const MAX_SEARCH_HISTORY = 50;

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

	// Get search history
	function getSearchHistory(){
		try {
			const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch (e) {
			console.warn('[SearchHistory] Failed to parse search history:', e);
			return [];
		}
	}

	// Save search history (with deduplication)
	function saveSearchHistory(query){
		if(!query || !query.trim()) return;
		
		try {
			let history = getSearchHistory();
			// Remove if already exists (to move to top)
			history = history.filter(item => item.toLowerCase() !== query.toLowerCase().trim());
			// Add new item to front
			history.unshift(query.trim());
			// Keep only MAX_SEARCH_HISTORY items
			history = history.slice(0, MAX_SEARCH_HISTORY);
			localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
			console.debug('[SearchHistory] 已保存搜索: ' + query);
		} catch (e) {
			console.error('[SearchHistory] Error saving search history:', e);
		}
	}

	// Clear search history
	function clearSearchHistory(){
		try {
			localStorage.removeItem(SEARCH_HISTORY_KEY);
			console.debug('[SearchHistory] 搜索历史已清空');
		} catch (e) {
			console.error('[SearchHistory] Error clearing search history:', e);
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
		// History is now displayed via modal, not in the YouTube tab
		// This function is kept for compatibility but does nothing
		return;
	}

	function renderLocalHistory(){
		// History is now displayed via modal, not in the YouTube tab
		// This function is kept for compatibility but does nothing
		return;
	}

	// 通用的队列重新排序函数 (用于Desktop和Mobile)
	function performQueueReorder(sourceIdx, destIdx){
		fetch('/play_queue_reorder', {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: `from_index=${sourceIdx}&to_index=${destIdx}`
		})
		.then(r => r.json())
		.then(res => {
			if(res && res.status === 'OK') {
				console.debug('[Queue] 队列已重新排序');
				loadPlayList();
			} else {
				console.error('[Queue] 排序失败:', res && res.error);
				alert('排序失败: ' + (res && res.error || '未知错误'));
			}
		})
		.catch(e => {
			console.error('[Queue] 请求失败:', e);
			alert('请求失败: ' + e.message);
		});
	}

	// Load and display current queue (supports both local and YouTube)
	function loadPlayList(){
		if(!playListContainer || !playListSection) return;
		
		// Always show the queue section
		playListSection.style.display = 'block';
		
		// 始终加载合并的队列（本地 + YouTube）
		const apiEndpoint = '/combined_queue';
		
		fetch(apiEndpoint)
			.then(r => r.json())
			.then(res => {
				console.debug('[Queue] API 响应:', res);
				// 检查 API 返回状态和队列数据有效性
				if(res && res.status === 'OK' && Array.isArray(res.queue)){
					// 更新队列URL集合，用于检测重复
					window._queueUrlSet.clear();
					res.queue.forEach(item => {
						if(item.url) {
							window._queueUrlSet.add(item.url);
						}
					});
					// 保存队列数据到全局变量供 main.js 使用（用于获取时长信息）
					window._queueData = res;
					playListContainer.innerHTML = '';
					
					if(res.queue.length > 0){
						// 注意：current_index 可能为 0，不能用 || 回退
						const currentIndex = (typeof res.current_index === 'number') ? res.current_index : -1;
						console.debug('[Queue] 队列项数:', res.queue.length, '当前索引:', currentIndex, 'YouTube数量:', res.youtube_count);
						res.queue.forEach((item, idx) => {
							const div = document.createElement('div');
							const inQueue = item.in_queue === true;
							div.className = 'play-list-item collapsed';
							div.dataset.index = idx;
							div.dataset.type = item.type; // 标记类型
							div.dataset.inQueue = inQueue ? '1' : '0';
							div.draggable = inQueue; // 队列中的项（本地和YouTube都支持拖拽）
							
						// 在标题前添加类型标记
						let typeIcon = item.type === 'youtube' ? '▶️' : '🎵';
						let typeLabel = item.type === 'youtube' ? ' [YouTube]' : ' [本地]';
					
					// 获取封面图（优先使用真实缩略图）
					// 支持多种可能的缩略图字段
					const thumbnail = item.thumbnail || item.thumbnails || item.cover || item.art || '';
					
					// 如果是YouTube链接，尝试从URL提取视频ID并生成缩略图
					let thumbnailUrl = '';
					if(thumbnail) {
						thumbnailUrl = thumbnail;
					} else if(item.type === 'youtube' && item.url) {
						// 从YouTube URL提取视频ID
						const videoIdMatch = item.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
						if(videoIdMatch && videoIdMatch[1]) {
							thumbnailUrl = `https://img.youtube.com/vi/${videoIdMatch[1]}/mqdefault.jpg`;
						}
					}
					
					const coverHtml = thumbnailUrl ? 
						`<div class="queue-item-cover"><img src="${thumbnailUrl}" alt="" onerror="this.parentElement.innerHTML='${typeIcon}';"></div>` :
						`<div class="queue-item-cover">${typeIcon}</div>`;						// 艺术家信息
						const artist = item.uploader || item.channel || (item.type === 'youtube' ? 'YouTube' : '本地音乐');
						
						// 拖拽手柄（当前项和非当前项都支持）
						const dragHandle = inQueue ? `<span class="drag-handle" title="拖拽排序">☰</span>` : '';
						
						if(idx === currentIndex) {
							// 当前项：也可以被拖拽和删除
							div.classList.add('current', 'expanded');
							div.innerHTML = `
								<div class="queue-current-wrapper">
									<div class="queue-current-left">
										${coverHtml}
										<div class="queue-artist">${artist}</div>
									</div>
									<div class="queue-item-info">
										<div class="queue-title">${item.title}</div>
									</div>
									<div class="queue-current-badge">Track ${idx + 1} of ${res.queue.length}</div>
								</div>
								${dragHandle}
								<div class="play-list-item-delete">删除</div>
							`;
						} else {
							// 非当前项：可点击播放，添加拖拽手柄和删除按钮
							div.innerHTML = `
								<div class="play-list-item-wrapper">
									${coverHtml}
									<div class="queue-item-info">
										<div class="queue-title">${item.title}</div>
										<div class="queue-artist">${artist}</div>
									</div>
								</div>
								${dragHandle}
								<div class="play-list-item-delete">删除</div>
							`;
							div.style.cursor = 'pointer';
						}
						
						// 添加删除功能（当前项和非当前项都支持）
						const deleteBtn = div.querySelector('.play-list-item-delete');
						if(deleteBtn) {
							const handleDelete = (e) => {
								e.preventDefault();
								e.stopPropagation();
								e.stopImmediatePropagation();
								console.debug('[Queue] 删除点击', { idx, title: item.title });
								fetch('/play_queue_remove', {
									method: 'POST',
									headers: {'Content-Type': 'application/x-www-form-urlencoded'},
									body: `index=${idx}`
								})
								.then(r => r.json())
								.then(res => {
									if(res && res.status === 'OK') {
										loadPlayList();
									} else {
										alert('删除失败: ' + (res && res.error || '未知错误'));
									}
								})
								.catch(err => alert('删除失败: ' + err.message));
							};
							['click','touchend'].forEach(evt => deleteBtn.addEventListener(evt, handleDelete, { passive: false }));
						}
						
						// 左滑删除功能（当前项和非当前项都支持）
						let touchStartX = 0;
						let touchStartY = 0;
						let currentX = 0;
						let isSwiping = false;
						let swipeThreshold = 80;
						
						// 对于当前项，使用 queue-current-wrapper 作为包装器，对于非当前项使用 play-list-item-wrapper
						let swipeWrapper = null;
						if(idx === currentIndex) {
							swipeWrapper = div.querySelector('.queue-current-wrapper');
						} else {
							swipeWrapper = div.querySelector('.play-list-item-wrapper');
						}
						
						div.addEventListener('touchstart', (e) => {
							touchStartX = e.touches[0].clientX;
							touchStartY = e.touches[0].clientY;
							isSwiping = false;
						}, { passive: true });
						
						div.addEventListener('touchmove', (e) => {
							if(!swipeWrapper) return;
							const touchX = e.touches[0].clientX;
							const touchY = e.touches[0].clientY;
							const deltaX = touchX - touchStartX;
							const deltaY = touchY - touchStartY;
							
							if(!isSwiping && Math.abs(deltaY) > Math.abs(deltaX)) {
								return;
							}
							
							if(Math.abs(deltaX) > 10) {
								isSwiping = true;
								e.preventDefault();
							}
							
							if(isSwiping && deltaX > 0) {
								currentX = Math.min(deltaX, swipeThreshold);
								swipeWrapper.style.transform = `translateX(${currentX}px)`;
								swipeWrapper.style.transition = 'none';
							}
						}, { passive: false });
						
						div.addEventListener('touchend', () => {
							if(!swipeWrapper) return;
							swipeWrapper.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.0, 0.0, 1.0)';
							
							if(currentX > 40) {
								swipeWrapper.style.transform = `translateX(${swipeThreshold}px)`;
								div.classList.add('swiped');
							} else {
								swipeWrapper.style.transform = 'translateX(0)';
								div.classList.remove('swiped');
							}
							currentX = 0;
							isSwiping = false;
						}, { passive: true });
						
						// 非当前项的点击播放功能
						if(idx !== currentIndex) {
							div.addEventListener('click', (e) => {
								// 如果点击的是删除按钮或其子元素，阻止播放
								if (e.target.closest && e.target.closest('.play-list-item-delete')) {
									return;
								}
								// 如果点击的是拖拽手柄，不触发播放
								if(e.target.classList.contains('drag-handle')) {
									return;
								}
								// 无论是本地还是YouTube，都使用 /play_queue_play 来正确更新 CURRENT_QUEUE_INDEX
								console.debug('[Queue] 点击队列项:', item.type, item.title, '索引:', idx, 'inQueue:', inQueue);
								if(item.type === 'local') {
									if(inQueue) {
										// 队列中的本地文件：idx 就是 PLAY_QUEUE 中的真实索引
										console.debug('[Queue] 播放本地队列文件，队列索引:', idx);
										fetch('/play_queue_play', {
											method: 'POST',
											headers: {'Content-Type': 'application/x-www-form-urlencoded'},
											body: `index=${idx}`
										})
										.then(r => r.json())
										.then(res => {
											if(res && res.status === 'OK') {
												console.debug('[Queue] 播放本地队列文件成功');
												setTimeout(() => loadPlayList(), 100);
											} else {
												console.error('[Queue] 播放失败:', res && res.error);
											}
										})
										.catch(e => console.error('[Queue] 请求失败:', e));
									} else {
										// 历史记录中的本地文件：使用 /play 接口播放（不入队）
										fetch('/play', {
											method: 'POST',
											headers: {'Content-Type': 'application/x-www-form-urlencoded'},
											body: `path=${encodeURIComponent(item.url)}&skip_history=1`
										})
										.then(r => r.json())
										.then(res => {
											if(res && res.status === 'OK') {
												console.debug('[LocalHistory] 播放本地文件:', item.url);
												setTimeout(() => loadPlayList(), 100);
											} else {
												console.error('[LocalHistory] 播放失败:', res && res.error);
											}
										})
										.catch(e => console.error('[LocalHistory] 请求失败:', e));
									}
								} else if(item.type === 'youtube') {
									// YouTube 文件：优先在现有队列播放，不在队列则直接添加并播放
									if(inQueue) {
										fetch('/play_queue')
											.then(r => r.json())
											.then(ytRes => {
												if(ytRes && ytRes.status === 'OK' && ytRes.queue) {
													const ytIndex = ytRes.queue.findIndex(q => q.url === item.url);
													if(ytIndex >= 0) {
														fetch('/play_queue_play', {
															method: 'POST',
															headers: {'Content-Type': 'application/x-www-form-urlencoded'},
															body: `index=${ytIndex}`
														})
														.then(r => r.json())
														.then(res => {
															if(res && res.status === 'OK') {
																console.debug('[PlayList] 播放队列项:', ytIndex);
																setTimeout(() => loadPlayList(), 100);
															} else {
																console.error('[PlayList] 播放失败:', res && res.error);
															}
														})
														.catch(e => console.error('[PlayList] 请求失败:', e));
													}
												}
											})
											.catch(e => console.error('[PlayList] 获取队列失败:', e));
									} else {
										// 不在当前队列：追加到队列尾部（不直接播放）
										fetch('/play_queue_add', {
											method: 'POST',
											headers: {'Content-Type': 'application/x-www-form-urlencoded'},
											body: 'url=' + encodeURIComponent(item.url) + '&title=' + encodeURIComponent(item.title || '') + '&type=youtube'
										})
										.then(r => r.json())
										.then(res => {
											if(res && res.status === 'OK') {
												console.debug('[PlayList] 已追加到队列尾部:', item.url);
												setTimeout(() => loadPlayList(), 150);
											} else {
												console.error('[PlayList] 入队失败:', res && res.error);
											}
										})
										.catch(e => console.error('[PlayList] 入队请求失败:', e));
									}
								}
							});
						}
						
						// 队列中的项都支持拖拽和展开/折叠
						if(inQueue) {
							// 获取拖拽手柄
							const dragHandle = div.querySelector('.drag-handle');
							
							// 仅YouTube项支持展开/折叠
							if(item.type === 'youtube') {
								// 添加展开/折叠切换事件（在展开/折叠按钮区域）
								div.addEventListener('contextmenu', (e) => {
									e.preventDefault();
									e.stopPropagation();
									if(div.classList.contains('collapsed')) {
										div.classList.remove('collapsed');
										div.classList.add('expanded');
									} else if(div.classList.contains('expanded')) {
										div.classList.remove('expanded');
										div.classList.add('collapsed');
									}
								});
								
								// 长按或双击也能切换展开/折叠
								let clickCount = 0;
								let clickTimer = null;
								div.addEventListener('click', (e) => {
									// 如果点击的是拖拽手柄，不触发展开/折叠
									if(e.target.classList.contains('drag-handle')) {
										return;
									}
									// 如果是非当前项，且不是在拖拽，则可以双击切换展开/折叠
									if(!div.classList.contains('current') && !div.classList.contains('dragging')) {
										clickCount++;
										if(clickCount === 1) {
											clickTimer = setTimeout(() => {
												clickCount = 0;
											}, 300);
										} else if(clickCount === 2) {
											clearTimeout(clickTimer);
											clickCount = 0;
											if(div.classList.contains('collapsed')) {
												div.classList.remove('collapsed');
												div.classList.add('expanded');
											} else if(div.classList.contains('expanded')) {
												div.classList.remove('expanded');
												div.classList.add('collapsed');
											}
											e.stopPropagation();
										}
									}
								});
							}
							
							// 拖拽状态跟踪 (用于移动端)
							let touchDragState = null;
							
							// 禁用整个 div 的默认拖拽
							div.draggable = false;
							
							// 只在拖拽手柄上启用拖拽
							if(dragHandle) {
								dragHandle.draggable = true;
								
								// Desktop Drag & Drop API 支持
								dragHandle.addEventListener('dragstart', (e) => {
									div.classList.add('dragging');
									e.dataTransfer.effectAllowed = 'move';
									e.dataTransfer.setData('text/plain', idx);
									e.dataTransfer.setDragImage(new Image(), 0, 0);
									console.debug('[Drag] 开始拖动队列项:', idx);
								});
								
								dragHandle.addEventListener('dragend', (e) => {
									document.querySelectorAll('.play-list-item.dragging, .play-list-item.drag-over').forEach(el => {
										el.classList.remove('dragging', 'drag-over', 'drag-over-after');
									});
									console.debug('[Drag] 拖拽结束');
								});
							}
							
							div.addEventListener('dragover', (e) => {
								e.preventDefault();
								e.dataTransfer.dropEffect = 'move';
								
								document.querySelectorAll('.play-list-item.drag-over').forEach(el => {
									if(el !== div) el.classList.remove('drag-over', 'drag-over-after');
								});
								
								const rect = div.getBoundingClientRect();
								const midpoint = rect.top + rect.height / 2;
								div.classList.add('drag-over');
								
								if(e.clientY < midpoint) {
									div.classList.remove('drag-over-after');
								} else {
									div.classList.add('drag-over-after');
								}
							}, { passive: false });
							
							div.addEventListener('dragleave', (e) => {
								const rect = div.getBoundingClientRect();
								if(e.clientX < rect.left || e.clientX > rect.right || 
								   e.clientY < rect.top || e.clientY > rect.bottom) {
									div.classList.remove('drag-over', 'drag-over-after');
								}
							});
							
							div.addEventListener('drop', (e) => {
								e.preventDefault();
								e.stopPropagation();
								const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'));
								const targetIdx = idx;
								
								document.querySelectorAll('.play-list-item.drag-over, .play-list-item.dragging').forEach(el => {
									el.classList.remove('drag-over', 'drag-over-after', 'dragging');
								});
								
								if(sourceIdx !== targetIdx) {
									const rect = div.getBoundingClientRect();
									const midpoint = rect.top + rect.height / 2;
									const insertAfter = e.clientY > midpoint;
									const destIdx = insertAfter ? targetIdx + 1 : targetIdx;
									
									console.debug('[Drag] 拖拽完成:', sourceIdx, '到', destIdx);
									performQueueReorder(sourceIdx, destIdx);
								}
							}, { passive: false });
							
							// ===== 移动端 Touch 拖拽支持 =====
							if(dragHandle) {
								dragHandle.addEventListener('touchstart', (e) => {
									// 阻止触摸事件冒泡，避免触发歌曲点击
									e.stopPropagation();
									touchDragState = {
										sourceIdx: idx,
										startY: e.touches[0].clientY,
										startTime: Date.now(),
										isDragging: false
									};
									// 立即开始拖拽（不需要长按）
									const touchStartTimeout = setTimeout(() => {
										if(touchDragState) {
											touchDragState.isDragging = true;
											div.classList.add('dragging');
											console.debug('[Touch] 开始拖动队列项:', idx);
										}
									}, 300); // 300ms延迟，避免误触
									touchDragState.timeout = touchStartTimeout;
								}, { passive: true });
							}
							
							div.addEventListener('touchmove', (e) => {
								if(!touchDragState) return;
								
								// 如果还没有进入拖拽模式，允许正常滚动
								if(!touchDragState.isDragging) {
									// 3秒内移动触发滚动，不取消长按计时器
									return; // 允许默认滚动行为
								}
								
								// 已进入拖拽模式（超过3秒），阻止滚动，执行排序
								e.preventDefault();
								const currentY = e.touches[0].clientY;
								
								// 查找当前手指位置下面的队列项
								const allItems = Array.from(document.querySelectorAll('.play-list-item'));
								const targetItem = allItems.find(item => {
									const rect = item.getBoundingClientRect();
									return currentY >= rect.top && currentY <= rect.bottom;
								});
								
								if(targetItem && targetItem !== div) {
									// 移除其他项的悬停样式
									allItems.forEach(item => item.classList.remove('drag-over', 'drag-over-after'));
									
									// 确定是在目标项的上方还是下方
									const targetRect = targetItem.getBoundingClientRect();
									const midpoint = targetRect.top + targetRect.height / 2;
									targetItem.classList.add('drag-over');
									
									if(currentY < midpoint) {
										targetItem.classList.remove('drag-over-after');
										touchDragState.targetItem = targetItem;
										touchDragState.insertAfter = false;
									} else {
										targetItem.classList.add('drag-over-after');
										touchDragState.targetItem = targetItem;
										touchDragState.insertAfter = true;
									}
								}
							}, { passive: false });
							
							div.addEventListener('touchend', (e) => {
								if(!touchDragState) return;
								
								// 清除长按超时
								if(touchDragState.timeout) clearTimeout(touchDragState.timeout);
								
								if(touchDragState.isDragging && touchDragState.targetItem) {
									const targetIdx = parseInt(touchDragState.targetItem.dataset.index);
									const sourceIdx = touchDragState.sourceIdx;
									
									if(sourceIdx !== targetIdx) {
										const insertAfter = touchDragState.insertAfter;
										const destIdx = insertAfter ? targetIdx + 1 : targetIdx;
										
										console.debug('[Touch] 拖拽完成:', sourceIdx, '到', destIdx);
										performQueueReorder(sourceIdx, destIdx);
									}
								}
								
								// 清除所有拖拽样式
								document.querySelectorAll('.play-list-item.dragging, .play-list-item.drag-over').forEach(el => {
									el.classList.remove('dragging', 'drag-over', 'drag-over-after');
								});
								
								touchDragState = null;
								console.debug('[Touch] 拖拽结束');
							}, { passive: true });
							
							div.addEventListener('touchcancel', (e) => {
								if(!touchDragState) return;
								if(touchDragState.timeout) clearTimeout(touchDragState.timeout);
								document.querySelectorAll('.play-list-item.dragging, .play-list-item.drag-over').forEach(el => {
									el.classList.remove('dragging', 'drag-over', 'drag-over-after');
								});
								touchDragState = null;
							}, { passive: true });
						}
						
						playListContainer.appendChild(div);
						});
						
						// 自动滚动到当前播放项
						if(currentIndex >= 0) {
							const currentItem = playListContainer.querySelector('.play-list-item.current');
							if(currentItem) {
								// 延迟执行滚动，确保 DOM 已完全渲染
								setTimeout(() => {
									currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
									console.debug('[Queue] 已滚动到当前项，索引:', currentIndex);
								}, 50);
							}
						}
					} else {
						// 队列为空，显示提示信息
						console.debug('[Queue] 队列为空，显示提示');
						playListContainer.innerHTML = `<div style="padding:16px; text-align:center; color:#888;">
							<div style="margin-bottom:8px;">暂无队列</div>
							<div style="font-size:12px; color:#666;">播放本地音乐或YouTube视频后会显示在这里</div>
						</div>`;
					}
				} else {
					// API 返回异常或数据格式错误
					console.warn('[Queue] API返回数据异常:', res);
					playListContainer.innerHTML = `<div style="padding:16px; text-align:center; color:#888;">
						<div style="margin-bottom:8px;">队列加载失败</div>
						<div style="font-size:12px; color:#666;">请刷新页面重试</div>
					</div>`;
				}
			})
			.catch(e => {
				console.error('[Queue] 加载队列失败:', e);
				playListContainer.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">加载失败</div>';
			});
	}

	// 当标签页显示时加载历史和队列
	window.addEventListener('tabswitched', (e) => {
		if(e.detail && e.detail.tab === 'youtube'){
			loadYoutubeHistory();
			loadPlayList();
			// 队列更新由main.js 5s轮询处理
		}
	}, { passive: true });

	// 清空队列函数
	function clearPlayList() {
		if(confirm('确定要清空当前播放队列吗？')) {
			fetch('/play_queue_clear', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'}
			})
			.then(r => r.json())
			.then(res => {
				if(res && res.status === 'OK') {
					console.debug('[UI] 队列已清空');
					loadPlayList();
				} else {
					console.error('[UI] 清空失败:', res && res.error);
					alert('清空队列失败: ' + (res && res.error || '未知错误'));
				}
			})
			.catch(e => {
				console.error('[UI] 请求失败:', e);
				alert('请求失败: ' + e.message);
			});
		}
	}

	// 清空队列按钮（保留以兼容旧版本，但不显示）
	if(clearQueueBtn) {
		clearQueueBtn.addEventListener('click', clearPlayList, { passive: true });
	}

	// 初始化加载历史记录和队列（当DOM就绪时）
	window.addEventListener('DOMContentLoaded', () => {
		loadYoutubeHistory();
		loadPlayList();
		initLocalSongsModal();
		initYoutubeSearch();
		// 队列更新由main.js 5s轮询处理
	}, { passive: true });
	
	// 备用方案：如果DOM已经加载完毕，直接加载
	if(document.readyState === 'interactive' || document.readyState === 'complete'){
		loadYoutubeHistory();
		loadPlayList();
		initLocalSongsModal();
		initYoutubeSearch();
		// 队列更新由main.js 5s轮询处理
	}

	// 展示播放历史（由main.js定义，这里作为包装）
	function showYoutubeHistory() {
		const historyModal = document.getElementById('historyModal');
		const historyList = document.getElementById('historyList');
		
		if(!historyModal || !historyList) {
			console.error('[History] 历史模态框元素未找到');
			return;
		}

		// 加载历史记录
		fetch('/youtube_history?limit=50')
			.then(r => r.json())
			.then(j => {
				if(j.status !== 'OK') {
					historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">无法加载历史记录</div>';
					return;
				}
				const history = j.history || [];
				if(history.length === 0) {
					historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">暂无播放历史</div>';
					historyModal.classList.add('show');
					return;
				}
				historyList.innerHTML = history.map((item, idx) => {
					let displayName = item.name || item.title || '未知';
					if(!displayName || displayName === '加载中…') {
						try {
							const url = item.url || '';
							if(url.includes('youtube')) {
								displayName = '播放列表或视频';
							} else {
								const urlObj = new URL(url);
								displayName = urlObj.hostname || displayName;
							}
						} catch(e) {
							displayName = '未知';
						}
					}
					const url = item.url || '';
					const itemType = item.type || 'unknown';
					return `<div class="history-item" data-url="${url.replace(/"/g, '&quot;')}" data-type="${itemType}">
						<div class="history-item-info">
							<div class="history-item-name">${displayName}</div>
							<div class="history-item-url">${url.substring(0, 100)}${url.length > 100 ? '...' : ''}</div>
						</div>
						<button class="history-item-delete" data-index="${idx}" title="删除">✕</button>
					</div>`;
				}).join('');

				// 添加点击处理器
				historyList.querySelectorAll('.history-item').forEach(item => {
					item.addEventListener('click', (e) => {
						if(!e.target.classList.contains('history-item-delete')) {
							const url = item.dataset.url;
							const itemType = item.dataset.type;
							if(url) {
								console.debug('[History] 播放历史项目:', url, '类型:', itemType);
								// 触发播放逻辑
								if(itemType === 'local') {
									fetch('/play', {
										method: 'POST',
										headers: {'Content-Type': 'application/x-www-form-urlencoded'},
										body: 'path=' + encodeURIComponent(url)
									})
									.then(r => r.json())
									.then(j => {
										if(j.status !== 'OK') {
											console.warn('播放失败:', j.error);
											alert('播放失败: ' + j.error);
										}
									})
									.catch(e => console.error('播放请求错误:', e));
								} else {
									fetch('/play_youtube_queue', {
										method: 'POST',
										headers: {'Content-Type': 'application/x-www-form-urlencoded'},
										body: 'url=' + encodeURIComponent(url)
									})
									.then(r => r.json())
									.then(j => {
										if(j && j.status === 'OK') {
											console.debug('[History] YouTube 队列已更新');
											historyModal.classList.remove('show');
										} else {
											console.error('[History] 播放失败:', j && j.error);
										}
									})
									.catch(e => console.error('[History] 请求失败:', e));
								}
							}
						}
					});
				});

				// 添加删除处理器
				historyList.querySelectorAll('.history-item-delete').forEach(btn => {
					btn.addEventListener('click', (e) => {
						e.stopPropagation();
						const item = e.target.closest('.history-item');
						item.remove();
					});
				});

				// 显示模态框
				historyModal.classList.add('show');
			})
			.catch(e => {
				console.error('加载历史失败:', e);
				historyList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">加载失败</div>';
				historyModal.classList.add('show');
			});
	}

	// 初始化本地歌曲模态框
	function initLocalSongsModal() {
		const localSongsModal = document.getElementById('localSongsModal');
		const localSongsModalBody = document.getElementById('localSongsModalBody');
		const localSongsModalClose = document.querySelector('.local-songs-modal-close');
		const treeEl = document.getElementById('tree');
		const localMenuBtn = document.getElementById('localMenuBtn');
		let treePlaceholder = null;

		// 本地歌曲菜单项：弹出本地歌曲窗口
		function openLocalSongsModal() {
			// Auto-close full player to prevent overlap
			const fullPlayer = document.getElementById('fullPlayer');
			if(fullPlayer && fullPlayer.style.display !== 'none') {
				fullPlayer.style.display = 'none';
			}
			if(!localSongsModal || !localSongsModalBody || !treeEl) return;
			// 创建占位符用于关闭时还原
			if(!treePlaceholder) {
				treePlaceholder = document.createElement('div');
				treePlaceholder.id = 'treePlaceholder';
				treePlaceholder.style.display = 'none';
				treeEl.parentNode.insertBefore(treePlaceholder, treeEl);
			}
			// 将现有的树节点移入弹窗，保持事件绑定
			localSongsModalBody.innerHTML = '';
			localSongsModalBody.appendChild(treeEl);
			treeEl.style.display = 'block';
			localSongsModal.style.display = 'flex';
		}
		
		// 暴露到全局作用域供底部导航栏调用
		window.openLocalSongsModal = openLocalSongsModal;

		function closeLocalSongsModal() {
			if(!localSongsModal || !localSongsModalBody || !treeEl || !treePlaceholder) return;
			localSongsModal.style.display = 'none';
			// 还原树节点到原位置并隐藏
			treePlaceholder.parentNode.replaceChild(treeEl, treePlaceholder);
			treeEl.style.display = 'none';
			treePlaceholder = null;
		}
		
		// 暴露到全局作用域供底部导航栏调用
		window.closeLocalSongsModal = closeLocalSongsModal;

		if(localMenuBtn) {
			localMenuBtn.addEventListener('click', () => {
				openLocalSongsModal();
			}, { passive: true });
		}

		if(localSongsModalClose) {
			localSongsModalClose.addEventListener('click', () => {
				closeLocalSongsModal();
			}, { passive: true });
		}

		// 点击模态背景关闭
		if(localSongsModal) {
			localSongsModal.addEventListener('click', (e) => {
				if(e.target === localSongsModal) {
					closeLocalSongsModal();
				}
			}, { passive: true });
		}
	}

	// YouTube搜索功能
	function initYoutubeSearch() {
		const youtubeSearchInput = document.getElementById('youtubeSearchInput');
		const youtubeSearchBtn = document.getElementById('youtubeSearchBtn');
		const youtubeMenuBtn = document.getElementById('youtubeMenuBtn');
		const youtubeMenu = document.getElementById('youtubeMenu');
		const youtubeSearchHistory = document.getElementById('youtubeSearchHistory');
		const youtubeSearchHistoryList = document.getElementById('youtubeSearchHistoryList');
		const historyMenuBtn = document.getElementById('historyMenuBtn');
		const clearQueueMenuBtn = document.getElementById('clearQueueMenuBtn');
		const youtubeSearchModal = document.getElementById('youtubeSearchModal');
		const youtubeSearchModalList = document.getElementById('youtubeSearchModalList');
		const youtubeSearchModalClose = document.querySelector('.youtube-search-modal-close');

		if(!youtubeSearchBtn) return;

		// 显示搜索历史下拉列表
		function showSearchHistoryDropdown() {
			const history = getSearchHistory();
			if(history.length === 0) {
				youtubeSearchHistory.style.display = 'none';
				return;
			}

			youtubeSearchHistoryList.innerHTML = history.map(item => {
				return `<div class="youtube-search-history-item">${item}</div>`;
			}).join('');

			youtubeSearchHistory.style.display = 'block';

			// 为历史项添加点击事件
			youtubeSearchHistoryList.querySelectorAll('.youtube-search-history-item').forEach(item => {
				item.addEventListener('click', () => {
					youtubeSearchInput.value = item.textContent;
					youtubeSearchHistory.style.display = 'none';
					performSearch();
				}, { passive: true });
			});
		}

		// 隐藏搜索历史下拉列表
		function hideSearchHistoryDropdown() {
			youtubeSearchHistory.style.display = 'none';
		}

		// 搜索框 focus 事件 - 显示搜索历史
		youtubeSearchInput.addEventListener('focus', showSearchHistoryDropdown, { passive: true });

		// 搜索框 blur 事件 - 隐藏搜索历史（延迟，避免点击事件不生效）
		youtubeSearchInput.addEventListener('blur', () => {
			setTimeout(() => hideSearchHistoryDropdown(), 200);
		}, { passive: true });

		// 搜索按钮点击
		youtubeSearchBtn.addEventListener('click', performSearch, { passive: true });
		youtubeSearchInput.addEventListener('keypress', (e) => {
			if(e.key === 'Enter') performSearch();
		}, { passive: true });

		// 菜单按钮点击
		if(youtubeMenuBtn) {
			youtubeMenuBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				youtubeMenu.style.display = youtubeMenu.style.display === 'none' ? 'block' : 'none';
			}, { passive: true });
		}

		// 菜单项点击
		if(historyMenuBtn) {
			historyMenuBtn.addEventListener('click', () => {
				youtubeMenu.style.display = 'none';
				showYoutubeHistory();
			}, { passive: true });
		}

		if(clearQueueMenuBtn) {
			clearQueueMenuBtn.addEventListener('click', () => {
				youtubeMenu.style.display = 'none';
				clearPlayList();
			}, { passive: true });
		}

		// 点击外部关闭菜单
		document.addEventListener('click', (e) => {
			if(youtubeMenu && youtubeMenuBtn && !youtubeMenuBtn.contains(e.target) && !youtubeMenu.contains(e.target)) {
				youtubeMenu.style.display = 'none';
			}
		}, { passive: true });

		// 搜索模态框关闭按钮
		if(youtubeSearchModalClose) {
			youtubeSearchModalClose.addEventListener('click', () => {
				youtubeSearchModal.classList.remove('show');
			}, { passive: true });
		}

		// 点击模态框背景关闭
		if(youtubeSearchModal) {
			youtubeSearchModal.addEventListener('click', (e) => {
				if(e.target === youtubeSearchModal) {
					youtubeSearchModal.classList.remove('show');
				}
			}, { passive: true });
		}

		function performSearch() {
			const query = youtubeSearchInput.value.trim();
			if(!query) {
				alert('请输入搜索关键字或YouTube地址');
				return;
			}

			// 保存搜索历史
			saveSearchHistory(query);

			// 检查是否为 YouTube URL
			let isYouTubeUrl = false;
			let isPlaylist = false;
			try {
				const urlObj = new URL(query);
				const host = urlObj.hostname.toLowerCase();
				isYouTubeUrl = host.includes('youtube.com') || host.includes('youtu.be');
				// 检查是否为播放列表
				if(isYouTubeUrl) {
					isPlaylist = urlObj.search.includes('list=') || query.includes('/playlist');
				}
			} catch (e) {
				// 不是有效的 URL，作为搜索关键字处理
			}

			if(isYouTubeUrl) {
				if(isPlaylist) {
					// 是播放列表 URL，提取列表内容
					youtubeSearchBtn.disabled = true;
					youtubeSearchBtn.textContent = '加载中...';
					
					console.debug('[UI] 检测到播放列表 URL，提取列表内容');
					
					// 使用后端 API 提取播放列表
					fetch('/youtube_extract_playlist', {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: 'url=' + encodeURIComponent(query)
					})
					.then(r => r.json())
					.then(res => {
						youtubeSearchBtn.disabled = false;
						youtubeSearchBtn.textContent = '搜索';
						
						if(res && res.status === 'OK' && res.entries && res.entries.length > 0) {
							youtubeSearchInput.value = '';
							// 显示播放列表内容
							const entries = res.entries;
							youtubeSearchModalList.innerHTML = entries.map((item, idx) => {
								const url = item.url || '';
								const title = item.title || '未知';
								const positionLabel = `${idx + 1}/${entries.length}`;
								return `<div class="youtube-search-item" data-url="${url.replace(/"/g, '&quot;')}" data-title="${title.replace(/"/g, '&quot;')}">
									<div class="youtube-search-index">${idx + 1}</div>
									<div class="youtube-search-item-body">
										<div class="youtube-search-item-title">${title}</div>
										<div class="youtube-search-item-meta">
											<span>播放列表曲目</span>
										</div>
									</div>
									<div class="youtube-search-item-duration">${positionLabel}</div>
								</div>`;
							}).join('');
							youtubeSearchModal.classList.add('show');

							// Add click handlers - add to queue without interrupting playback
							youtubeSearchModalList.querySelectorAll('.youtube-search-item').forEach(item => {
								item.addEventListener('click', (e) => {
									const url = item.dataset.url;
									const title = item.dataset.title;
									if(url) {
										fetch('/play', {
											method: 'POST',
											headers: {'Content-Type': 'application/x-www-form-urlencoded'},
											body: `url=${encodeURIComponent(url)}&play_now=0`
										})
										.then(r => r.json())
										.then(res => {
											if(res && res.status === 'OK') {
												console.debug('[UI] 已添加到队列:', title);
												item.classList.add('added-to-queue');
												loadPlayList();
											} else {
												console.error('[UI] 添加失败:', res && res.error);
												alert('添加到队列失败: ' + (res && res.error || '未知错误'));
											}
										})
										.catch(e => {
											console.error('[UI] 请求失败:', e);
											alert('添加到队列失败: ' + e.message);
										});
									}
								});
							});
						} else {
							alert('播放列表为空或获取失败: ' + (res && res.error || '未知错误'));
						}
					})
					.catch(e => {
						youtubeSearchBtn.disabled = false;
						youtubeSearchBtn.textContent = '搜索';
						console.error('提取播放列表失败:', e);
						alert('提取播放列表失败: ' + e.message);
					});
				} else {
					// 是单个视频 URL，添加到队列
					youtubeSearchBtn.disabled = true;
					youtubeSearchBtn.textContent = '加入队列中...';
				
					fetch('/play', {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: 'url=' + encodeURIComponent(query) + '&play_now=0'
					})
					.then(r => r.json())
					.then(res => {
						youtubeSearchBtn.disabled = false;
						youtubeSearchBtn.textContent = '搜索';
					
						if(res && res.status === 'OK') {
							youtubeSearchInput.value = '';
							loadPlayList();
						} else {
							alert('加入队列失败: ' + (res && res.error || '未知错误'));
						}
					})
					.catch(e => {
						youtubeSearchBtn.disabled = false;
						youtubeSearchBtn.textContent = '搜索';
						console.error('加入队列失败:', e);
						alert('加入队列失败: ' + e.message);
					});
				}
			} else {
				// 是搜索关键字，执行搜索
				youtubeSearchBtn.disabled = true;
				youtubeSearchBtn.textContent = '搜索中...';

				fetch('/search_youtube', {
					method: 'POST',
					headers: {'Content-Type': 'application/x-www-form-urlencoded'},
					body: 'query=' + encodeURIComponent(query)
				})
				.then(r => r.json())
				.then(j => {
					youtubeSearchBtn.disabled = false;
					youtubeSearchBtn.textContent = '搜索';

					if(j.status !== 'OK') {
						alert('搜索失败: ' + (j.error || '未知错误'));
						return;
					}

					const results = j.results || [];
					if(results.length === 0) {
						youtubeSearchModalList.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">未找到结果</div>';
						youtubeSearchModal.classList.add('show');
						return;
					}

					youtubeSearchModalList.innerHTML = results.map((item, idx) => {
						const duration = formatDuration(item.duration);
						return `<div class="youtube-search-item" data-url="${item.url.replace(/"/g, '&quot;')}" data-title="${item.title.replace(/"/g, '&quot;')}">
							<div class="youtube-search-index">${idx + 1}</div>
							<div class="youtube-search-item-body">
								<div class="youtube-search-item-title">${item.title}</div>
								<div class="youtube-search-item-meta">
									${item.uploader ? `<span>${item.uploader}</span>` : ''}
								</div>
							</div>
							<div class="youtube-search-item-duration">${duration || ''}</div>
						</div>`;
					}).join('');
					youtubeSearchModal.classList.add('show');

					// Add click handlers - add to queue without interrupting playback
					youtubeSearchModalList.querySelectorAll('.youtube-search-item').forEach(item => {
						item.addEventListener('click', (e) => {
							const url = item.dataset.url;
							const title = item.dataset.title;
							if(url) {
								// 添加到队列而不中断当前播放
								fetch('/play', {
									method: 'POST',
									headers: {'Content-Type': 'application/x-www-form-urlencoded'},
									body: `url=${encodeURIComponent(url)}&play_now=0`
								})
								.then(r => r.json())
								.then(res => {
									if(res && res.status === 'OK') {
										console.debug('[UI] 已添加到队列:', title);
										// 改变背景色表示已添加
										item.classList.add('added-to-queue');
										// 重新加载队列显示
										loadPlayList();
									} else {
										console.error('[UI] 添加失败:', res && res.error);
										alert('添加到队列失败: ' + (res && res.error || '未知错误'));
									}
								})
								.catch(e => {
									console.error('[UI] 请求失败:', e);
									alert('添加到队列失败: ' + e.message);
								});
							}
						});
					});
				})
				.catch(e => {
					youtubeSearchBtn.disabled = false;
					youtubeSearchBtn.textContent = '搜索';
					console.error('搜索失败:', e);
					alert('搜索失败: ' + e.message);
				});
			}
		}
	}

	function formatDuration(seconds) {
		if(!seconds) return '未知';
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		if(hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
		}
		return `${minutes}:${String(secs).padStart(2, '0')}`;
	}

	// ===== Apple Music Style Mini Player =====
	const miniPlayer = document.getElementById('miniPlayer');
	const miniPlayerTitle = document.getElementById('miniPlayerTitle');
	const miniPlayerArtist = document.getElementById('miniPlayerArtist');
	const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
	const miniNextBtn = document.getElementById('miniNextBtn');
	const miniPlayerProgressFill = document.getElementById('miniPlayerProgressFill');
	
	// Update mini player status
	function updateMiniPlayer() {
		fetch('/status').then(r=>r.json()).then(j=>{
			if(j.status!=='OK') return;
			
			const rel = j.playing ? (j.playing.rel || j.playing.url) : null;
			if(!j.playing || !rel) {
				miniPlayerTitle.textContent = '未播放';
				miniPlayerArtist.textContent = '--';
				miniPlayerProgressFill.style.width = '0%';
				const coverImg = document.getElementById('miniPlayerCover');
				if(coverImg) coverImg.style.display = 'none';
				return;
			}
			
			// Update cover image
			const coverImg = document.getElementById('miniPlayerCover');
			const thumbnail = j.playing.thumbnail_url || j.playing.thumbnail || '';
			if(coverImg) {
				if(thumbnail) {
					coverImg.src = thumbnail;
					coverImg.style.display = 'block';
					coverImg.onerror = () => { coverImg.style.display = 'none'; };
				} else {
					coverImg.style.display = 'none';
				}
			}
			
			// Update title
			let displayName = (j.playing.media_title && j.playing.media_title.length) ? j.playing.media_title : null;
			if(!displayName) {
				const nameField = j.playing.name || rel || '';
				displayName = nameField.startsWith('http') ? '加载中…' : nameField;
			}
			miniPlayerTitle.textContent = displayName;
			
			// Update artist/source
			if(j.playing.type === 'youtube') {
				miniPlayerArtist.textContent = 'YouTube';
			} else {
				miniPlayerArtist.textContent = '本地音乐';
			}
			
			// Update progress bar
			let duration = (j.mpv && j.mpv.duration) || 0;
			if(j.mpv && j.mpv.time!=null && duration > 0) {
				const t = j.mpv.time || 0;
				const pct = Math.min(100, Math.max(0, t/duration*100));
				miniPlayerProgressFill.style.width = pct.toFixed(2) + '%';
			}
			
			// Update play/pause button
			if(j.mpv) {
				miniPlayPauseBtn.textContent = j.mpv.paused ? '▶' : '⏸';
			}
		}).catch(e => console.error('[MiniPlayer] Update failed:', e));
	}
	
	// Mini player play/pause button event
	if(miniPlayPauseBtn) {
		miniPlayPauseBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			fetch('/toggle_pause', {method:'POST'})
				.then(r=>r.json())
				.then(j=>{
					if(j && j.status === 'OK') {
						setTimeout(updateMiniPlayer, 100);
					}
				})
				.catch(err => console.error('[MiniPlayer] Pause failed:', err));
		});
	}
	
	// Mini player next button event
	if(miniNextBtn) {
		miniNextBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			// Try queue_next first (for YouTube queue), fallback to /next (for local playlist)
			fetch('/queue_next', {method:'POST'})
				.then(r => r.json())
				.then(j=>{
					if(j && j.status === 'OK') {
						setTimeout(updateMiniPlayer, 100);
					}
				})
				.catch(err => {
					console.warn('[MiniPlayer] queue_next failed, trying /next:', err);
					// Fallback to /next
					fetch('/next', {method:'POST'})
						.then(r => r.json())
						.then(j=>{
							if(j && j.status === 'OK') {
								setTimeout(updateMiniPlayer, 100);
							}
						})
						.catch(err2 => console.error('[MiniPlayer] Both next endpoints failed:', err2));
				});
		});
	}
	
	// Mini player updates via main.js 5s status poll
	updateMiniPlayer(); // Call once on init

	// ===== Search Modal =====
	const searchModal = document.getElementById('searchModal');
	const searchModalInput = document.getElementById('searchModalInput');
	const searchModalBody = document.getElementById('searchModalBody');
	const searchModalBack = document.getElementById('searchModalBack');
	const searchModalHistory = document.getElementById('searchModalHistory');
	const searchModalHistoryList = document.getElementById('searchModalHistoryList');
	const searchModalHistoryClear = document.getElementById('searchModalHistoryClear');

	function hideSearchHistory(){
		if(searchModalHistory) searchModalHistory.style.display = 'none';
	}

	function renderSearchHistory(){
		if(!searchModalHistory || !searchModalHistoryList) return;
		const history = getSearchHistory();
		if(!history || history.length === 0) {
			searchModalHistory.style.display = 'none';
			if(searchModalHistoryClear) searchModalHistoryClear.disabled = true;
			return;
		}
		searchModalHistoryList.innerHTML = history.map(item => `<div class="search-modal-history-item" title="${item.replace(/"/g,'&quot;')}">${item}</div>`).join('');
		searchModalHistory.style.display = 'block';
		if(searchModalHistoryClear) searchModalHistoryClear.disabled = false;
		searchModalHistoryList.querySelectorAll('.search-modal-history-item').forEach(el => {
			el.addEventListener('click', () => {
				const q = el.textContent || '';
				if(searchModalInput) {
					searchModalInput.value = q;
				}
				hideSearchHistory();
				performSearch(q);
			});
		});
	}

	if(searchModalHistoryClear) {
		searchModalHistoryClear.addEventListener('click', () => {
			clearSearchHistory();
			searchModalHistoryList.innerHTML = '';
			hideSearchHistory();
		});
	}
	
	function openSearchModal() {
		// Auto-close full player to prevent overlap
		const fullPlayer = document.getElementById('fullPlayer');
		if(fullPlayer && fullPlayer.style.display !== 'none') {
			fullPlayer.style.display = 'none';
		}
		if(searchModal) {
			searchModal.style.display = 'flex';
			setTimeout(() => {
				if(searchModalInput) {
					searchModalInput.focus();
				}
			}, 300);
		}
	}
	
	function closeSearchModal() {
		if(searchModal) {
			searchModal.style.display = 'none';
			if(searchModalInput) {
				searchModalInput.value = '';
			}
			hideSearchHistory();
		}
	}
	
	// Close button
	if(searchModalBack) {
		searchModalBack.addEventListener('click', closeSearchModal);
	}
	
	// Click outside to close
	if(searchModal) {
		searchModal.addEventListener('click', (e) => {
			if(e.target.classList.contains('search-modal-overlay')) {
				closeSearchModal();
			}
		});
	}
	
	// Search input handling
	if(searchModalInput) {
		let searchTimeout;

		searchModalInput.addEventListener('focus', () => {
			renderSearchHistory();
		}, { passive: true });

		searchModalInput.addEventListener('blur', () => {
			setTimeout(() => hideSearchHistory(), 150);
		}, { passive: true });
		searchModalInput.addEventListener('input', (e) => {
			clearTimeout(searchTimeout);
			const query = e.target.value.trim();
			
			if(query.length === 0) {
				searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">🔍</span><p>搜索串流音乐</p></div></div>';
				return;
			}
			
			// Delay search to avoid too many requests (3 seconds)
			searchTimeout = setTimeout(() => {
				performSearch(query);
			}, 3000);
		});
		
		// Enter key to search immediately
		searchModalInput.addEventListener('keydown', (e) => {
			if(e.key === 'Enter') {
				const query = e.target.value.trim();
				if(query.length > 0) {
					clearTimeout(searchTimeout);
					performSearch(query);
				}
			}
		});
	}
	
	// Perform search
	function performSearch(query) {
		console.log('[Search] 搜索:', query);
		
		// Save search history
		saveSearchHistory(query);
		hideSearchHistory();
		
		// Show loading state
		searchModalBody.innerHTML = '<div class="search-loading"><div class="search-loading-spinner"></div></div>';
		
		// 检查是否为 YouTube URL
		let isYouTubeUrl = false;
		let isPlaylist = false;
		try {
			const urlObj = new URL(query);
			const host = urlObj.hostname.toLowerCase();
			isYouTubeUrl = host.includes('youtube.com') || host.includes('youtu.be');
			// 检查是否为播放列表
			if(isYouTubeUrl) {
				isPlaylist = urlObj.search.includes('list=') || query.includes('/playlist');
			}
		} catch (e) {
			// 不是有效的 URL，作为搜索关键字处理
		}
		
		if(isYouTubeUrl && isPlaylist) {
			// 是播放列表 URL，提取列表内容
			console.debug('[Search] 检测到播放列表 URL，提取列表内容');
			
			fetch('/youtube_extract_playlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'url=' + encodeURIComponent(query)
			})
			.then(r => r.json())
			.then(res => {
				if(res && res.status === 'OK' && res.entries && res.entries.length > 0) {
					// 显示播放列表内容
					displayPlaylistResults(res.entries);
				} else {
					searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">😕</span><p>播放列表为空或获取失败</p></div></div>';
				}
			})
			.catch(e => {
				console.error('[Search] 提取播放列表失败:', e);
				searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">⚠️</span><p>提取播放列表失败</p></div></div>';
			});
		} else if(isYouTubeUrl && !isPlaylist) {
			// 是单个视频 URL，直接添加到队列
			console.debug('[Search] 检测到单个视频 URL，添加到队列');
			addToQueue(query, '加载中…', 'youtube');
			searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">✅</span><p>已添加到队列</p></div></div>';
			setTimeout(() => {
				closeSearchModal();
			}, 1000);
		} else {
			// 搜索关键字
			fetch('/search_youtube', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: 'query=' + encodeURIComponent(query)
			})
			.then(r => r.json())
			.then(data => {
				if(data.status === 'OK' && data.results && data.results.length > 0) {
					displaySearchResults(data.results);
				} else {
					searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">😕</span><p>未找到结果</p></div></div>';
				}
			})
			.catch(e => {
				console.error('[Search] 搜索失败:', e);
				searchModalBody.innerHTML = '<div class="search-suggestions"><div class="search-placeholder"><span class="search-placeholder-icon">⚠️</span><p>搜索出错，请重试</p></div></div>';
			});
		}
	}
	
	// Display playlist results
	function displayPlaylistResults(entries) {
		const html = entries.map((item, idx) => {
			const safeTitle = item.title || '未知';
			const safeUrl = escapeAttr(item.url || '');
			const positionLabel = `${idx + 1}/${entries.length}`;
			const duration = typeof item.duration === 'number' ? formatDuration(item.duration) : '';
			
			// Try to get thumbnail from video ID
			let thumbnail = '';
			if(item.id) {
				thumbnail = `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`;
			}
			
			const cover = thumbnail
				? `<div class="search-result-cover"><img src="${escapeAttr(thumbnail)}" alt="${escapeAttr(safeTitle)}" /></div>`
				: `<div class="search-result-cover"><div class="search-result-placeholder">🎵</div></div>`;
				
			return `<div class="search-result-item" data-index="${idx}" data-url="${safeUrl}" data-title="${escapeAttr(safeTitle)}">
				${cover}
				<div class="search-result-info">
					<div class="search-result-title">${escapeHtml(safeTitle)}</div>
					<div class="search-result-artist">播放列表 ${positionLabel}</div>
				</div>
				<div class="search-result-duration">${escapeHtml(duration)}</div>
				<button class="search-result-action" title="添加到队列">+</button>
			</div>`;
		}).join('');
		
		searchModalBody.innerHTML = html;
		
		// Fallback for broken thumbnails
		searchModalBody.querySelectorAll('.search-result-cover img').forEach(img => {
			img.addEventListener('error', () => {
				const parent = img.parentElement;
				if(parent) {
					parent.innerHTML = '<div class="search-result-placeholder">🎵</div>';
				}
			});
		});
		
		// Add event listeners
		document.querySelectorAll('.search-result-item').forEach((item, idx) => {
			const url = item.dataset.url;
			const title = entries[idx].title;
			
			// Click anywhere on item to add to queue
			item.addEventListener('click', (e) => {
				// Prevent double-trigger when clicking button
				if(e.target.classList.contains('search-result-action')) {
					return;
				}
				if(!url) {
					console.warn('[UI] 无效的 URL:', url);
					return;
				}
				
				// 防止重复添加同一个结果
				if(item.classList.contains('added-to-queue')) {
					console.debug('[UI] 该项已添加到队列');
					return;
				}
				
				console.debug('[UI] 添加播放列表项到队列:', title, url);
				addToQueue(url, title, 'youtube');
				item.classList.add('added-to-queue');
			});
			
			// Also handle button click
			const btn = item.querySelector('.search-result-action');
			if(btn) {
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					if(!url) {
						console.warn('[UI] 无效的 URL:', url);
						return;
					}
					
					// 防止重复添加同一个结果
					if(item.classList.contains('added-to-queue')) {
						console.debug('[UI] 该项已添加到队列');
						return;
					}
					
					console.debug('[UI] 添加播放列表项到队列 (按钮):', title, url);
					addToQueue(url, title, 'youtube');
					item.classList.add('added-to-queue');
				});
			}
		});
	}

	// Basic HTML/attribute escaping to avoid broken markup
	function escapeHtml(str){
		if(str === undefined || str === null) return '';
		return String(str).replace(/[&<>"']/g, (ch) => {
			switch(ch){
				case '&': return '&amp;';
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '"': return '&quot;';
				case "'": return '&#39;';
				default: return ch;
			}
		});
	}

	function escapeAttr(str){
		return escapeHtml(str);
	}

	// Resolve a thumbnail URL from search result data with multiple fallbacks
	function resolveThumbnailUrl(item){
		if(!item) return '';
		let thumb = item.thumbnail || item.thumbnail_url || item.thumbnailUrl || item.thumb || item.cover || item.art || '';
		// If thumbnails is an array, pick the first url
		if(!thumb && Array.isArray(item.thumbnails) && item.thumbnails.length){
			const candidate = item.thumbnails.find(t => t && t.url) || item.thumbnails[0];
			thumb = candidate && (candidate.url || candidate.src || '');
		}
		// If thumbnail is an object with url
		if(thumb && typeof thumb === 'object' && thumb.url){
			thumb = thumb.url;
		}
		// Fallback: derive from YouTube URL
		if(!thumb && item.url){
			const match = item.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
			if(match && match[1]) {
				thumb = `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
			}
		}
		return thumb || '';
	}
	
	// Display search results
	function displaySearchResults(results) {
		const html = results.map((item, idx) => {
			const thumbnail = resolveThumbnailUrl(item);
			const safeTitle = item.title || '未知';
			const safeUploader = item.uploader || '';
			const duration = typeof item.duration === 'number' ? formatDuration(item.duration) : (item.duration || '');
			const safeUrl = escapeAttr(item.url || '');
			const safeThumb = escapeAttr(thumbnail);
			const cover = safeThumb
				? `<div class="search-result-cover"><img src="${safeThumb}" alt="${escapeAttr(safeTitle)}" /></div>`
				: `<div class="search-result-cover"><div class="search-result-placeholder">🎵</div></div>`;
			return `<div class="search-result-item" data-index="${idx}" data-url="${safeUrl}" data-title="${escapeAttr(safeTitle)}">
				${cover}
				<div class="search-result-info">
					<div class="search-result-title">${escapeHtml(safeTitle)}</div>
					<div class="search-result-artist">${escapeHtml(safeUploader)}</div>
				</div>
				<div class="search-result-duration">${escapeHtml(duration)}</div>
				<button class="search-result-action" title="添加到队列">+</button>
			</div>`;
		}).join('');
		
		searchModalBody.innerHTML = html;

		// Fallback for broken thumbnails
		searchModalBody.querySelectorAll('.search-result-cover img').forEach(img => {
			img.addEventListener('error', () => {
				const parent = img.parentElement;
				if(parent) {
					parent.innerHTML = '<div class="search-result-placeholder">🎵</div>';
				}
			});
		});
		
		// Add event listeners
		document.querySelectorAll('.search-result-item').forEach((item, idx) => {
			const url = item.dataset.url;
			const title = results[idx].title;
			
			// Click anywhere on item to add to queue
			item.addEventListener('click', (e) => {
				// Prevent double-trigger when clicking button
				if(e.target.classList.contains('search-result-action')) {
					return;
				}
				if(!url) {
					console.warn('[UI] 无效的 URL:', url);
					return;
				}
				console.debug('[UI] 添加搜索结果到队列:', title, url);
				addToQueue(url, title, 'youtube');
				item.classList.add('added-to-queue');
			});
			
			// Also handle button click
			const btn = item.querySelector('.search-result-action');
			if(btn) {
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					if(!url) {
						console.warn('[UI] 无效的 URL:', url);
						return;
					}
					console.debug('[UI] 添加搜索结果到队列 (按钮):', title, url);
					addToQueue(url, title, 'youtube');
					item.classList.add('added-to-queue');
				});
			}
		});
	}
	
	// Add to queue helper
	function addToQueue(url, title, type) {
		// 检查该歌曲是否已在队列中
		if(window._queueUrlSet && window._queueUrlSet.has(url)) {
			console.debug('[UI] 该歌曲已在队列中:', title);
			alert('该歌曲已经在播放列表中，无法重复添加');
			return;
		}
		
		fetch('/youtube_queue_add', {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&type=${type}`
		})
		.then(r => r.json())
		.then(res => {
			if(res && res.status === 'OK') {
				console.debug('[UI] 已添加到队列:', title);
				// 添加到队列URL集合
				if(window._queueUrlSet) {
					window._queueUrlSet.add(url);
				}
				// Reload queue display
				if(window.loadPlayList) window.loadPlayList();
			} else {
				console.error('[UI] 添加失败:', res && res.error);
				alert('添加到队列失败: ' + (res && res.error || '未知错误'));
			}
		})
		.catch(e => {
			console.error('[UI] 请求失败:', e);
			alert('添加到队列失败: ' + e.message);
		});
	}

	// ===== Bottom Navigation Tab Switching =====
	const bottomNav = document.getElementById('bottomNav');
	const navItems = document.querySelectorAll('.nav-item');
	const tabContents = document.querySelectorAll('.tab-content');
	let playlistTabActive = false; // Track if playlist (local songs) modal is open
	
	if(bottomNav) {
		navItems.forEach(item => {
			item.addEventListener('click', () => {
				const tabName = item.dataset.tab;
				
				// Update active state
				navItems.forEach(nav => nav.classList.remove('active'));
				item.classList.add('active');
				
				// Special handling for playlist button - open playlists modal
				if(tabName === 'playlist') {
					if(window.openPlaylistsModal) {
						window.openPlaylistsModal();
					}
					return;
				}
				
				// Special handling for ranking button - open ranking modal
				if(tabName === 'ranking') {
					if(window.openRankingModal) {
						window.openRankingModal();
					}
					return;
				}
				
				// Special handling: browse opens local songs modal
				if(tabName === 'browse') {
					const localSongsModal = document.getElementById('localSongsModal');
					if(playlistTabActive && localSongsModal && localSongsModal.style.display === 'block') {
						// Second click - close the modal
						if(window.closeLocalSongsModal) {
							window.closeLocalSongsModal();
						}
						playlistTabActive = false;
						// Remove active state
						navItems.forEach(nav => nav.classList.remove('active'));
					} else {
						// First click - open the modal
						if(window.openLocalSongsModal) {
							window.openLocalSongsModal();
						}
						playlistTabActive = true;
					}
					return;
				}
			
				// Reset modal state for other tabs
				playlistTabActive = false;
				const localSongsModal = document.getElementById('localSongsModal');
				if(localSongsModal && localSongsModal.style.display === 'block') {
					if(window.closeLocalSongsModal) {
						window.closeLocalSongsModal();
					}
				}
				
				// Hide all tabs, then show the selected one
				tabContents.forEach(tab => {
					tab.style.display = 'none';
				});
				
				// Map navigation tab names to corresponding tab elements
				let selectedTab = null;
				if(tabName === 'favorites' || tabName === 'playlist') {
					// favorites and playlist map to youtube playlist
					selectedTab = document.getElementById('youtubePlaylist');
				} else if(tabName === 'search') {
					selectedTab = document.getElementById('youtubePlaylist');
					openSearchModal();
				}
				
				// Show selected tab
				if(selectedTab) {
					selectedTab.style.display = 'flex';
				}
			});
		});
	}

	// 暴露 loadPlayList 到全局作用域，供其他脚本使用
	window.loadPlayList = loadPlayList;
	// queueUrlSet 已在声明时通过 window._queueUrlSet 暴露
	window.addToQueue = addToQueue;

	// ============= 多歌单管理功能 =============
	const playlistsModal = document.getElementById('playlistsModal');
	const playlistsBackBtn = document.getElementById('playlistsBackBtn');
	const playlistsAddBtn = document.getElementById('playlistsAddBtn');
	const playlistsModalBody = document.getElementById('playlistsModalBody');

	// 打开歌单选择模态框
	function openPlaylistsModal() {
		if (playlistsModal) {
			playlistsModal.style.display = 'flex';
			loadPlaylists();
		}
	}

	// 关闭歌单选择模态框
	function closePlaylistsModal() {
		if (playlistsModal) {
			playlistsModal.style.display = 'none';
		}
	}

	// 加载所有歌单
	function loadPlaylists() {
		fetch('/playlists')
			.then(r => r.json())
			.then(data => {
				const playlists = data.playlists || [];
				const currentPlaylistId = data.current_playlist_id;
				const defaultPlaylistId = data.default_playlist_id;
				renderPlaylists(playlists, currentPlaylistId, defaultPlaylistId);
			})
			.catch(err => {
				console.error('加载歌单失败:', err);
				playlistsModalBody.innerHTML = '<div class="playlists-empty"><p>加载失败</p></div>';
			});
	}

	// 渲染歌单列表
	function renderPlaylists(playlists, currentPlaylistId, defaultPlaylistId) {
		if (!playlists || playlists.length === 0) {
			playlistsModalBody.innerHTML = `
				<div class="playlists-empty">
					<div class="playlists-empty-icon">🎵</div>
					<div class="playlists-empty-text">暂无歌单</div>
					<div class="playlists-empty-hint">点击右上角 + 创建新歌单</div>
				</div>
			`;
			return;
		}

		const html = playlists.map(pl => `
			<div class="playlist-item ${pl.id === currentPlaylistId ? 'active' : ''}" data-id="${pl.id}">
				<div class="playlist-icon">📀</div>
				<div class="playlist-info">
					<div class="playlist-name">${escapeHtml(pl.name)}</div>
					<div class="playlist-count">${pl.song_count || 0} 首歌曲</div>
				</div>
				<div class="playlist-actions">
					${pl.id === defaultPlaylistId ? '<span class="default-badge">默认</span>' : ''}
					<button class="playlist-action-btn edit" data-id="${pl.id}" title="编辑" ${pl.id === defaultPlaylistId ? '' : ''}>
						<svg width="20" height="20" viewBox="0 0 24 24">
							<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
						</svg>
					</button>
					${pl.id !== defaultPlaylistId ? `
					<button class="playlist-action-btn delete" data-id="${pl.id}" title="删除">
						<svg width="20" height="20" viewBox="0 0 24 24">
							<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
						</svg>
					</button>
					` : ''}
				</div>
			</div>
		`).join('');

		playlistsModalBody.innerHTML = html;

		// 绑定事件
		document.querySelectorAll('.playlist-item').forEach(item => {
			const id = item.dataset.id;
			item.addEventListener('click', (e) => {
				if (!e.target.closest('.playlist-actions')) {
					switchPlaylist(id);
				}
			});
		});

		document.querySelectorAll('.playlist-action-btn.edit').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				editPlaylist(btn.dataset.id);
			});
		});

		document.querySelectorAll('.playlist-action-btn.delete').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				deletePlaylist(btn.dataset.id);
			});
		});
	}

	// 切换到指定歌单
	function switchPlaylist(playlistId) {
		fetch(`/playlists/${playlistId}/switch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		})
		.then(r => r.json())
		.then(data => {
			if (data.error) {
				alert(data.error);
			} else {
				console.log('已切换到歌单:', data.playlist.name);
				// 关闭歌单选择模态框
				if(window.closePlaylistsModal) {
					window.closePlaylistsModal();
				}
				// 返回首页并刷新
				setTimeout(() => {
					location.reload();
				}, 300);
			}
		})
		.catch(err => {
			console.error('切换歌单失败:', err);
			alert('切换歌单失败');
		});
	}


	// 创建新歌单
	function createPlaylist() {
		const name = prompt('请输入歌单名称:');
		if (!name || !name.trim()) return;

		fetch('/playlists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim() })
		})
		.then(r => r.json())
		.then(data => {
			if (data.error) {
				alert(data.error);
			} else {
				loadPlaylists();
			}
		})
		.catch(err => {
			console.error('创建歌单失败:', err);
			alert('创建歌单失败');
		});
	}

	// 编辑歌单
	function editPlaylist(id) {
		const name = prompt('请输入新的歌单名称:');
		if (!name || !name.trim()) return;

		fetch(`/playlists/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim() })
		})
		.then(r => r.json())
		.then(data => {
			if (data.error) {
				alert(data.error);
			} else {
				loadPlaylists();
			}
		})
		.catch(err => {
			console.error('编辑歌单失败:', err);
			alert('编辑歌单失败');
		});
	}

	// 删除歌单
	function deletePlaylist(id) {
		if (!confirm('确定要删除这个歌单吗？')) return;

		fetch(`/playlists/${id}`, {
			method: 'DELETE'
		})
		.then(r => r.json())
		.then(data => {
			if (data.error) {
				alert(data.error);
			} else {
				loadPlaylists();
			}
		})
		.catch(err => {
			console.error('删除歌单失败:', err);
			alert('删除歌单失败');
		});
	}

	// 打开歌单详情（待实现）
	function openPlaylistDetail(id) {
		// 点击歌单项时切换到该歌单，所以这个函数已由 switchPlaylist 替代
		switchPlaylist(id);
	}

	// HTML 转义
	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	// 事件监听
	if (playlistsBackBtn) {
		playlistsBackBtn.addEventListener('click', closePlaylistsModal);
	}

	if (playlistsAddBtn) {
		playlistsAddBtn.addEventListener('click', createPlaylist);
	}

	// 点击模态框背景关闭
	if (playlistsModal) {
		playlistsModal.addEventListener('click', (e) => {
			if (e.target === playlistsModal) {
				closePlaylistsModal();
			}
		});
	}

	// ============= 排行榜功能 =============
	const rankingModal = document.getElementById('rankingModal');
	const rankingModalBody = document.getElementById('rankingModalBody');
	const rankingTabs = document.querySelectorAll('.ranking-tab');
	const rankingModalClose = document.getElementById('rankingModalClose');
	let currentRankingPeriod = 'all';

	// 打开排行榜Modal
	function openRankingModal() {
		if (rankingModal) {
			rankingModal.style.display = 'block';
			loadRankingData(currentRankingPeriod);
		}
	}

	// 关闭排行榜Modal
	function closeRankingModal() {
		if (rankingModal) {
			rankingModal.style.display = 'none';
		}
	}

	// 加载排行榜数据
	function loadRankingData(period = 'all') {
		currentRankingPeriod = period;
		
		fetch('/playback_history')
			.then(r => r.json())
			.then(res => {
				if (res && res.status === 'OK' && Array.isArray(res.items)) {
					const rankings = calculateRankings(res.items, period);
					renderRankings(rankings);
				} else {
					rankingModalBody.innerHTML = '<div class="ranking-empty">暂无播放记录</div>';
				}
			})
			.catch(e => {
				console.error('[Ranking] 加载排行榜失败:', e);
				rankingModalBody.innerHTML = '<div class="ranking-empty">加载失败</div>';
			});
	}

	// 计算排行榜
	function calculateRankings(historyItems, period) {
		const now = Date.now() / 1000;
		const oneWeek = 7 * 24 * 60 * 60;
		const oneMonth = 30 * 24 * 60 * 60;

		// 过滤时间范围
		let filteredItems = historyItems;
		if (period === 'week') {
			filteredItems = historyItems.filter(item => (now - item.ts) <= oneWeek);
		} else if (period === 'month') {
			filteredItems = historyItems.filter(item => (now - item.ts) <= oneMonth);
		}

		// 统计播放次数（使用play_count字段或计算）
		const playCount = {};
		const songInfo = {};
		
		filteredItems.forEach(item => {
			const url = item.url;
			if (!playCount[url]) {
				playCount[url] = 0;
				songInfo[url] = {
					title: item.name || item.title || '未知歌曲',
					type: item.type || 'local',
					url: url,
					thumbnail_url: item.thumbnail_url || null
				};
			}
			// 使用play_count字段（如果存在），否则每条记录计为1次
			playCount[url] += item.play_count || 1;
		});

		// 转换为数组并排序
		const rankings = Object.keys(playCount).map(url => ({
			...songInfo[url],
			plays: playCount[url]
		})).sort((a, b) => b.plays - a.plays);

		return rankings.slice(0, 100); // 只显示前100名
	}

	// 渲染排行榜
	function renderRankings(rankings) {
		if (!rankings || rankings.length === 0) {
			rankingModalBody.innerHTML = '<div class="ranking-empty">暂无播放记录</div>';
			return;
		}

		rankingModalBody.innerHTML = rankings.map((song, index) => {
			const rank = index + 1;
			let rankClass = '';
			let rankDisplay = rank;
			
			if (rank === 1) {
				rankClass = 'top-1';
				rankDisplay = '🥇';
			} else if (rank === 2) {
				rankClass = 'top-2';
				rankDisplay = '🥈';
			} else if (rank === 3) {
				rankClass = 'top-3';
				rankDisplay = '🥉';
			}

			const typeIcon = song.type === 'youtube' ? '▶️' : '🎵';
			const artist = song.type === 'youtube' ? 'YouTube' : '本地音乐';
			
			const coverHtml = song.thumbnail_url ? 
				`<img src="${song.thumbnail_url}" alt="" onerror="this.parentElement.innerHTML='${typeIcon}';">` :
				typeIcon;

			return `
				<div class="ranking-item" data-url="${escapeAttr(song.url)}" data-title="${escapeAttr(song.title)}" data-type="${song.type}">
					<div class="ranking-number ${rankClass}">${rankDisplay}</div>
					<div class="ranking-cover">${coverHtml}</div>
					<div class="ranking-info">
						<div class="ranking-title">${escapeHtml(song.title)}</div>
						<div class="ranking-artist">${escapeHtml(artist)}</div>
					</div>
					<div class="ranking-stats">
						<div class="ranking-plays">${song.plays} 次播放</div>
						<button class="ranking-play-btn" title="播放">▶</button>
					</div>
				</div>
			`;
		}).join('');

		// 添加事件监听
		document.querySelectorAll('.ranking-item').forEach(item => {
			const playBtn = item.querySelector('.ranking-play-btn');
			const url = item.dataset.url;
			const title = item.dataset.title;
			const type = item.dataset.type;

			// 点击整行播放
			item.addEventListener('click', (e) => {
				if (!e.target.classList.contains('ranking-play-btn')) {
					playSong(url, title, type);
				}
			});

			// 点击播放按钮
			if (playBtn) {
				playBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					playSong(url, title, type);
				});
			}
		});
	}

	// 播放歌曲 - 统一接口，支持本地和YouTube，不清空当前播放列表
	function playSong(url, title, type) {
		const params = type === 'youtube' 
			? `url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&play_now=1&add_to_queue=1&insert_front=1`
			: `path=${encodeURIComponent(url)}&play_now=1&add_to_queue=1&insert_front=1`;
		
		fetch('/play', {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: params
		})
		.then(r => r.json())
		.then(res => {
			if (res && res.status === 'OK') {
				console.debug('[Ranking] 播放歌曲:', title);
				closeRankingModal();
				// 歌曲开始播放后确保播放状态并刷新页面
				setTimeout(() => {
					// 调用确保播放接口（如果暂停则恢复播放）
					fetch('/ensure_playing', {method:'POST'})
						.then(r => r.json())
						.then(j => {
							console.debug('[Ranking] 确保播放状态:', j);
						})
						.catch(e => console.error('[Ranking] 确保播放失败:', e))
						.finally(() => {
							// 最后刷新页面
							location.reload();
						});
				}, 800);
			}
		})
		.catch(e => console.error('[Ranking] 播放失败:', e));
	}

	// 排行榜标签切换
	rankingTabs.forEach(tab => {
		tab.addEventListener('click', () => {
			rankingTabs.forEach(t => t.classList.remove('active'));
			tab.classList.add('active');
			const period = tab.dataset.period;
			loadRankingData(period);
		});
	});

	// 关闭按钮事件
	if (rankingModalClose) {
		rankingModalClose.addEventListener('click', closeRankingModal);
	}

	// 点击背景关闭
	if (rankingModal) {
		rankingModal.addEventListener('click', (e) => {
			if (e.target === rankingModal) {
				closeRankingModal();
			}
		});
	}

	// 暴露到window对象
	window.openRankingModal = openRankingModal;
	window.closeRankingModal = closeRankingModal;


	// 暴露给全局
	window.openPlaylistsModal = openPlaylistsModal;
	window.closePlaylistsModal = closePlaylistsModal;

})();

