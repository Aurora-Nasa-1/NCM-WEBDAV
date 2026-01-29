# 网易云音乐 API Enhanced

---

## 项目简介

本项目为网易云音乐第三方 Node.js API，基于停更的原版 API 持续维护，支持丰富的音乐相关接口，适合自建服务、二次开发和多平台部署(如果原版诈尸, 我会及时同步 or 归档)。

> [!IMPORTANT]
>
> ## 注意
>
> - 本项目是一个高度去中心化的第三方 API，其维护都由社区志愿者使用`Pull Request`完成。   
> - 使用本项目时请务必遵守相关法律法规，遵守`MIT`协议, 尊重网易云音乐的服务条款。   
> - 原作者项目 [Binaryify/NeteaseCloudMusicApi](https://github.com/binaryify/NeteaseCloudMusicApi) 并非完全停止维护, 你可以在 [NeteaseCloudMusicApi 的 NPMJS 页面](https://www.npmjs.com/package/NeteaseCloudMusicApi) 查看最新版本信息。   
> - 感谢尊重和理解!

## 快速开始

### 环境要求

- Node.js 18 及以上
- 推荐使用 pnpm 进行依赖管理

### 安装

```bash
git clone https://github.com/neteasecloudmusicapienhanced/api-enhanced.git
cd api
pnpm i
```

### 启动服务

```bash
# 默认端口 3000
node app.js

# 指定端口（如 4000）
PORT=4000 node app.js  # Mac/Linux
set PORT=4000 && node app.js  # Windows
```

### 重要提示

- 调用前请务必阅读文档的 [调用前须知](https://neteasecloudmusicapienhanced.js.org/#/?id=%e8%b0%83%e7%94%a8%e5%89%8d%e9%a1%bb%e7%9f%a5) 部分。
- 推荐将敏感信息（如 cookie）通过部署平台的环境变量进行配置。

## 在线体验与文档

- [在线文档](https://neteasecloudmusicapienhanced.js.org/)
- [NPM 包地址](https://www.npmjs.com/package/@neteasecloudmusicapienhanced/api)
- [Dockerhub 主页](https://hub.docker.com/r/moefurina/ncm-api)

## 常见部署方式

- 推荐参考[在线文档](https://neteasecloudmusicapienhanced.js.org/)

## Docker 部署说明

本项目支持通过 Docker 一键部署，无需手动安装 Node.js 或依赖。

> 注意: 在 docker 中运行的时候, 由于使用了 request 来发请求, 所以会检查几个 proxy 相关的环境变量(如下所列), 这些环境变量 会影响到 request 的代理, 详情请参考[request 的文档](https://github.com/request/request#proxies), 如果这些环境变量 指向的代理不可用, 那么就会造成错误, 所以在使用 docker 的时候一定要注意这些环境变量. 不过, 要是你在 query 中加上了 proxy 参数, 那么环境变量会被覆盖, 就会用你通过 proxy 参数提供的代理了.

request 相关的环境变量

1. http_proxy
2. https_proxy
3. HTTP_PROXY
4. HTTPS_PROXY
5. no_proxy
6. NO_PROXY

```shell
docker pull moefurina/ncm-api:latest

docker run -d -p 3000:3000 --name ncm-api moefurina/ncm-api:latest


// 或者
docker run -d -p 3000:3000 moefurina/ncm-api:latest

// 去掉或者设置相关的环境变量

docker run -d -p 3000:3000 --name ncm-api -e http_proxy= -e https_proxy= -e no_proxy= -e HTTP_PROXY= -e HTTPS_PROXY= -e NO_PROXY= moefurina/ncm-api:latest

// 或者
docker run -d -p 3000:3000 -e http_proxy= -e https_proxy= -e no_proxy= -e HTTP_PROXY= -e HTTPS_PROXY= -e NO_PROXY= moefurina/ncm-api:latest
```

> 以下是自行 build docker 镜像方式

```shell
$ git clone https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced && cd api-enhanced

$ sudo docker build . -t ncm-api

$ sudo docker run -d -p 3000:3000 ncm-api
```

## 3. 环境变量

| 变量名                     | 默认值                               | 说明                                                                           |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| **CORS_ALLOW_ORIGIN**      | `*`                                  | 允许跨域请求的域名。若需要限制，请指定具体域名（例如 `https://example.com`）。 |
| **ENABLE_PROXY**           | `false`                              | 是否启用反向代理功能。                                                         |
| **PROXY_URL**              | `https://your-proxy-url.com/?proxy=` | 代理服务地址。仅当 `ENABLE_PROXY=true` 时生效。                                |
| **ENABLE_GENERAL_UNBLOCK** | `true`                               | 是否启用全局解灰（推荐开启）。开启后所有歌曲都尝试自动解锁。                   |
| **ENABLE_FLAC**            | `true`                               | 是否启用无损音质（FLAC）。                                                     |
| **SELECT_MAX_BR**          | `false`                              | 启用无损音质时，是否选择最高码率音质。                                         |
| **FOLLOW_SOURCE_ORDER**    | `true`                               | 是否严格按照音源列表顺序进行匹配。                                             |

---

### 4. 更新镜像

更新到最新版本：

```bash
docker pull moefurina/ncm-api:latest
docker stop ncm-api && docker rm ncm-api
docker run -d -p 3000:3000 moefurina/ncm-api:latest
```

## Vercel 一键部署

1. fork 本项目
2. 在 Vercel 官网新建项目，导入 fork 的仓库
3. 直接 Deploy

## 腾讯云 Serverless 部署

1. fork 本项目
2. 在腾讯云 serverless 控制台新建 Web 应用，选择 Express 框架
3. 代码仓库选择 fork 的项目，启动文件填写：
   ```bash
   #!/bin/bash
   export PORT=9000
   /var/lang/node16/bin/node app.js
   ```
4. 完成部署后，访问 API 网关的 URL 即可

## Node.js 方式调用

支持直接在 Node.js 项目中引入和调用，返回 Promise：

```js
const {
  login_cellphone,
  user_cloud,
} = require('@neteasecloudmusicapienhanced/api')
async function main() {
  const result = await login_cellphone({ phone: '手机号', password: '密码' })
  console.log(result)
  const result2 = await user_cloud({ cookie: result.body.cookie })
  console.log(result2.body)
}
main()
```

## TypeScript 支持

```ts
import { banner } from '@neteasecloudmusicapienhanced/api'
banner({ type: 0 }).then((res) => console.log(res))
```

## 单元测试

```bash
pnpm test
```

## 主要功能特性

- 登录/注册/验证码
- 用户信息、歌单、动态、播放记录
- 歌曲、专辑、歌手、MV、歌词、评论、排行榜
- 搜索、推荐、私人 FM、签到、云盘
- 歌曲解锁（解灰）

## 贡献与社区

- 欢迎提交 PR、Issue 参与维护

### 致谢

原作者 [Binaryify/NeteaseCloudMusicApi](https://github.com/binaryify/NeteaseCloudMusicApi) 项目为本项目基础 (该项目在`npmjs`网站上仍持续维护, 但 github 仓库已不再更新)

感谢大佬们为逆向eapi, weapi等加密算法所做的贡献

项目参考:

[trazyn/ieaseMusic](https://github.com/trazyn/ieaseMusic)

[listen1/listen1_chrome_extension](https://github.com/listen1/listen1_chrome_extension)

[chaunsin/netease-cloud-music](https://github.com/chaunsin/netease-cloud-music)

### SDK 生态

| 语言   | 作者                                        | 地址                                                                                     | 类型   |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| Java   | [JackuXL](https://github.com/JackuXL)       | [NeteaseCloudMusicApi-SDK](https://github.com/JackuXL/NeteaseCloudMusicApi-SDK)          | 第三方 |
| Java   | [1015770492](https://github.com/1015770492) | https://github.com/1015770492/yumbo-music-utils                                          | 第三方 |
| Python | [盧瞳](https://github.com/2061360308)       | [NeteaseCloudMusic_PythonSDK](https://github.com/2061360308/NeteaseCloudMusic_PythonSDK) | 第三方 |


### 依赖此项目的优秀开源项目

- [imsyy/splayer](https://github.com/imsyy/splayer)

- [qier2222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)

## Termux 部署

本项目支持在 Termux (Android) 上运行，非常适合将旧手机变为音乐服务器。

### 1. 安装环境
在 Termux 中执行以下命令：
```bash
pkg update && pkg upgrade
pkg install nodejs git
```

### 2. 获取代码与运行
```bash
git clone https://github.com/neteasecloudmusicapienhanced/api-enhanced.git
cd api-enhanced
chmod +x start.sh
./start.sh
```

### 3. 注意事项
- **QR 登录**: 首次启动会显示二维码，请使用网易云音乐 App 扫描。如果二维码显示不全或乱码，请尝试缩小终端字体。
- **后台运行**: 建议在 Termux 中开启 `Acquire wakelock` 以防止系统休眠导致服务中断。
- **自动更新**: `start.sh` 脚本在每次启动时都会尝试 `git pull` 更新代码并自动安装依赖。

## WebDAV 使用指南

本项目内置了 WebDAV 服务，可以将网易云音乐的歌单、每日推荐等挂载为本地网络驱动器。

### 1. 优势
- **高性能**: 采用 HTTP 302 重定向技术，直接从网易云服务器获取音频流，低延迟且不消耗服务器流量。
- **多端同步**: 只要有 WebDAV 客户端，即可在各种播放器中直接播放。
- **音质可选**: 支持从标准到母带质量的多种音质。

### 2. 配置说明 (`webdav_config.json`)
你可以通过修改根目录下的 `webdav_config.json` 来调整服务：
```json
{
  "port": 3001,
  "quality": "exhigh",
  "cacheTTL": 300000
}
```
| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `port` | 3001 | WebDAV 服务端口 |
| `quality` | `exhigh` | 音质等级 (见下表) |
| `cacheTTL` | 300000 | 资源列表缓存时间 (毫秒) |

**音质选项 (`quality`):**
- `standard`: 标准 (128kbps)
- `exhigh`: 极高 (320kbps)
- `lossless`: 无损
- `hires`: Hi-Res
- `jyeffect`: 高清环绕声 (HD surround)
- `sky`: 沉浸环绕声 (Sky)
- `jymaster`: 超解析母带 (Master)

### 3. 便携使用与远程访问
- **内网使用**: 在同一 Wi-Fi 下，通过 `http://手机IP:3001` 访问。
- **远程访问**: 建议配合 [Tailscale](https://tailscale.com/) 或 [ZeroTier] 使用，无需公网 IP 即可在任何地方通过虚拟内网访问你的私有音乐服务。
- **挂载路径**:
    - `/每日推荐歌曲`: 你的每日私享歌曲。
    - `/每日推荐歌单`: 发现更多好音乐。
    - `/我的歌单`: 你收藏和创建的所有歌单。

### 4. 推荐客户端
- **Android**: Solid Explorer, VLC, Neutron Player
- **iOS**: Infuse, Fileball, Ever Music
- **Windows/macOS**: PotPlayer, MPC-HC, Kodi, Infuse

## License

[MIT License](https://github.com/MoeFurina/NeteaseCloudMusicApiEnhanced/blob/main/LICENSE)
