# 网易云音乐 WebDAV 模拟器使用指南

本项目在原网易云音乐 API 基础上实现了 WebDAV 服务，主要为中子播放器（Neutron Player）等流媒体播放器提供支持。

## 特性
- **每日推荐**：自动映射每日推荐歌曲与歌单。
- **我的歌单**：同步个人账号下的所有歌单。
- **极速流式**：通过 302 重定向直连网易云服务器，低延迟，不消耗服务端流量。
- **自动登录**：支持终端扫码登录，自动保存并刷新 Cookie。
- **跨平台**：兼容 Windows, Linux, Termux。

## 快速开始

### 1. 安装环境
确保已安装 Node.js (建议 v18+) 和 Git。

### 2. 下载代码
```bash
git clone https://github.com/Aurora-Nasa-1/NCM-WEBDAV.git
cd NCM-WEBDAV
```

### 3. 启动服务

#### Termux / Linux
```bash
chmod +x start.sh
./start.sh
```

#### Windows
双击运行 `start.bat`。

### 4. 登录
首次启动后，终端会显示二维码。使用网易云音乐 App 扫码登录。登录信息会保存在 `data/cookie.txt`。

### 5. 播放器配置
在播放器中添加 WebDAV 地址：
- **地址**: `http://<您的IP>:3001`
- **路径**: `/`
- **用户名**: (留空或任意)
- **密码**: (留空或任意)

## 配置
您可以修改 `webdav_config.json` 来自定义参数：
- `port`: 服务端口 (默认 3001)
- `quality`: 音质 (standard, exhigh, lossless, hires)
- `cacheTTL`: 目录列表缓存时间 (毫秒)

## Termux 特别说明
在 Termux 中运行前，请先执行以下命令安装依赖：
```bash
pkg install nodejs git
```
然后按上述“启动服务”步骤操作即可。
