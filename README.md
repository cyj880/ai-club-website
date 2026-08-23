# 人工智能协会招新网站

面向大一新生的协会宣传页，纯静态 HTML/CSS/JS，无任何外部依赖。

- 线上地址（GitHub Pages）：部署后更新
- 招新QQ群：551018478

## 目录结构

```
ai-club-website/
├── index.html        # 页面结构
├── css/style.css     # 样式（蓝紫科技风主题）
├── js/main.js        # 交互（滚动动画、复制群号、导航状态）
└── assets/           # 海报图、图标
```

## 如何修改内容

直接编辑 `index.html` 中的对应文字即可；颜色主题集中在 `css/style.css` 顶部的 `:root` 变量里。

改完后提交并推送到 GitHub，线上页面会自动更新：

```bash
git add .
git commit -m "更新内容"
git push
```
