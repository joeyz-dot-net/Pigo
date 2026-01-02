# PWA 图标生成指南

## 📱 需要的图标尺寸

ClubMusic PWA 需要以下尺寸的图标：

- **72x72** - 小型图标
- **96x96** - 标准图标
- **128x128** - 中型图标
- **144x144** - Windows 磁贴
- **152x152** - iOS 图标
- **192x192** - Android 启动图标
- **384x384** - 高分辨率图标
- **512x512** - 最大尺寸图标（可遮罩）

## 🎨 生成方法

### 方法 1: 在线工具（推荐）

1. 访问 [RealFaviconGenerator](https://realfavicongenerator.net/)
2. 上传你的 logo（建议 1024x1024 PNG，透明背景）
3. 选择 PWA 选项
4. 生成并下载所有图标
5. 将图标放入 `static/images/` 目录

### 方法 2: 使用 ImageMagick

如果有 ImageMagick，可以用这个命令批量生成：

```bash
# 从 512x512 的 logo.png 生成所有尺寸
for size in 72 96 128 144 152 192 384 512; do
    convert logo.png -resize ${size}x${size} static/images/icon-${size}.png
done
```

### 方法 3: 使用 PWA Asset Generator

```bash
npm install -g pwa-asset-generator
pwa-asset-generator logo.png static/images/ --favicon
```

## 🔧 临时占位符

在生成正式图标前，你可以使用 preview.png 作为临时占位符：

```bash
# Windows PowerShell
cd C:\Users\hnzzy\OneDrive\Desktop\ClubMusic\static\images
$sizes = 72,96,128,144,152,192,384,512
foreach ($size in $sizes) {
    Copy-Item preview.png "icon-$size.png"
}
```

## ✅ 验证

生成后，访问以下 URL 验证：
- http://localhost/manifest.json - 查看 manifest
- http://localhost/static/images/icon-192.png - 查看图标
- http://localhost/pwa-test - PWA 测试页面

## 🎯 设计建议

- **背景**: 使用纯色背景（与 theme_color 一致）
- **对比度**: 确保图标在深色和浅色背景下都清晰可见
- **简洁**: 避免过多细节（在小尺寸下可能看不清）
- **边距**: 保留 10% 的安全边距
- **格式**: PNG 格式，透明背景
