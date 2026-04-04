# 目录结构树生成器

一个基于 Neutralino 的本地小工具，用于读取指定文件夹并生成目录树文本，方便快速粘贴到文档、Issue 或AI对话中。

可设置忽略文件、目录，自定义根目录显示名称、文件目录注释。

![页面图片](/images/页面图片.png)

## 效果

```
目录结构树生成器
├── images
│   └── 页面图片.png
├── resources
│   ├── css
│   │   ├── default.min.css
│   │   └── styles.css
│   ├── icons
│   │   └── appIcon.png
│   ├── js
│   │   ├── highlight.min.js
│   │   ├── markdown.min.js
│   │   ├── neutralino.js
│   │   └── script.js
│   └── index.html
├── neutralino.config.json
└── README.md
```

忽略列表使用正则匹配，例如匹配bin、dist目录的过滤正则规则是：

```
^bin(/|$)
^dist(/|$)
```

## 运行与打包

```bash
neu run
neu build
```

若需要启用开发者工具将 `enableInspector` 设置为 `true` 即可。