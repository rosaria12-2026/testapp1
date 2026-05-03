# PCE 针灸答题器：修正版 + 云同步入口

## 修复内容
- 修掉页面底部出现 JavaScript 乱码的问题
- HTML / CSS / JS 分文件，GitHub Pages 更稳定
- 保留：导入题目、答题、错题库、不会题、模拟考试、CSV、打印报告
- 新增：Firebase 云同步入口

## 上传到 GitHub
把这些文件全部上传到仓库根目录：
- index.html
- style.css
- app.js
- manifest.json
- sw.js
- icon.svg
- README.md

GitHub Pages 设置：
Settings → Pages → Deploy from a branch → main → /root

## 云同步设置
需要你自己创建 Firebase 免费项目：

1. 打开 Firebase Console，新建项目
2. Build → Authentication → Sign-in method → 开启 Email/Password
3. Build → Firestore Database → Create database
4. Firestore Rules 可先用下面规则：

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /pceQuizData/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

5. Project settings → Web app → 复制 firebaseConfig
6. 打开你的答题器 → 云同步 → 粘贴配置 → 保存
7. 注册/登录 → 上传本地数据到云端

注意：第一次同步先“上传本地数据到云端”。
