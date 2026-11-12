# wmcssh

`wmcssh` 是一个基于 `Tauri 2 + React + Rust + ssh2 + xterm.js + SQLite` 的桌面 SSH 工具。

应用提供主机管理、多标签终端、快速连接、设置中心和 SFTP 文件管理。
完整能力、限制与验证记录见 [项目现状](docs/07-项目现状.md)。

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
  - 首次连接主机密钥指纹确认及密钥变化告警
- 文件传输
  - 从主机右键菜单打开“文件传输”标签
  - 默认打开登录用户家目录，失败时回退到根目录 `/`
  - 浏览远程目录、进入子目录、返回上级、刷新
  - 上传本地文件到当前远程目录
  - 文件和目录上传、下载
  - 系统文件拖放上传、远端重命名与确认删除
  - 小文件下载到应用缓存后通过系统默认程序打开
  - 上传和下载后台队列、实时进度与取消；关闭文件传输标签后任务继续
  - 下载由后端流式写入本地暂存路径，成功后替换目标，避免通过前端聚合文件内容
  - 凭据缺失或失效时可在文件传输流程中重新认证
- 数据与配置
  - SQLite 保存主机、标签、最近连接、设置
  - Argon2id + XChaCha20-Poly1305 加密凭据库
  - 终端设置支持读写与重置
  - 设置中心支持终端参数、已信任主机密钥管理和版本查看
  - 后台传输队列在文件传输工作区管理

## 当前未完成

- 远程文件移动与权限修改
- 断点续传与跨应用重启恢复传输任务
- 最近连接 UI
- 分组 / 标签 UI
- 可配置主题
- 跳板机、端口转发、同步等高级能力

## 技术栈

- 前端：React, TypeScript, Zustand, xterm.js, Vite
- 桌面容器：Tauri 2
- 后端：Rust, ssh2
- 存储：SQLite
- 本地能力：Tauri Dialog / FS 插件

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

测试：

```bash
npm test
cd src-tauri && cargo test
```

## 打包命令

Linux amd64：

```bash
npm run build:linux:amd64
```

Windows amd64（本地与 CI 均使用 GNU）：

开发与测试使用 Node.js 22（支持 `--experimental-strip-types` 的版本）和 Rust stable。
Linux 需安装 WebKitGTK 等 Tauri 系统依赖，CI 使用：

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential perl
```

在 Windows 上先安装 Rust GNU 工具链，以及 MSYS2 MINGW64 的 GCC、Perl 和 Make：

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu
```

在 MSYS2 MINGW64 终端执行 `pacman -S --needed mingw-w64-x86_64-gcc perl make`，
将 MSYS2 的 `mingw64\bin` 和 `usr\bin` 加入运行 npm 的终端 `PATH`。
设置 `OPENSSL_SRC_PERL` 指向 MSYS2 的 `usr\bin\perl.exe`，
例如 `C:\msys64\usr\bin\perl.exe`，供 OpenSSL 源码构建使用。然后执行：

```bash
npm run build:windows:amd64
```

Windows 构建仅生成 NSIS 安装程序（`*-setup.exe`），不生成 MSI。
发布工作流同样使用 `stable-x86_64-pc-windows-gnu` 和 MinGW-w64 GCC，
目标统一为 `x86_64-pc-windows-gnu`。下方原命令分别用于已配置依赖的 Linux
和 Windows 环境。跨平台构建还需配置目标平台的编译器、链接器及系统依赖。

也可以直接使用 Tauri 原命令：

```bash
npm run tauri build -- --target x86_64-unknown-linux-gnu
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
```

打包产物通常位于：

```text
src-tauri/target/<target>/release/bundle/
```

## 安全说明

- SQLite 不直接保存密码和私钥口令。
- 敏感信息保存在 SQLite 加密凭据库中，主密钥由用户主密码通过 Argon2id 派生，
  密文使用 XChaCha20-Poly1305 加密。
- 主机表只保存 `password_ref` / `passphrase_ref` 这类引用。
- SSH 主机密钥信任记录保存在应用数据目录的 `known_hosts`，认证前必须校验。
- `wmcssh.json` 只作为旧版本明文凭据的一次性迁移来源，迁移成功后删除。

## 文档索引

- [设计总览](docs/01-设计总览.md)
- [前端架构](docs/02-前端架构.md)
- [后端架构](docs/03-后端架构.md)
- [API 契约](docs/04-API契约.md)
- [数据库设计](docs/05-数据库设计.md)
- [开发说明](docs/06-开发路线图.md)
- [项目现状](docs/07-项目现状.md)
- [终端输出高亮](docs/08-终端输出高亮.md)
