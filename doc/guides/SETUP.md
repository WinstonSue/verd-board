# VerdBoard Desktop 安装和使用指南

## 安装依赖

在项目根目录运行：

```bash
pnpm install
```

## 开发模式

在项目根目录运行：

```bash
# 启动 desktop 应用
cd apps/desktop
pnpm run dev
```

或者使用 turbo 从根目录运行：

```bash
turbo run dev --filter=desktop
```

## 构建应用

```bash
cd apps/desktop

# 构建应用（会创建安装包）
pnpm run build

# 仅构建不打包（用于测试）
pnpm run build:dir
```

## 项目结构

```
apps/desktop/
├── electron/           # Electron 主进程和预加载脚本
│   ├── main.ts        # 主进程
│   └── preload.ts     # 预加载脚本
├── src/               # React 应用源码
│   ├── app/           # 应用组件
│   ├── storage.ts     # 存储适配器
│   ├── main.tsx       # 入口文件
│   └── styles.scss    # 样式文件
├── index.html         # HTML 模板
├── vite.config.ts     # Vite 配置
├── package.json       # 项目配置
└── tsconfig.json      # TypeScript 配置
```

## 核心功能

### 本地文件存储

与 web 版本不同，desktop 版本使用本地文件系统存储数据：

- **存储位置**：用户数据目录下的 `verdboard-data.json`（与 `apps/desktop/electron/main.ts` 中常量一致）
- **存储格式**：JSON 文件
- **自动保存**：每次修改自动保存到文件

### 存储 API

```typescript
// 获取数据
const data = await storage.getItem('key');

// 保存数据
await storage.setItem('key', value);

// 删除数据
await storage.removeItem('key');

// 清空所有数据
await storage.clear();
```

## 与 Web 版本的差异

1. **存储方式**：

   - Web: IndexedDB（浏览器存储）
   - Desktop: 本地文件系统（JSON 文件）

2. **数据位置**：

   - Web: 浏览器数据目录
   - Desktop: 应用数据目录

3. **功能一致性**：
   - 两个版本的绘图功能完全一致
   - 使用相同的 VerdBoard / `@sue/verd-board-ui` 核心库

## 故障排除

### 依赖安装失败

如果 `pnpm install` 失败，可以尝试：

```bash
# 清理缓存
pnpm store prune

# 重新安装
pnpm install
```

### 应用无法启动

1. 确保已安装所有依赖
2. 检查 Node.js 版本（建议 18+）
3. 查看控制台错误信息

### 数据文件位置

如需手动访问或备份数据文件：

- **macOS**: `~/Library/Application Support/VerdBoard/verdboard-data.json`
- **Windows**: `%APPDATA%/VerdBoard/verdboard-data.json`
- **Linux**: `~/.config/VerdBoard/verdboard-data.json`

（目录名与 `apps/desktop/package.json` 中 `build.productName` 一致；文件名与 `electron/main.ts` 中 `STORAGE_FILE` 一致。若曾使用旧版应用名，可能在 `VerdBoard` 等历史目录下留有旧数据，需自行迁移。）
