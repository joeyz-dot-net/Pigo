# 推流功能启用/禁用配置

## 概述
现在可以通过 `settings.ini` 中的 `enable_stream` 参数来控制推流功能的启用/禁用。

## 配置方法

在 `settings.ini` 文件的 `[app]` 部分中找到：

```ini
[app]
music_dir = Z:
...
enable_stream = true
```

## 参数说明

| 参数值 | 说明 | 效果 |
|--------|------|------|
| `true` | 启用推流功能 | FFmpeg 进程会正常启动和运行 |
| `false` | 禁用推流功能 | FFmpeg 进程不会启动，所有推流请求返回 403 Forbidden |

## 支持的值

以下值都会被识别为 **启用**：
- `true`
- `1`
- `yes`

以下值都会被识别为 **禁用**：
- `false`
- `0`
- `no`

## 受影响的功能

当 `enable_stream = false` 时，以下功能将被禁用：

### API 端点
- **GET /stream/play** - 浏览器推流播放（返回 403）
- **POST /stream/control** - 推流控制（返回 403）
- **GET /stream/status** - 推流状态显示 "❌ 推流功能已禁用"

### 后端逻辑
- `start_ffmpeg_stream()` 不会启动 FFmpeg 进程
- 所有推流相关的线程不会启动

### 前端表现
- 推流按钮将无法使用（返回 403）
- 调试面板中的推流状态显示 "❌ 推流功能已禁用"

## 使用场景

### 场景1：仅用于本地 MPV 播放
如果只想在本地用 MPV 播放音乐，不需要浏览器推流功能，可以禁用：
```ini
enable_stream = false
```

### 场景2：完整功能
如果需要浏览器和本地播放，保持启用：
```ini
enable_stream = true
```

## 修改生效

修改 `settings.ini` 后需要**重启应用**：
```bash
python main.py
```

配置会在应用启动时读取，修改会立即生效。

## 默认值

如果未指定 `enable_stream` 参数或配置文件缺失，默认为 **启用**（true）。

## 测试

可以运行测试脚本验证功能：
```bash
python test_stream_disable.py
```

测试脚本会验证：
1. 启用状态下的行为
2. 禁用状态下的行为
3. 配置恢复
