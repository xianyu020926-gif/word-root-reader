# 单点穿透词汇学习

一个以“单词学习”为核心、以原文语境为辅助的英语学习工具。文章始终保留原样；用户自己点选不会的词，系统只压缩当前词真正需要的信息，再通过词义、构词、词源、原句和声音完成一轮集中学习。

## 当前版本

`0.15.0`。同一份学习逻辑提供：

- 私有云端 PWA：电脑、iPhone、iPad、Android 浏览器均可安装；
- Windows 桌面版：Electron；
- Android APK：Capacitor；
- AI 全文翻译、语境词义、可靠词根词缀、AI 老师与语法证据核对；
- 本地文章档案、单词本、复习记录和备份导入导出。

## 学习路径

1. 导入自己感兴趣的英文原文，原文不删改。
2. 朗读整篇，并按段查看自然翻译或词序翻译。
3. 用户亲自点击目标词；每篇建议上限约 10 个，选错可删、可换。
4. AI 只处理已选词：当前句含义 → 可靠构词/整词记忆 → 词源与同源词。
5. 集中学习：抓核心义 → 建结构 → 回扣原段并朗读 → 短暂找回。
6. 学完进入单词本，之后独立复习，不强迫重读全文。

## 本地运行 PWA

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。网页端有两种模型连接方式：

- 不配置服务器密钥：用户在界面临时填写 DeepSeek Key，关闭标签页后清除；
- 私有部署：服务器设置 `DEEPSEEK_API_KEY`，用户端可以留空。

复制 `.env.example` 为 `.env.local` 仅用于本机调试。任何真实 Key 都不得提交到 GitHub。

## 其他平台

- Windows：`cd platforms/desktop && npm ci && npm run dist`
- Android：`cd platforms/android && npm ci && npm run build:apk`
- GitHub 的“Actions → Build installable apps”可自动生成 Windows 与 Android 安装包。

## 腾讯云轻量服务器

已提供适配 Ubuntu 22.04 的独立 Node 运行层、Docker Compose、Caddy 自动 HTTPS 和健康检查。部署文件与安全说明见 [腾讯云部署](deploy/tencent-vps/README.md)。服务器密钥只写入被 Git 忽略的 `.env`，不进入前端或仓库。

## 项目边界

- GitHub 保存源码、版本和自动测试，不承载服务器密钥。
- 公开站点不得直接启用共用模型 Key；只有受访问控制的私有部署才可使用云端托管 Key。
- AI 输出均按候选资料处理；词卡要求原句证据，低可信构词自动降级为整词记忆。
- 当前档案和单词本保存在设备本地；多设备账户同步属于后续阶段。

详细设计见 [架构与安全](docs/架构与安全.md) 和 [产品需求基线](docs/产品需求基线.md)。旧静态原型永久保存在 `archive/legacy-static` 分支。
