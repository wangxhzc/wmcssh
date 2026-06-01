# wmcssh

`wmcssh` 是一个基于 `Tauri 2 + React + Rust + ssh2 + xterm.js + SQLite` 的桌面 SSH 工具。

当前版本已经具备可用的主机管理、多标签终端和基础文件传输能力，不再是单纯的架构脚手架。

## 当前能力

- 主机管理
  - 新建、编辑、删除主机
  - 支持密码和私钥认证
  - 支持连接超时、保活间隔配置
  - 左侧主机列表支持关键字搜索
- SSH 终端
  - 多标签终端
  - 连接、断开、重连
  - xterm 自适应尺寸
  - 标签状态圆点
  - 终端右键菜单：复制、粘贴、全选、清屏
- 文件传输
  - 从主机右键菜单打开“文件传输”标签
  - 默认打开登录用户家目录，失败时回退到根目录 `/`
  - 浏览远程目录、进入子目录、返回上级、刷新
  - 上传本地文件到当前远程目录
  - 文件右键下载到本地
- 数据与配置
  - SQLite 保存主机、标签、最近连接、设置
  - 本地文件保存密码和私钥口令引用内容
  - 终端设置支持读写与重置

## 当前未完成

- 远程文件删除、重命名、移动
- 文件夹上传/下载
- 最近连接 UI
- 分组 / 标签 UI
- 设置页面 UI
- 跳板机、端口转发、同步等高级能力

## 技术栈

- 前端：React, TypeScript, Zustand, xterm.js, Vite
- 桌面容器：Tauri 2
- 后端：Rust, ssh2
- 存储：SQLite
- 本地能力：Tauri Dialog / FS / Opener 插件

## 目录结构

```text
.
├── docs/                         # 项目文档
├── src/                          # React 前端
│   ├── app/
│   ├── features/
│   │   ├── hosts/
│   │   ├── terminal/
│   │   └── file-transfer/
│   ├── services/
│   ├── stores/
│   └── types/
├── src-tauri/                    # Tauri / Rust 后端
│   ├── migrations/
│   └── src/
│       ├── commands/
│       ├── contracts/
│       ├── repositories/
│       ├── services/
│       ├── secrets/
│       └── ssh/
├── package.json
└── src-tauri/Cargo.toml
```

## 本地开发

安装依赖：

```bash
npm install
```

前端开发：

```bash
npm run dev
```

桌面开发：

```bash
npm run tauri dev
```

## 编译检查

前端构建：

```bash
npm run build
```

Rust 检查：

```bash
cd src-tauri && cargo check
```

## 打包命令

Linux amd64：

```bash
npm run build:linux:amd64
```

Windows amd64：

```bash
npm run build:windows:amd64
```

也可以直接使用 Tauri 原命令：

```bash
npm run tauri build -- --target x86_64-unknown-linux-gnu
npm run tauri build -- --target x86_64-pc-windows-gnu
```

打包产物通常位于：

```text
src-tauri/target/<target>/release/bundle/
```

## 安全说明

- SQLite 不直接保存密码和私钥口令。
- 敏感信息通过本地文件凭据存储保存到应用数据目录下的 `wmcssh.json`。
- 主机表只保存 `password_ref` / `passphrase_ref` 这类引用。

## 文档索引

- [设计总览](docs/01-设计总览.md)
- [前端架构](docs/02-前端架构.md)
- [后端架构](docs/03-后端架构.md)
- [API 契约](docs/04-API契约.md)
- [数据库设计](docs/05-数据库设计.md)
- [开发说明](docs/06-开发路线图.md)
