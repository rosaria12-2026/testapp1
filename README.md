# PCE 针灸答题器 App

这是一个可部署到 GitHub Pages 的 PWA 网页 App。

## 使用方法

1. 登录 GitHub，新建一个 repository，例如：`pce-quiz-app`
2. 上传本文件夹里的所有文件：
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `icon-192.svg`
   - `icon-512.svg`
3. 进入 GitHub 仓库：
   - Settings
   - Pages
   - Build and deployment
   - Source 选择 `Deploy from a branch`
   - Branch 选择 `main` 和 `/root`
   - Save
4. 等 1-2 分钟，GitHub 会给你一个网址。
5. 用手机打开这个网址：
   - iPhone: Safari → 分享 → Add to Home Screen
   - Android/Chrome: 菜单 → Add to Home screen

## 注意

- 数据保存在浏览器本地 localStorage。
- 换手机、清缓存、换浏览器，数据不会自动同步。
- 如果要做账号登录和云同步，需要后端数据库版本。
