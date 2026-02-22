# Lainclaw CLI

A tiny TypeScript playground entry for the Lainclaw project.

## 快速进入命令行

### 使用全局命令（推荐）

```bash
cd <repo_root>/src/lainclaw
npm install
npm run bootstrap

lainclaw --help
lainclaw ask 这是一个测试输入
```

### 直接运行编译产物（排错）

```bash
cd <repo_root>/src/lainclaw
npm run build
node ./dist/index.js --help
node ./dist/index.js ask 这是一个测试输入
```

## 本地全局命令安装（npm link）

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build
npm link
```

global 命令：

```bash
lainclaw
lainclaw ask 这是一个测试输入
```

## 在任意目录使用

`npm link` 已把可执行命令挂到全局 bin，因此安装后可直接执行：

```bash
lainclaw
lainclaw ask 你好，帮我总结一下
```

## 仅给某个工程引用（可选）

```bash
cd <your_project_dir>
npm link lainclaw
```

## 卸载

```bash
npm unlink -g lainclaw
```
