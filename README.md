# 🎵 音乐播放器 (Music Player)

一个功能完整的网页音乐播放器，支持本地文件和 YouTube 音乐串流播放，具有多歌单管理、播放历史追踪、排行榜统计等高级功能。

## ✨ 核心功能

### 🎼 音乐播放与管理
- **本地播放**：支持 MP3、WAV、FLAC 等多种音频格式
- **YouTube 串流**：直接从 YouTube 搜索和播放音乐
- **播放控制**：暂停/继续、进度条拖拽、音量调节
- **全屏播放器**：沉浸式音乐体验
- **播放历史**：自动记录所有播放过的歌曲

### 📋 歌单管理
- **多歌单支持**：创建、编辑、删除自定义歌单
- **默认歌单**：系统预设的 "默认歌单" 不可删除
- **歌单持久化**：所有歌单数据自动保存到本地

### 🎚️ 播放队列
- **队列管理**：添加、删除、排序队列中的歌曲
- **拖拽排序**：桌面和移动端都支持拖拽重新排序
  - 非当前歌曲：鼠标拖拽或触摸拖拽手柄 (☰)
  - **当前播放歌曲**：也可被拖拽到队列任意位置
- **左滑删除**：移动端向右滑动快速删除（当前歌曲和队列项相同逻辑）
- **插入位置控制**：从排行榜选择歌曲时，可直接插入当前歌曲前播放

### 🏆 排行榜统计
- **播放次数追踪**：记录每首歌曲被播放的次数
- **时间段统计**：
  - 全部：统计所有播放记录
  - 本周：过去 7 天的排行
  - 本月：过去 30 天的排行
- **快速播放**：点击排行榜歌曲直接播放，自动插入当前歌曲前
- **全屏显示**：排行榜以模态框全屏显示
- **关闭按钮**：右上角关闭按钮（模仿搜索界面）

### 🔍 搜索功能
- **本地搜索**：快速搜索本地音乐库中的歌曲和艺术家
- **YouTube 搜索**：在线搜索 YouTube 音乐
- **搜索历史**：自动保存最近搜索记录，支持一键清除

### 💾 播放历史
- **完整记录**：记录所有播放过的歌曲及播放时间
- **播放次数**：统计每首歌曲被播放的次数
- **缩略图**：显示歌曲封面（本地默认图标，YouTube 自动获取）
- **快速访问**：点击历史记录直接播放

### 🎨 用户界面
- **响应式设计**：完美适配桌面、平板和手机设备
- **浅色/深色主题**：现代化的深色界面设计
- **实时状态**：实时显示播放进度、时长、暂停状态
- **进度显示**：可视化进度条，支持点击和拖拽定位
- **大封面显示**：正在播放卡片中的歌曲封面放大显示（桌面 120px，手机 110px）

## 🚀 快速开始

### 系统要求
- Python 3.7+
- Flask
- yt-dlp（用于 YouTube 下载）
- mpv（音频播放引擎）

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd MusicPlayer
   ```

2. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```

3. **配置设置**
   编辑 `settings.ini` 文件：
   ```ini
   [music]
   music_dir=Z:\                  # 本地音乐目录
   extensions=.mp3,.wav,.flac     # 支持的音频格式
   
   [server]
   host=0.0.0.0
   port=80
   ```

4. **启动应用**
   ```bash
   # Windows
   python app.py
   # 或使用启动脚本
   start.bat
   
   # 或 PowerShell
   python .\app.py
   ```

5. **访问播放器**
   打开浏览器访问：`http://localhost` 或 `http://127.0.0.1`

## 📁 项目结构

```
MusicPlayer/
├── app.py                 # Flask 主应用（1800+ 行）
├── index.html            # 前端 HTML
├── static/
│   ├── main.js           # 前端交互逻辑（3700+ 行）
│   ├── style.css         # 样式表（5400+ 行）
│   └── youtube.js        # YouTube 集成模块
├── models/
│   ├── player.py         # 播放器控制（mpv）
│   ├── playlist.py       # 歌单、队列、历史管理（465+ 行）
│   ├── song.py           # 歌曲数据模型
│   └── playlists.py      # 多歌单管理
├── test/                 # 测试脚本
├── settings.ini          # 配置文件
├── requirements.txt      # 依赖列表
├── play_queue.json       # 播放队列数据
├── playback_history.json # 播放历史数据（包含 play_count）
├── playlists.json        # 歌单数据
└── README.md            # 本文档
```

## 🎮 使用指南

### 播放本地音乐
1. 确保 `settings.ini` 中的 `music_dir` 指向正确的音乐目录
2. 应用会自动扫描并列出所有支持的音频文件
3. 点击歌曲名称播放

### 播放 YouTube 音乐
1. 点击 "YouTube" 标签或使用搜索功能
2. 输入歌曲名称或 URL
3. 从搜索结果中选择
4. 歌曲将自动添加到队列并播放

### 管理歌单
1. **创建歌单**：点击歌单管理界面的 "+" 按钮
2. **添加歌曲**：从播放队列中选择歌曲，添加到歌单
3. **切换歌单**：点击歌单名称切换播放歌单
4. **删除歌单**：（默认歌单不可删除）

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
1. **打开排行榜**：点击播放器中的排行榜按钮
2. **切换时间段**：选择 "全部"、"本周" 或 "本月"
3. **查看排名**：歌曲按播放次数降序显示
4. **快速播放**：点击排行榜中的歌曲
   - 直接播放该歌曲
   - 自动插入当前播放歌曲前面
   - 自动刷新页面显示更新后的队列
5. **关闭排行榜**：点击右上角关闭按钮或背景

## 🔧 API 端点

### 播放控制
- `POST /play` - 播放歌曲（支持 `insert_front=1` 参数直接插入当前歌曲前）
- `POST /toggle_pause` - 切换暂停状态
- `POST /ensure_playing` - 确保播放（如暂停则恢复）
- `GET /status` - 获取播放状态

### 队列管理
- `GET /play_queue` - 获取播放队列
- `GET /combined_queue` - 获取合并队列（本地 + YouTube）
- `POST /play_queue_add` - 添加歌曲到队列
- `POST /play_queue_remove` - 从队列删除歌曲（支持当前歌曲）
- `POST /play_queue_play` - 播放队列中的歌曲
- `POST /play_queue_reorder` - 重新排序队列（支持当前歌曲排序）

### 播放历史
- `GET /playback_history` - 获取播放历史（包含 play_count）
- `POST /play_queue_add_to_history` - 添加到历史记录

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
- **play_queue.json** - 当前播放队列（包含类型、URL 等）
- **playback_history.json** - 播放历史
  - 包含字段：`url`, `name`, `type`, `ts`, `thumbnail_url`, `play_count`
  - `play_count`：歌曲被播放的总次数（重复播放会递增）

### 数据持久化
- 所有操作自动保存到本地 JSON 文件
- 应用重启时自动恢复上一次的播放状态
- 播放历史自动递增 play_count

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
- **前端代码**：3700+ 行 JavaScript，5400+ 行 CSS
- **后端代码**：1800+ 行 Python
- **数据模型**：500+ 行 Python（模型定义）
- **总代码行数**：10,000+ 行

### 主要模块
- `app.py` - Flask 应用主文件，包含 44+ API 端点
- `models/player.py` - mpv 播放器包装类
- `models/playlist.py` - 播放队列、历史、歌单管理
- `static/main.js` - 完整的前端交互逻辑
- `static/style.css` - 响应式样式设计

### 关键特性实现
- **多歌单持久化**：使用 Playlists 类管理
- **播放队列重排序**：支持当前歌曲的拖拽排序
- **播放次数统计**：PlayHistory 类自动递增 play_count
- **insert_front 逻辑**：排行榜选择时自动插入当前歌曲前面
- **左滑删除统一**：当前歌曲和队列项使用相同逻辑
- **状态轮询**：每 2 秒更新一次播放状态
- **统一搜索接口**：`/search_song` 支持 YouTube、本地、全局搜索

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
- **Flask** - Web 框架
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
✅ insert_front 队列插入位置控制  
✅ 自动页面刷新保持 UI 同步  
✅ 关闭按钮模仿搜索界面设计  

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
5. 查看 REFACTOR_NOTES.md 了解最新改动

---

**更新时间**：2025年12月  
**版本**：1.0.0  
**维护人**：Music Player Team
