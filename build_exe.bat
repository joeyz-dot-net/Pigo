@echo off
chcp 65001 >nul
REM ========================================
REM ClubMusic 打包脚本 - 单一 EXE 模式
REM ========================================

echo ========================================
echo 开始打包 ClubMusic...
echo ========================================
echo.

REM 检查是否安装了 PyInstaller
python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo [错误] 未安装 PyInstaller，正在安装...
    pip install pyinstaller
    if errorlevel 1 (
        echo [错误] 安装 PyInstaller 失败！
        pause
        exit /b 1
    )
)

echo [1/3] 清理旧的打包文件...
if exist build rmdir /s /q build 2>nul
if exist dist rmdir /s /q dist 2>nul
echo ✓ 完成

echo.
echo [2/3] 收集依赖...
pip install -r requirements.txt >nul 2>&1
echo ✓ 完成

echo.
echo [3/3] 开始打包（这可能需要几分钟）...
echo 注：生成单一 EXE 文件（所有文件内嵌）
python -m PyInstaller app.spec --clean --noconfirm
if errorlevel 1 (
    echo [错误] 打包失败！
    echo 故障排除：
    echo - 确保 PyInstaller 版本最新：pip install --upgrade pyinstaller
    echo - 检查是否有文件被其他程序占用
    echo - 尝试手动删除 build 和 dist 目录后重试
    pause
    exit /b 1
)
echo ✓ 完成

echo.
echo ========================================
echo ✓ echo 打包完成！
echo ========================================
echo.
echo 📦 可执行文件位置: dist\ClubMusic.exe
echo.
echo 📋 使用说明:
echo 1. ClubMusic.exe 包含所有必需文件（static、templates、settings.ini）
echo.
echo 2. 必需依赖（需单独配置）:
echo    • mpv.exe - 音乐播放核心
echo      下载: https://mpv.io/installation/
echo      或: choco install mpv
echo.
echo 3. 可选依赖:
echo    • FFmpeg - 推流功能需要
echo      下载: https://ffmpeg.org/download.html
echo      放入: C:\ffmpeg\bin\ffmpeg.exe 或系统 PATH
echo.
echo    • yt-dlp.exe - YouTube 播放支持
echo      下载: https://github.com/yt-dlp/yt-dlp/releases
echo      与 ClubMusic.exe 同目录
echo.
echo 4. 配置:
echo    首次运行时会自动创建 settings.ini
echo    编辑设置:
echo    • MUSIC_DIR: 音乐目录（如 Z:\ 或 D:\Music）
echo    • SERVER_PORT: 服务端口（默认 80）
echo.
echo 🚀 运行:
echo 双击 ClubMusic.exe 或命令行运行即可
echo.
echo 🔐 防火墙提示:
echo 首次运行时 Windows 防火墙可能会提示，请允许访问网络
echo ========================================
pause
