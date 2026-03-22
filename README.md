# ws-scrcpy-vue-client

基于https://github.com/maijiawei/ws-scrcpy-vue-client的fork项目,增加缩小展示,增加清晰度修改。

## 功能特性

- **多设备列表**：自动发现并展示通过 USB 连接且已开启调试的 Android 设备
- **实时投屏**：H.264 视频流，经 WebSocket 接收，使用 WebCodecs API 解码渲染到 Canvas
- **触控与键位**：支持鼠标/触摸屏点击、滑动、滚轮；虚拟按键：主页、返回、多任务、电源
- **设备别名**：为设备设置自定义名称，支持拖拽排序，顺序持久化到本地
- **单设备放大**：点击「放大显示」全屏查看与操作某一台设备
- **设备与 Server 控制**：重连 Server、重启设备（通过 Shell 通道）
- **多路复用协议**：与 ws-scrcpy 的 Multiplexer 协议兼容（HSTS 主机列表、GTRC 设备列表、proxy-adb 视频/控制流）

## 前置要求

- **Node.js** 16+
- 已运行 **[ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy)** 服务端（默认 `localhost:8000`）
- Android 设备通过 USB 连接并已开启 **USB 调试**

## 快速开始

### 1. 启动 ws-scrcpy 服务端

在服务端项目目录下启动（端口需与客户端配置一致，例如 8000）：

```bash
# 参考 ws-scrcpy 官方文档启动服务
cd /path/to/ws-scrcpy && npm start
```

### 2. 安装并运行本客户端

```bash
# 克隆或进入本仓库
cd ws-scrcpy-vue-client

# 安装依赖
npm install

# 开发模式（默认代理到 localhost:8000，前端端口 1111）
npm run dev
```

浏览器访问：**http://localhost:1111**

### 3. 指定服务端地址

若 ws-scrcpy 不在本机或端口不同，可通过 URL 参数指定：

```
http://localhost:1111/?server=你的主机:端口
```

例如：`http://localhost:1111/?server=192.168.1.100:8000`

## 脚本说明

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（端口 1111），并代理 WebSocket 到配置的 ws-scrcpy |
| `npm run build` | 使用 Vite 构建生产产物到 `dist/` |
| `npm run preview` | 本地预览构建后的静态站点 |

构建完成后，将 `dist/` 部署到任意静态托管或与 ws-scrcpy 同域下访问即可；访问时同样可用 `?server=host:port` 指定服务端。

## 项目结构

```
ws-scrcpy-vue-client/
├── src/
│   ├── App.vue              # 根组件：连接 ws-scrcpy、Multiplexer、设备列表与 GTRC 通道
│   ├── main.js
│   ├── components/
│   │   ├── DeviceList.vue   # 设备列表、卡片、排序、虚拟键、放大、重启/重连
│   │   └── DeviceStream.vue # 单设备画面：StreamReceiver + TouchHandler + WebCodecs 解码
│   └── services/
│       ├── Multiplexer.js   # 多路复用协议封装（与 ws-scrcpy 一致）
│       ├── StreamReceiver.js # 视频流与控制消息的 WebSocket 收发
│       └── TouchHandler.js  # 鼠标/触摸事件到 scrcpy 控制协议的转换
├── index.html
├── vite.config.js
└── package.json
```

## 技术栈

- **Vue 2.7** + **Vite 4**（@vitejs/plugin-vue2）
- **WebCodecs API**：浏览器端 H.264 解码（不支持时需 fallback，可依赖服务端编码格式）
- **WebSocket**：与 ws-scrcpy 的 `action=multiplex`、`action=proxy-adb` 等通信
- 协议与数据格式与 [ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) 兼容，便于与官方或自建服务端配合使用

## 浏览器支持

建议使用支持 **WebCodecs** 的现代浏览器（如 Chrome、Edge、较新版本的 Safari 等）。不支持时画面可能无法正常解码，需依赖服务端或前端 fallback 方案。

## 致谢与参考

- [ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) — 提供 WebSocket 服务端与多路复用、设备发现、scrcpy 协议
- [scrcpy](https://github.com/Genymobile/scrcpy) — 高性能 Android 投屏与控制
- 
## 示意图
<img src="https://picabstract-preview-ftn.weiyun.com/ftn_pic_abs_v3/f17d14569660020bec774e218da0c3490a5b63aae03e68fdada6330e4e6f00adcf1d7f4c387963070c2afc0aed4a6fb7?pictype=scale&from=30113&version=3.3.3.3&fname=test.png&size=750" width="350" alt="界面截图">

## 开源协议

MIT License
