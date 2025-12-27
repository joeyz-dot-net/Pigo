# 🎵 ClubMusic

一个功能完整的网页音乐播放器，支持本地文件和 YouTube 音乐串流播放，具有多歌单管理、播放历史追踪、排行榜统计、**浏览器推流**等高级功能。

[English Documentation](README_EN.md)

## ✨ 核心功能

### 🎼 音乐播放
- **本地播放**：支持 MP3、WAV、FLAC、AAC、M4A 等多种音频格式
- **YouTube 串流**：直接搜索和播放 YouTube 音乐
- **播放控制**：暂停/继续、进度条拖拽、音量调节
- **播放历史**：自动记录所有播放过的歌曲

### 🎙️ 浏览器推流 (v6.0 新增)
- **VB-Cable + FFmpeg**：将本地音频推流到浏览器播放
- **多格式支持**：AAC、MP3、FLAC 音频编码
- **低延迟优化**：FFmpeg 参数优化，减少 70% 延迟
- **Safari 兼容**：专门针对 Safari 浏览器的 3 线程异步广播架构
- **推流状态指示器**：实时显示推流状态（播放中/缓冲/关闭/禁用）

### 📋 歌单管理
- **多歌单支持**：创建、编辑、删除自定义歌单
- **歌单持久化**：所有歌单数据自动保存
- **拖拽排序**：支持桌面和移动端拖拽重新排序

### 🏆 排行榜统计
- **播放次数追踪**：记录每首歌曲播放次数
- **时间段统计**：全部/本周/本月排行
- **快速播放**：点击排行榜歌曲直接播放

### 🎨 用户界面
- **响应式设计**：适配桌面、平板和手机
- **浅色/深色主题**：支持主题切换
- **多语言支持**：中文/英文界面
- **Toast 通知**：操作反馈居中显示

## 🚀 快速开始

### 系统要求
- Python 3.8+
- mpv 播放器
- FFmpeg（推流功能需要）
- VB-Cable（推流功能需要）
- yt-dlp（YouTube 功能需要）

### 安装步骤

1. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```

2. **配置 settings.ini**
   ```ini
   [app]
   music_dir=Z:\                      # 本地音乐目录
   allowed_extensions=.mp3,.wav,.flac,.aac,.m4a
   server_host=0.0.0.0
   server_port=80
   enable_stream=true                 # 启用推流
   default_stream_format=aac          # 默认推流格式
   ```

3. **启动应用**
   ```bash
   python main.py
   ```

4. **访问播放器**
   打开浏览器访问：`http://localhost:80`

### 打包为 EXE
```bash
.\build_exe.bat
```
生成的 `app.exe` 位于 `dist/` 目录。

## 📁 项目结构

```
ClubMusic/
├── app.py                 # FastAPI 主应用 (2300+ 行, 60+ 路由)
├── main.py                # 启动入口
├── settings.ini           # 配置文件
├── models/
│   ├── player.py          # MPV 播放器控制 (1500+ 行)
│   ├── stream.py          # FFmpeg 推流模块 (1500+ 行)
│   ├── song.py            # 歌曲数据模型
│   ├── playlist.py        # 播放列表管理
│   ├── playlists.py       # 多歌单管理
│   ├── rank.py            # 播放历史和排行榜
│   ├── settings.py        # 用户设置管理
│   └── logger.py          # 日志模块
├── static/
│   ├── js/                # 前端 JavaScript 模块
│   └── css/               # 样式文件
├── templates/
│   └── index.html         # 主页面
├── bin/                   # 可执行文件 (ffmpeg, yt-dlp)
├── doc/                   # 文档目录
├── playlists.json         # 歌单数据
├── playback_history.json  # 播放历史
└── requirements.txt       # Python 依赖
```

## 🎮 使用指南

### 播放本地音乐
1. 确保 `settings.ini` 中的 `music_dir` 指向正确的音乐目录
2. 点击底部导航栏的 "本地" 标签
3. 浏览文件夹树形结构，点击歌曲名称播放
4. 本地歌曲模态框以全屏显示

### 播放 YouTube 音乐
1. 点击底部导航栏的 "搜索" 标签
2. 输入歌曲名称或 URL
3. 从搜索结果中选择
4. 歌曲将自动添加到队列并播放

### 管理歌单
1. **创建歌单**：点击歌单管理界面的 "+" 按钮
2. **添加歌曲**：从播放队列中选择歌曲，添加到歌单
3. **切换歌单**：点击歌单名称切换播放歌单
4. **删除歌单**：（默认歌单不可删除）
5. **固定标题**：滚动时歌单名称始终显示在顶部

### 队列操作
- **拖拽排序**：鼠标拖拽或触摸手柄 (☰) 重新排列（包括当前播放歌曲）
- **左滑删除**：移动端向右滑动显示删除按钮
- **删除单项**：点击删除按钮或左滑选中删除
- **当前歌曲**：支持拖拽排序和左滑删除，与其他队列项交互逻辑完全相同

### 播放控制
- **暂停/继续**：点击中央播放按钮
- **调整进度**：点击或拖拽进度条
- **调整音量**：使用音量控制器
- **快速搜索**：点击搜索按钮快速查找歌曲

### 排行榜使用
1. **打开排行榜**：点击底部导航栏的 "排行" 标签
2. **切换时间段**：选择 "全部"、"本周" 或 "本月"
3. **查看排名**：歌曲按播放次数降序显示（显示所有记录，不限10首）
4. **快速播放**：点击排行榜中的歌曲直接播放
5. **关闭排行榜**：点击左上角关闭按钮或背景区域
6. **全屏显示**：排行榜覆盖整个屏幕（包括底部导航栏）

### 底部导航
- **📚 歌单**：查看和管理播放队列
- **🎵 本地**：浏览本地音乐文件（全屏模态框）
- **🏆 排行**：查看播放排行榜（全屏显示）
- **🔍 搜索**：搜索 YouTube 和本地音乐（不遮挡底部导航栏）

## 🔧 API 端点

### 播放控制
- `POST /play` - 播放歌曲（支持 `insert_front=1` 参数直接插入当前歌曲前）
- `POST /toggle_pause` - 切换暂停状态
- `POST /ensure_playing` - 确保播放（如暂停则恢复）
- `GET /status` - 获取播放状态

### 队列管理
- `GET /play_queue` - 获取播放队列
- `GET /combined_queue` - 获取合并队列（本地 + YouTube）
- `POST /play_song` - 添加歌曲到队列
- `POST /play_queue_remove` - 从队列删除歌曲（支持当前歌曲）
- `POST /play_queue_play` - 播放队列中的歌曲
- `POST /play_queue_reorder` - 重新排序队列（支持当前歌曲排序）

### 播放历史
- `GET /playback_history` - 获取播放历史（包含 play_count）
- `POST /song_add_to_history` - 添加到历史记录

### 歌单管理
- `GET /playlists` - 获取所有歌单
- `POST /playlist_create` - 创建新歌单
- `POST /playlist_delete` - 删除歌单
- `POST /playlist_add_song` - 添加歌曲到歌单
- `POST /playlist_remove_song` - 从歌单删除歌曲

### 搜索
- `POST /search_song` - **统一搜索接口**
  - 参数：`query`（搜索词）、`type`（'youtube'、'local'、'all'）
  - 支持 YouTube、本地或同时搜索两个来源
  - 推荐使用此接口
- `POST /search_youtube` - 搜索 YouTube
- `GET /local_songs` - 获取本地音乐列表

## 📊 数据存储

### JSON 数据文件
- **playlists.json** - 所有歌单及其歌曲列表
- **playlist.json** - 当前播放队列（包含类型、URL 等）
- **playback_history.json** - 播放历史
  - 包含字段：`url`, `name`, `type`, `ts`, `thumbnail_url`, `play_count`
  - `play_count`：歌曲被播放的总次数（重复播放会递增）
  - 由 `models/rank.py` 中的 `HitRank` 类管理

### 数据持久化
- 所有操作自动保存到本地 JSON 文件
- 应用重启时自动恢复上一次的播放状态
- 播放历史自动递增 play_count
- 排行榜数据实时更新

## 🌐 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- 移动浏览器（iOS Safari, Chrome Mobile）

## 🔐 安全性

- 所有 API 请求都通过 POST 方法进行验证
- YouTube URL 进行规范化处理防止重复
- 文件路径进行安全检查，防止目录遍历
- 队列 URL 集合追踪防止重复添加

## 🐛 已知限制

- YouTube 串流依赖于 yt-dlp，可能受到 YouTube 限制
- 某些受限国家的 YouTube 内容可能无法访问
- 本地音乐目录必须在应用启动前配置正确

## 📝 配置详解

### settings.ini
```ini
[music]
# 本地音乐库目录
music_dir=Z:\

# 支持的音频格式（逗号分隔）
extensions=.mp3,.wav,.flac

[server]
# 监听主机（0.0.0.0 表示所有接口）
host=0.0.0.0

# 监听端口
port=80
```

## 🎯 开发者信息

### 项目规模
- **前端代码**：3700+ 行 JavaScript，5600+ 行 CSS
- **后端代码**：2200+ 行 Python (app.py)
- **数据模型**：600+ 行 Python（模型定义）
- **总代码行数**：11,000+ 行

### 主要模块
- `app.py` -  应用主文件，包含 50+ API 端点
- `models/player.py` - mpv 播放器包装类
- `models/rank.py` - 播放历史和排行榜统计（HitRank 类）
- `models/playlists.py` - 多歌单管理
- `models/local_playlist.py` - 本地音乐浏览
- `static/main.js` - 完整的前端交互逻辑
- `static/style.css` - 响应式样式设计

### 关键特性实现
- **多歌单持久化**：使用 Playlists 类管理
- **播放队列重排序**：支持当前歌曲的拖拽排序
- **播放次数统计**：HitRank 类自动递增 play_count
- **全屏模态框**：排行榜和本地歌曲以全屏显示
- **固定标题栏**：歌单页面滚动时标题栏置顶
- **密码保护**：清除历史需要密码验证
- **左滑删除统一**：当前歌曲和队列项使用相同逻辑
- **状态轮询**：每 2 秒更新一次播放状态
- **响应式底部导航**：四个主要功能标签，适配移动端

### API 使用示例

**统一搜索接口示例：**
```javascript
// 搜索 YouTube
fetch('/search_song', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'query=周杰伦&type=youtube'
})
.then(r => r.json())
.then(data => console.log(data.results));

// 搜索本地
fetch('/search_song', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'query=周杰伦&type=local'
})
.then(r => r.json())
.then(data => console.log(data.results));

// 同时搜索
fetch('/search_song', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'query=周杰伦&type=all'
})
.then(r => r.json())
.then(data => {
    console.log('YouTube 结果:', data.youtube);
    console.log('本地结果:', data.local);
});
```

## 📦 依赖包

见 `requirements.txt` 获取完整依赖列表

关键依赖：
- **FastAOI** - Web 框架
- **yt-dlp** - YouTube 下载器
- **python-mpv** - mpv 播放器绑定
- **python-dotenv** - 环境变量管理

## 🎁 功能亮点

✅ 完整的播放控制（进度条、音量、暂停）  
✅ 本地 + YouTube 双源播放  
✅ 多歌单管理和持久化  
✅ 高级排行榜功能（时间段统计、play_count 追踪）  
✅ 拖拽排序支持当前歌曲  
✅ 左滑删除与传统交互统一  
✅ 完整的播放历史追踪（含播放次数统计）  
✅ 响应式设计完美适配所有设备  
✅ 全屏播放器沉浸式体验  
✅ 实时搜索本地和 YouTube  
✅ 播放次数统计和排行榜分析  
✅ 密码保护清除历史功能  
✅ 全屏模态框（排行榜、本地歌曲）  
✅ 固定标题栏（歌单页面）  
✅ 底部导航栏设计（歌单、本地、排行、搜索）  
✅ 无限制排行榜显示（最多100首）  
✅ 模块化代码结构（独立的 rank、local_playlist 模块）  

## 📜 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

遇到问题？请检查：
1. `settings.ini` 配置是否正确
2. 本地音乐目录是否存在
3. mpv 和 yt-dlp 是否正确安装
4. 浏览器控制台是否有错误信息


---

**版本**：6.0.0  
**更新时间**：2025年12月  
**许可证**：MIT License
