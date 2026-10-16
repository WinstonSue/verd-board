# VerdBoard

<div align="center">

**All-in-One Whiteboard Tool - Mind Map · Flowchart · Free Drawing**

English | [简体中文](./README.md)

</div>

## 📖 Introduction

VerdBoard is a whiteboard tool that integrates mind mapping, flowcharts, geometric shape drawing, and more. Its Chinese name is 青编. Built on the Board engine (`@sue/board-*` packages) with a plugin-based architecture for flexible extensibility.

### ✨ Core Features

- **🧠 Mind Mapping** - Multiple layouts (standard, indent, right, left), theme styles, custom nodes
- **📊 Flowcharts** - Rich geometry library (basic shapes, flowchart symbols, UML symbols)
- **✏️ Free Drawing** - Hand-drawn style lines, arrows, tables, and drawing tools
- **📝 Rich Text Editing** - Based on TipTap 3.16.0, supports headers, lists, tables, and more
- **🎨 Theme System** - Multiple built-in themes (default, colorful, soft, retro, dark, starry)
- **⚡ High Performance** - SVG-based rendering with smooth interactions
- **🔌 Extensions** - Add capabilities through Cell utilities, registries and React render extensions
- **🧩 Providers** - One FrameCanvas supports controlled FrameSnapshot (`value` / `onChange`) and host data (adapter plus `onIntent`). Domain packages provide registration and layout extensions. Markdown and Mermaid remain import/export formats.
- **Mind summaries** - Native brackets adjust stable sibling endpoints by dragging. Embedded and detail views share transactions; deleting covered topics shrinks the range and supports undo.
- **Native interactions** - Groups, batch typography, transfers between Frames, clear confirmation, grids, aspect presets and inherited mind topic typography share transactions and persistence. Product entrypoints load `@sue/verd-board-ui/style.css`.
- **Presentation** - Present current canvas content in a separate read-only fullscreen overlay using the same render extensions, with click-to-focus, overview and a laser pointer. Mind maps and architecture diagrams offer structural steps. Use `0` for overview, `L` for laser and `Esc` to exit and restore the editing viewport. State stays in memory; slide arrangement, notes, ink, timers, autoplay and audience windows are excluded.

## 🚀 Quick Start

### Requirements

- Node.js >= 22
- pnpm >= 11.18.0

### Installation

```bash
pnpm install
```

### Development

```bash
# Start Desktop app (default)
pnpm start
# or
turbo run dev --filter=desktop

# Start Web development server
turbo run dev --filter=web

# Start all apps
turbo run dev
```

### Build

```bash
# Build all packages and apps
pnpm build

# Build Web app only
pnpm build:web

# Build Desktop app only
pnpm build:desktop
```

For Desktop product acceptance, run `pnpm build:desktop` followed by `pnpm test:e2e:desktop`. Tests use temporary data directories to verify shutdown saves, restart recovery, legacy migration and failed-save retries.

## 📦 Project Structure

```
verd-board/
├── apps/
│   ├── desktop/          # Electron desktop app
│   └── web/              # Web application
├── packages/
│   ├── engine/           # @sue/board-common, core, layouts, draw, mind, text
│   ├── react/            # @sue/board-react, @sue/board-react-text
│   ├── converters/       # markdown-to-board, mermaid-to-board
│   └── product/          # @sue/verd-board-ui, @sue/verd-board-app
├── tests/
│   ├── consumer/         # Isolated consumer check
│   ├── fixtures/         # Legacy file and text fixtures
│   └── web-e2e/          # Playwright E2E tests
├── doc/
│   ├── product/
│   ├── architecture/
│   ├── development/
│   ├── packages/
│   └── guides/
└── scripts/
```

## 🎯 Features

### Mind Mapping

- **Multiple Layout Modes**
  - Standard Layout - Classic tree structure
  - Indent Layout - Suitable for outline content
  - Right/Left Layout - Single-direction expansion

- **Node Features**
  - Rich text editing
  - Image insertion
  - Emoji support
  - Custom styling (colors, borders, shapes)

- **Theme Styles**
  - 6+ built-in themes
  - Custom theme configuration

### Flowcharts & Drawing

- **Geometric Shapes**
  - Basic shapes: Rectangle, Circle, Triangle, Diamond, etc.
  - Flowchart symbols: Start/End, Process, Decision, Data, etc.
  - UML symbols: Class, Interface, Package, etc.

- **Connectors**
  - Straight, curved, and polylines
  - Customizable arrow styles
  - Text annotations

- **Drawing Tools**
  - Hand-drawn style
  - Table drawing
  - Image insertion

### Text Editing

- **Rich Text Formats**
  - Headers (H1-H6)
  - Paragraphs
  - Ordered/Unordered lists
  - Tables
  - Code blocks

- **Text Styles**
  - Bold, Italic, Underline
  - Inline code
  - Links
  - Text alignment

## 🛠️ Tech Stack

- **Frontend**: React 19.2.0
- **Build Tool**: Vite 6.4.1 + Turbo
- **Package Manager**: pnpm 11.18.0
- **Language**: TypeScript 6.0.3
- **Drawing Engine**: Board engine (`@sue/board-*`)
- **Rich Text Editor**: TipTap 3.16.0
- **Icons**: lucide-react 1.47.0
- **Desktop**: Electron 28.0.0
- **Styling**: SCSS

## 🏗️ Architecture

VerdBoard uses CellStore as its sole runtime data source, with whiteboard and domain diagrams sharing FrameCanvas:

### Core Layer (Board Engine)

- Cell/Frame model, transactions, history, indices and selection
- Shared geometry, ports, orthogonal routing, arrows and hit testing
- Utilities registered by kind and renderer extensions

### Domain and Drawing Layer

- **Draw Cells** - Drawing features
- **Mind Cells** - Mind mapping
- **Text Controller** - TipTap text editing
- **Frame View** - Persisted themes and an in-memory viewport

### View Layer (React)

- React component wrappers
- State management
- User interactions

For detailed architecture, see [ARCHITECTURE.md](./architecture/ARCHITECTURE.md).

For a **product-level** overview (positioning, capabilities, doc map; written in Chinese), see [产品概览.md](./product/产品概览.md).

> **Documentation Language Policy**: Main documentation is maintained in both Chinese and English. Development documentation is primarily in Chinese. See [Documentation Guide](./DOCUMENTATION_GUIDE.md) for details.

## 📝 Development Guide

### Adding New Features

1. Create a new plugin package under `packages/engine/` or extend an existing `@sue/board-*` package
2. Implement the plugin interface
3. Register the plugin in the main application

### Custom Themes

```typescript
import { ThemeColorMode } from '@sue/board-common';

const customTheme: ThemeColorMode = {
  strokeColor: '#your-color',
  fill: '#your-fill-color',
};
```

### Extending Text Editor

```typescript
import { BoardTextController } from '@sue/board-common';

const customPlugin = (controller: BoardTextController) => {
  // Customize editor behavior
  return controller;
};
```

## 🙏 Acknowledgments

- [TipTap](https://tiptap.dev/) - Modern rich text editor framework
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework

---

<div align="center">
Made with ❤️ by VerdBoard Team
</div>

Markdown/Mermaid import and export FrameSnapshot directly. Product text imports preview through the shared canvas; see [Frame converters](./packages/board/frame-converters.md) for API and retained data.

The canvas supports six-way alignment, equal-gap distribution, smart drag guides, explicit layouts, nested groups and independent locking. Layouts affect selected objects or the current Frame’s direct objects, preserving nested Frame contents. See [arrangement and groups](./packages/board/arrangement.md).

Properties live in a separate 300px Sidebar. Node names are independent of canvas bodies; interactive ports appear on hover, selection or connection, and connectors support bidirectional arrows. See [Sidebar and node interactions](./packages/react/README.md#sidebar节点名称与连接交互).

For Mind maximum width and selected-node sizing, see [Fit nodes to content](./packages/board/mind-features.md#节点内容适配与最大宽度).

For AI-generated canvas data, the authoritative single-document spec (Chinese) is [面向 AI 的画布数据生成规范](./guides/ai-canvas-data-spec.md): every native `kind`, file format, constraint and ready-to-import example under `doc/examples/ai-canvas/`.
