const directoryInput = document.getElementById('directoryInput');
const dropArea = document.getElementById('dropArea');
const dropHint = document.getElementById('dropHint');
const directoryDisplay = document.getElementById('directoryDisplay');
const generateBtn = document.getElementById('generateBtn');
const preview = document.getElementById('preview');
const copyBtn = document.getElementById('copyBtn');
const rootNameInput = document.getElementById('rootName');
const ignorePatterns = document.getElementById('ignorePatterns');
const commentsArea = document.getElementById('commentsArea');
const includeEmpty = document.getElementById('includeEmpty');
const onlyEmpty = document.getElementById('onlyEmpty');
const directoriesOnly = document.getElementById('directoriesOnly');
const includeLinkSymbols = document.getElementById('includeLinkSymbols');
const maxDepthInput = document.getElementById('maxDepth');

let selectedDirectory = null;
let folderEntries = null;
let copyFeedbackTimer = null;
let neutralinoReady = false;
let neutralinoInitPromise = Promise.resolve();
let scanProgress = {
    count: 0,
    displayCount: 0,
    isScanning: false,
    animationFrameId: null
};

// 追踪当前的配置项
let currentConfig = {
    includeEmpty: false,
    onlyEmpty: false,
    directoriesOnly: false,
    includeLinkSymbols: true,
    maxDepth: 10,
    ignorePatterns: ''
};

// 追踪影响扫描的配置
let scanConfig = {
    directoriesOnly: false,
    includeLinkSymbols: true,
    maxDepth: 10,
    ignorePatterns: ''
};

// 上次扫描时应用的配置
let lastScanConfig = { ...scanConfig };

initNeutralinoBridge();

function initNeutralinoBridge() {
    if (typeof Neutralino === 'undefined' || typeof Neutralino.init !== 'function') {
        return;
    }

    neutralinoInitPromise = new Promise((resolve) => {
        let settled = false;
        const markReady = () => {
            if (settled) {
                return;
            }
            settled = true;
            neutralinoReady = true;
            resolve();
        };

        if (Neutralino.events && typeof Neutralino.events.on === 'function') {
            Neutralino.events.on('ready', markReady).catch(() => {
                markReady();
            });
        }

        Neutralino.init();
        setTimeout(markReady, 1200);
    });
}

function hasNeutralinoFolderDialogApi() {
    return typeof Neutralino !== 'undefined'
        && !!Neutralino.os
        && !!Neutralino.filesystem
        && typeof Neutralino.os.showFolderDialog === 'function'
        && typeof Neutralino.filesystem.readDirectory === 'function';
}

function animateCounterDisplay(targetCount) {
    if (scanProgress.animationFrameId !== null) {
        cancelAnimationFrame(scanProgress.animationFrameId);
    }

    const startTime = Date.now();
    const duration = 300;

    const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        scanProgress.displayCount = Math.round(scanProgress.displayCount + (targetCount - scanProgress.displayCount) * progress);

        if (directoryDisplay && scanProgress.isScanning) {
            directoryDisplay.innerHTML = `正在读取目录...<br>已发现 ${scanProgress.displayCount} 个项目`;
        }

        if (progress < 1) {
            scanProgress.animationFrameId = requestAnimationFrame(animate);
        } else {
            scanProgress.animationFrameId = null;
        }
    };

    scanProgress.animationFrameId = requestAnimationFrame(animate);
}

async function handleDirectorySelected(folderName, entriesPromiseFunc) {
    if (dropHint) {
        dropHint.classList.add('hidden');
    }
    
    folderEntries = null;
    selectedDirectory = {
        name: folderName,
        entriesPromise: entriesPromiseFunc
    };

    if (directoryDisplay) {
        directoryDisplay.innerHTML = `已选择：${folderName}`;
    }
    
    if (generateBtn) {
        generateBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const script = document.createElement('script');
    script.src = '/js/highlight.min.js';
    script.async = true;
    script.onload = () => {
        const markdownScript = document.createElement('script');
        markdownScript.src = '/js/markdown.min.js';
        markdownScript.async = true;
        document.head.appendChild(markdownScript);
    };
    document.head.appendChild(script);
});

if (dropArea) {
    dropArea.addEventListener('click', async () => {
        if (hasNeutralinoFolderDialogApi()) {
            try {
                await neutralinoInitPromise;
                if (!isNativeFolderDialogAvailable()) {
                    if (directoryInput) {
                        directoryInput.click();
                    }
                    return;
                }

                const selectedPath = await Neutralino.os.showFolderDialog('选择文件夹');
                if (!selectedPath) {
                    return;
                }

                const folderName = getFolderNameFromPath(selectedPath);
                const entriesPromiseFunc = (config) => scanDirectoryByPath(selectedPath, '', [], config);
                await handleDirectorySelected(folderName, entriesPromiseFunc);
            } catch (error) {
                if (directoryDisplay) {
                    directoryDisplay.textContent = '读取目录失败，请尝试其他目录';
                }
                if (generateBtn) {
                    generateBtn.disabled = true;
                }
                console.error('选择目录失败:', error);
            }
            return;
        }

        if (directoryInput) {
            directoryInput.click();
        }
    });

    dropArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.add('dragover');
    });

    dropArea.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.remove('dragover');
    });

    dropArea.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropArea.classList.remove('dragover');

        const items = event.dataTransfer?.items;
        if (!items || items.length === 0) {
            console.error('未检测到文件夹');
            return;
        }

        const firstItem = items[0];
        if (firstItem.kind !== 'file') {
            console.error('请拖放文件夹');
            return;
        }

        const entry = firstItem.webkitGetAsEntry?.();
        if (!entry || !entry.isDirectory) {
            console.error('请拖放目录而不是单个文件');
            return;
        }

        const folderName = entry.name;
        const entriesPromiseFunc = async (config) => {
            const entries = [];
            await scanDirectoryEntry(entry, '', entries, config);
            return entries;
        };

        await handleDirectorySelected(folderName, entriesPromiseFunc);
    });
}

if (directoryInput) {
    directoryInput.addEventListener('change', handleDirectorySelection);
}

if (generateBtn) {
    generateBtn.addEventListener('click', generateDirectoryStructure);
}

// 监听影响扫描的配置项改变
if (directoriesOnly) {
    directoriesOnly.addEventListener('change', () => {
        folderEntries = null; // 清空缓存
    });
}

if (includeLinkSymbols) {
    includeLinkSymbols.addEventListener('change', () => {
        folderEntries = null; // 清空缓存
    });
}

if (onlyEmpty) {
    onlyEmpty.addEventListener('change', () => {
        if (onlyEmpty.checked) {
            includeEmpty.checked = true;
            includeEmpty.disabled = true;
        } else {
            includeEmpty.disabled = false;
        }
    });
}

if (maxDepthInput) {
    maxDepthInput.addEventListener('change', () => {
        folderEntries = null;
    });
}

if (ignorePatterns) {
    ignorePatterns.addEventListener('input', () => {
        folderEntries = null;
    });
}

if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
        const plainText = preview.textContent || preview.innerText || '';
        try {
            await navigator.clipboard.writeText(plainText);
            if (copyFeedbackTimer) {
                clearTimeout(copyFeedbackTimer);
            }
            copyBtn.classList.add('is-copied');
            copyFeedbackTimer = setTimeout(() => {
                copyBtn.classList.remove('is-copied');
                copyFeedbackTimer = null;
            }, 3000);
            console.log('复制成功');
        } catch (error) {
            console.error('复制失败', error);
        }
    });
}

function isNativeFolderDialogAvailable() {
    return neutralinoReady && hasNeutralinoFolderDialogApi();
}

function getFolderNameFromPath(path) {
    const trimmed = path.replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
}

function joinPath(basePath, childName) {
    const separator = basePath.includes('\\') ? '\\' : '/';
    const normalizedBase = basePath.replace(/[\\/]+$/, '');
    return `${normalizedBase}${separator}${childName}`;
}

async function scanDirectoryByPath(absolutePath, relativeBase = '', result = [], config = {}, lastUpdateTime = 0) {
    const maxDepth = config.maxDepth || 999999;
    const ignoreList = config.ignoreList || [];
    const directoriesOnly = config.directoriesOnly || false;

    // 计算当前深度
    const currentDepth = (relativeBase.match(/\//g) || []).length + 1;
    if (currentDepth > maxDepth) {
        return result;
    }

    let items = [];

    try {
        items = await Neutralino.filesystem.readDirectory(absolutePath);
    } catch (error) {
        if (relativeBase) {
            console.warn(`跳过不可读取目录: ${absolutePath}`, error);
            return result;
        }
        throw error;
    }

    for (const item of items) {
        const entryName = item.entry || item.name;
        if (!entryName || entryName === '.' || entryName === '..') {
            continue;
        }

        const itemType = String(item.type || '').toUpperCase();
        const relativePath = relativeBase ? `${relativeBase}/${entryName}` : entryName;

        // 检查忽略规则
        if (ignoreList.some((pattern) => pattern.test(relativePath))) {
            continue;
        }

        if (itemType === 'DIRECTORY') {
            result.push({ path: relativePath, type: 'dir' });
            scanProgress.count++;
            
            const now = Date.now();
            if (now - lastUpdateTime > 100) {
                animateCounterDisplay(scanProgress.count);
                lastUpdateTime = now;
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            if (currentDepth < maxDepth) {
                try {
                    await scanDirectoryByPath(joinPath(absolutePath, entryName), relativePath, result, config, lastUpdateTime);
                } catch (error) {
                    console.warn(`无法读取目录: ${relativePath}`, error.message || error);
                }
            }
            continue;
        }

        if (directoriesOnly) {
            continue;
        }

        result.push({ path: relativePath, type: 'file' });
        scanProgress.count++;
        
        const now = Date.now();
        if (now - lastUpdateTime > 100) {
            animateCounterDisplay(scanProgress.count);
            lastUpdateTime = now;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return result;
}

function handleDirectorySelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
        return;
    }

    const folderPath = files[0].webkitRelativePath;
    const folderName = folderPath.split('/')[0];

    const entriesPromiseFunc = (config) => {
        const entries = buildEntriesFromFiles(files, folderName, config);
        return Promise.resolve(entries);
    };

    handleDirectorySelected(folderName, entriesPromiseFunc);
    event.target.value = '';
}

async function generateDirectoryStructure() {
    if (!selectedDirectory) {
        console.error('请先选择一个目录');
        return;
    }

    // 读取当前配置值
    const newConfig = {
        includeEmpty: includeEmpty?.checked || true,
        onlyEmpty: onlyEmpty?.checked || false,
        directoriesOnly: directoriesOnly?.checked || false,
        includeLinkSymbols: includeLinkSymbols?.checked || false,
        maxDepth: Math.max(1, Number.parseInt(maxDepthInput?.value, 10) || 10),
        ignorePatterns: ignorePatterns?.value || ''
    };

    // 检查影响扫描的配置是否改变
    const newScanConfig = {
        directoriesOnly: newConfig.directoriesOnly,
        includeLinkSymbols: newConfig.includeLinkSymbols,
        maxDepth: newConfig.maxDepth,
        ignorePatterns: newConfig.ignorePatterns
    };

    const scanConfigChanged = JSON.stringify(scanConfig) !== JSON.stringify(newScanConfig);
    
    currentConfig = newConfig;
    scanConfig = newScanConfig;

    if (generateBtn) {
        generateBtn.disabled = true;
    }

    try {
        if (scanConfigChanged || !folderEntries) {
            if (directoryDisplay) {
                directoryDisplay.textContent = `正在读取目录...已发现 0 个项目`;
            }

            scanProgress.count = 0;
            scanProgress.displayCount = 0;
            scanProgress.isScanning = true;

            try {
                // 构建扫描配置对象
                const ignoreList = parseIgnorePatterns(newConfig.ignorePatterns);
                const config = {
                    maxDepth: newConfig.maxDepth,
                    ignoreList: ignoreList,
                    directoriesOnly: newConfig.directoriesOnly
                };

                folderEntries = await selectedDirectory.entriesPromise(config);
                scanProgress.isScanning = false;
                lastScanConfig = { ...newScanConfig };
                
                if (directoryDisplay) {
                    directoryDisplay.innerHTML = `已选择：${selectedDirectory.name}<br>${folderEntries.length}个项目`;
                }
            } catch (error) {
                scanProgress.isScanning = false;
                if (directoryDisplay) {
                    directoryDisplay.textContent = '读取目录失败，请尝试其他目录';
                }
                if (generateBtn) {
                    generateBtn.disabled = false;
                }
                console.error('读取目录失败:', error);
                return;
            }
        }

        const rootName = rootNameInput.value.trim() || selectedDirectory.name;
        const comments = parseComments(commentsArea.value);

        if (!folderEntries || folderEntries.length === 0) {
            preview.textContent = `${rootName}\n`;
            if (copyBtn) {
                copyBtn.disabled = false;
            }
            if (generateBtn) {
                generateBtn.disabled = false;
            }
            return;
        }

        const tree = buildDirectoryTree(folderEntries, rootName, comments);
        const treeText = renderTree(tree, currentConfig.includeEmpty, currentConfig.onlyEmpty, currentConfig.maxDepth);

        preview.textContent = treeText;

        if (copyBtn) {
            copyBtn.disabled = false;
        }
    } catch (error) {
        console.error('生成目录结构失败:', error);
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
        }
    }
}

function parseIgnorePatterns(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map((pattern) => {
            try {
                const isRoot = pattern.startsWith('/');
                const isDir = pattern.endsWith('/');
                
                let cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '');
                
                let escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                
                escaped = escaped.replace(/\*/g, '.*');
                escaped = escaped.replace(/\?/g, '.');
                
                let finalRegex = '';
                
                if (isRoot) {
                    finalRegex = '^' + escaped;
                } else {
                    finalRegex = '(^|/)' + escaped;
                }
                
                if (isDir) {
                    finalRegex = finalRegex + '/';
                } else {
                    finalRegex = finalRegex + '($|/)';
                }
                
                return new RegExp(finalRegex);
            } catch (error) {
                console.warn(`忽略规则转换失败: ${pattern}`);
                return null;
            }
        })
        .filter(Boolean);
}

function parseComments(text) {
    const comments = {};
    text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
            const splitIndex = line.indexOf('#');
            if (splitIndex <= 0) {
                return;
            }
            const key = line.slice(0, splitIndex).trim();
            const value = line.slice(splitIndex + 1).trim();
            if (key && value) {
                comments[key] = value;
            }
        });
    return comments;
}

function buildEntriesFromFiles(files, folderName, config = {}) {
    const entries = [];
    const dirSet = new Set();
    const maxDepth = config.maxDepth || 999999;
    const ignoreList = config.ignoreList || [];
    const directoriesOnly = config.directoriesOnly || false;

    for (const file of files) {
        const relativePath = file.webkitRelativePath.slice(folderName.length + 1);
        if (!relativePath) {
            continue;
        }

        // 检查深度限制
        const depth = (relativePath.match(/\//g) || []).length + 1;
        if (depth > maxDepth) {
            continue;
        }

        // 检查忽略规则
        if (ignoreList.some((pattern) => pattern.test(relativePath))) {
            continue;
        }

        if (!directoriesOnly) {
            entries.push({
                path: relativePath,
                type: 'file'
            });
        }

        const parts = relativePath.split('/');
        for (let i = 0; i < parts.length - 1; i += 1) {
            const dirPath = parts.slice(0, i + 1).join('/');
            
            const dirDepth = (dirPath.match(/\//g) || []).length + 1;
            if (dirDepth > maxDepth) {
                continue;
            }

            if (ignoreList.some((pattern) => pattern.test(dirPath))) {
                continue;
            }

            if (!dirSet.has(dirPath)) {
                dirSet.add(dirPath);
                entries.push({
                    path: dirPath,
                    type: 'dir'
                });
            }
        }
    }

    return entries;
}

async function scanDirectoryEntry(entry, basePath, result, config = {}, lastUpdateTime = 0) {
    if (!entry.isDirectory) {
        return;
    }

    const maxDepth = config.maxDepth || 999999;
    const ignoreList = config.ignoreList || [];
    const directoriesOnly = config.directoriesOnly || false;

    // 计算当前深度
    const currentDepth = (basePath.match(/\//g) || []).length + 1;
    if (currentDepth > maxDepth) {
        return;
    }

    let reader;
    try {
        reader = entry.createReader();
    } catch (error) {
        console.warn(`无法创建目录读取器: ${entry.name}`, error);
        return;
    }

    const allEntries = [];

    while (true) {
        let chunk = [];
        try {
            chunk = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
        } catch (error) {
            console.warn(`无法读取目录条目: ${entry.name}`, error);
            break;
        }

        if (!chunk.length) {
            break;
        }

        allEntries.push(...chunk);
    }

    for (const item of allEntries) {
        const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
        
        // 检查忽略规则
        if (ignoreList.some((pattern) => pattern.test(itemPath))) {
            continue;
        }

        if (item.isDirectory) {
            result.push({ path: itemPath, type: 'dir' });
            scanProgress.count++;
            
            const now = Date.now();
            if (now - lastUpdateTime > 100) {
                animateCounterDisplay(scanProgress.count);
                lastUpdateTime = now;
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            if (currentDepth < maxDepth) {
                try {
                    await scanDirectoryEntry(item, itemPath, result, config, lastUpdateTime);
                } catch (error) {
                    console.warn(`无法读取子目录: ${itemPath}`, error);
                }
            }
        } else {
            if (!directoriesOnly) {
                result.push({ path: itemPath, type: 'file' });
                scanProgress.count++;
                
                const now = Date.now();
                if (now - lastUpdateTime > 100) {
                    animateCounterDisplay(scanProgress.count);
                    lastUpdateTime = now;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }
    }
}

function buildDirectoryTree(entries, rootName, comments) {
    const tree = {
        name: rootName,
        type: 'dir',
        comment: comments[rootName] || '',
        children: {}
    };

    const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

    for (const entry of sorted) {
        const parts = entry.path.split('/').filter(Boolean);
        let currentChildren = tree.children;
        let currentPath = '';

        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLast = i === parts.length - 1;
            const nodeType = isLast ? entry.type : 'dir';

            if (!currentChildren[part]) {
                currentChildren[part] = {
                    name: part,
                    type: nodeType,
                    comment: comments[currentPath] || '',
                    children: {}
                };
            }

            currentChildren = currentChildren[part].children;
        }
    }

    return tree;
}

function isEmptyDir(node) {
    if (node.type === 'file') {
        return false;
    }
    return Object.keys(node.children).length === 0;
}

function hasEmptyDir(node) {
    if (node.type === 'file') {
        return false;
    }
    
    if (isEmptyDir(node)) {
        return true;
    }
    
    for (const child of Object.values(node.children)) {
        if (hasEmptyDir(child)) {
            return true;
        }
    }
    
    return false;
}

function renderTree(tree, includeEmptyDirs, onlyEmpty, maxDepth) {
    const lines = [];
    lines.push(formatNodeLine(tree.name, tree.comment));

    const children = sortNodes(Object.values(tree.children));
    appendTreeLines(children, '', lines, includeEmptyDirs, onlyEmpty, 1, maxDepth);

    return lines.join('\n');
}

function appendTreeLines(children, indent, lines, includeEmptyDirs, onlyEmpty, depth, maxDepth) {
    if (depth > maxDepth) {
        return;
    }

    const visibleChildren = children.filter(child => {
        if (onlyEmpty) {
            if (child.type === 'file') {
                return false;
            }
            if (!hasEmptyDir(child)) {
                return false;
            }
        }
        return true;
    });

    visibleChildren.forEach((child, index) => {
        const isLast = index === visibleChildren.length - 1;
        const branch = isLast ? '└── ' : '├── ';

        lines.push(`${indent}${branch}${formatNodeLine(child.name, child.comment)}`);

        const nextChildren = sortNodes(Object.values(child.children));
        const shouldContinue = nextChildren.length > 0 || (includeEmptyDirs && child.type === 'dir');
        
        if (!shouldContinue) {
            return;
        }

        const nextIndent = `${indent}${isLast ? '    ' : '│   '}`;
        appendTreeLines(nextChildren, nextIndent, lines, includeEmptyDirs, onlyEmpty, depth + 1, maxDepth);
    });
}

function formatNodeLine(name, comment) {
    return comment ? `${name} # ${comment}` : name;
}

function sortNodes(nodes) {
    return nodes.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'dir' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}
