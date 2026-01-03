# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_all

# 确保包含所有必要的数据文件
datas = []

# 添加 templates 文件夹（所有文件）
if os.path.isdir('templates'):
    datas.append(('templates', 'templates'))

# 添加 static 文件夹（所有文件）
if os.path.isdir('static'):
    datas.append(('static', 'static'))

# 添加 settings.ini 配置文件
if os.path.exists('settings.ini'):
    datas.append(('settings.ini', '.'))

# 收集必要的 Python 包数据
binaries = []
hiddenimports = [
    'models',
    'models.player',
    'models.song',
    'models.playlist',
    'models.playlists',
    'models.rank',
    'models.local_playlist',
    'models.stream',
    'models.apis',
]

# 收集 fastapi、uvicorn、starlette 的所有必要文件
tmp_ret = collect_all('fastapi')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('uvicorn')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('starlette')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=True,  # 生成单个 exe
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ClubMusic',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    onefile=True,  # 生成单个 exe 文件
)
