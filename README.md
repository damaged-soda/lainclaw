# Lainclaw CLI

A tiny TypeScript playground entry for the Lainclaw project.

## 快速进入命令行

```bash
cd <repo_root>/src/lainclaw
npm run build
node ./dist/index.js
node ./dist/index.js 你的名字
node ./dist/index.js --help
```

## 本地全局命令安装（npm link）

### 一次性安装

```bash
cd <repo_root>/src/lainclaw
npm i -D @types/node
npm run build
npm link
```

### 开发时类型提示修复（VSCode）

如果你看到 `Cannot find name 'process'`，执行：

```bash
npm i -D @types/node
```

然后关闭并重开 VSCode（或 `TypeScript: Restart TS server`）。

### 链接与运行（推荐）

```bash
cd <repo_root>/src/lainclaw
npm run build
npm link
```

全局命令：

```bash
lainclaw
lainclaw 你的名字
```

### 在任意目录使用

`npm link` 已把可执行命令挂到全局 bin，因此安装后可直接执行：

```bash
lainclaw
lainclaw 你的名字
```

### 仅给某个工程引用（可选）

```bash
cd <your_project_dir>
npm link lainclaw
```

### 卸载

```bash
npm unlink -g lainclaw
```
# lainclaw
