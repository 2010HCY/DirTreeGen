# 目录结构树生成器

一个基于 Neutralino 的本地小工具，用于读取指定文件夹并生成目录树文本，方便快速粘贴到文档、Issue 或AI对话中。

可设置忽略文件、目录，自定义根目录显示名称、文件目录注释，可选择仅返回空目录方便快速清理空文件夹

![页面图片](/images/页面图片1.2.0.png)

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

忽略列表在1.3.0之后使用Glob 模式匹配，例如匹配bin、dist目录的过滤正则规则是：

```
bin
dist
```

## 运行与打包

**1. 安装 Neutralinojs CLI (如果你还没安装)**

```bash
npm install -g @neutralinojs/neu
```

**2. 初始化**

```bash
git clone https://github.com/2010HCY/DirTreeGen.git
cd DirTreeGen
neu update
```

> 执行 `neu update` 后，CLI 会自动创建 `bin/` 目录并下载各平台的运行时程序（`neutralino-win_x64.exe`, `neutralino-linux_x64`, `neutralino-mac_x64` 等）。

**3. 构建**


```
neu build
```

构建成品可以在`dist/dir-tree-gen`下找到。

若需要启用开发者工具将`neutralino.config.json` 中的`enableInspector` 设置为 `true` 即可。



Blog地址：[文件目录树生成器 | 静水深流](https://hcyhub.com/编程/文件目录树生成器)

下载地址：[Releases · 2010HCY/DirTreeGen](https://github.com/2010HCY/DirTreeGen/releases)

### 更新日志

#### 1.4.0

使用Tauri v2重写，并且支持处理软连接。

#### 1.3.0

正则使用 Glob 模式

#### 1.2.1

修复仅包括空目录模式下目录树不能收尾的BUG

#### 1.2.0

新增仅扫描/显示空目录功能，便于清理空文件夹。

#### 1.1.0

优化扫描逻辑

修改点击、拖拽文件不立即扫描，在配置完配置项后使用配置项过滤规则进行扫描。
避免了仅需根目录文件列表却扫描一整个目录。
同时文件层级深度上限提升至999,999，远超NTFS16,000上限。
现在扫描目录会显示进度了。

#### 1.0.0

首个版本