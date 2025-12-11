# 项目重构说明

## 新的项目结构

项目已重构为更清晰的模块化架构：

### 文件说明

#### 主程序文件
- **app.py** - 主程序入口
  - 初始化 Flask 应用
  - 初始化播放器实例
  - 注册 API 路由
  - 启动服务器
  - **不包含任何 API 业务逻辑实现**

#### API 路由文件
- **api_routes.py** - 所有 API 接口实现
  - 包含所有 Flask 路由装饰器和处理函数
  - 通过 `register_routes(app, player, playlist_var)` 函数注册到 Flask 应用
  - 所有 API 业务逻辑都在此文件中

#### 数据模型文件
- **models/** - 数据模型和业务逻辑
  - `player.py` - 播放器核心逻辑
  - `song.py` - 歌曲相关类
  - `playlist.py` - 播放列表类

### API 分类

#### 页面路由
- `GET /` - 主页面

#### 播放控制
- `POST /play` - 播放指定歌曲
- `POST /next` - 下一曲
- `POST /prev` - 上一曲
- `POST /toggle_pause` - 播放/暂停
- `POST /volume` - 设置音量
- `POST /seek` - 跳转位置
- `POST /loop` - 设置循环模式

#### 状态查询
- `GET /status` - 播放器状态
- `GET /tree` - 文件树
- `GET /playlist` - 播放列表
- `GET /local_queue` - 本地队列
- `GET /debug/mpv` - MPV 调试信息

#### YouTube 功能
- `POST /play_youtube` - 播放 YouTube
- `POST /play_youtube_queue` - 播放 YouTube 队列项
- `GET /youtube_queue` - YouTube 队列
- `POST /youtube_queue_add` - 添加到 YouTube 队列
- `POST /youtube_queue_remove` - 从 YouTube 队列移除
- `POST /youtube_queue_clear` - 清空 YouTube 队列
- `POST /youtube_queue_sort` - 排序 YouTube 队列
- `POST /search_youtube` - 搜索 YouTube
- `POST /youtube_extract_playlist` - 提取 YouTube 播放列表

#### 队列管理
- `GET /play_queue` - 播放队列
- `POST /play_queue_add` - 添加到队列
- `POST /play_queue_remove` - 从队列移除
- `POST /play_queue_clear` - 清空队列
- `POST /play_queue_sort` - 排序队列
- `POST /queue_next` - 播放队列下一首

#### 歌单管理
- `GET /playlists` - 获取所有歌单
- `POST /playlists` - 创建歌单
- `GET /playlists/<id>` - 获取歌单详情
- `PUT /playlists/<id>` - 更新歌单
- `DELETE /playlists/<id>` - 删除歌单
- `POST /playlists/<id>/add_song` - 添加歌曲到歌单
- `POST /playlists/<id>/remove_song` - 从歌单移除歌曲

#### 其他
- `GET /preview.png` - 预览图片

### 优势

1. **关注点分离** - 主程序只负责初始化，API 实现独立
2. **易于维护** - API 相关代码集中在一个文件
3. **便于测试** - 可以单独测试 API 函数
4. **代码复用** - API 模块可以被多个应用使用
5. **清晰的结构** - 新开发者可以快速理解项目架构

### 备份文件

- **app.py.backup** - 原始 app.py 文件的备份

如果需要恢复原始版本：
```bash
Copy-Item app.py.backup app.py
```
