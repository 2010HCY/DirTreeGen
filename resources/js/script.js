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
const directoriesOnly = document.getElementById('directoriesOnly');
const maxDepthInput = document.getElementById('maxDepth');

let selectedDirectory = null;
let folderEntries = null;
let copyFeedbackTimer = null;
let neutralinoReady = false;
let neutralinoInitPromise = Promise.resolve();

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
            await selectDirectoryWithNativeDialog();
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

        selectedDirectory = {
            name: entry.name,
            entry
        };
        folderEntries = null;

        updateDirectoryDisplay(entry.name);
        rootNameInput.placeholder = entry.name;
        generateBtn.disabled = false;
    });
}

if (directoryInput) {
    directoryInput.addEventListener('change', handleDirectorySelection);
}

if (generateBtn) {
    generateBtn.addEventListener('click', generateDirectoryStructure);
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

async function selectDirectoryWithNativeDialog() {
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

        if (dropHint) {
            dropHint.classList.add('hidden');
        }
        if (directoryDisplay) {
            directoryDisplay.textContent = '正在读取目录...';
        }
        if (generateBtn) {
            generateBtn.disabled = true;
        }

        const folderName = getFolderNameFromPath(selectedPath);
        selectedDirectory = {
            name: folderName,
            path: selectedPath
        };
        folderEntries = await scanDirectoryByPath(selectedPath);

        updateDirectoryDisplay(folderName);
        rootNameInput.placeholder = folderName;
        generateBtn.disabled = false;
    } catch (error) {
        if (directoryDisplay) {
            directoryDisplay.textContent = '读取目录失败，请尝试其他目录';
        }
        if (generateBtn) {
            generateBtn.disabled = true;
        }
        console.error('选择目录失败:', error);
    }
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

async function scanDirectoryByPath(absolutePath, relativeBase = '', result = []) {
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

        if (itemType === 'DIRECTORY') {
            result.push({ path: relativePath, type: 'dir' });
            await scanDirectoryByPath(joinPath(absolutePath, entryName), relativePath, result);
            continue;
        }

        result.push({ path: relativePath, type: 'file' });
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

    selectedDirectory = { name: folderName };
    folderEntries = buildEntriesFromFiles(files, folderName);

    updateDirectoryDisplay(folderName);
    rootNameInput.placeholder = folderName;
    generateBtn.disabled = false;

    event.target.value = '';
}

function updateDirectoryDisplay(folderName) {
    if (dropHint) {
        dropHint.classList.add('hidden');
    }
    if (directoryDisplay) {
        directoryDisplay.textContent = `已选择：${folderName}`;
    }
}

async function generateDirectoryStructure() {
    if (!selectedDirectory) {
        console.error('请先选择一个目录');
        return;
    }

    const rootName = rootNameInput.value.trim() || selectedDirectory.name;
    const ignoreList = parseIgnorePatterns(ignorePatterns.value);
    const comments = parseComments(commentsArea.value);

    try {
        let entries = folderEntries;

        if (selectedDirectory.entry) {
            entries = [];
            await scanDirectoryEntry(selectedDirectory.entry, '', entries);
            folderEntries = entries;
        }

        if (!entries || entries.length === 0) {
            preview.textContent = `${rootName}\n`;
            return;
        }

        const filteredEntries = entries.filter((entry) => {
            if (directoriesOnly.checked && entry.type === 'file') {
                return false;
            }
            return !ignoreList.some((pattern) => pattern.test(entry.path));
        });

        const tree = buildDirectoryTree(filteredEntries, rootName, comments);
        const maxDepth = Number.parseInt(maxDepthInput.value, 10) || 10;
        const treeText = renderTree(tree, includeEmpty.checked, maxDepth);

        preview.textContent = treeText;

        if (copyBtn) {
            copyBtn.disabled = false;
        }
    } catch (error) {
        console.error('生成目录结构失败:', error);
    }
}

function parseIgnorePatterns(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((pattern) => {
            try {
                return new RegExp(pattern);
            } catch (error) {
                console.warn(`忽略了无效正则: ${pattern}`);
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

function buildEntriesFromFiles(files, folderName) {
    const entries = [];
    const dirSet = new Set();

    for (const file of files) {
        const relativePath = file.webkitRelativePath.slice(folderName.length + 1);
        if (!relativePath) {
            continue;
        }

        entries.push({
            path: relativePath,
            type: 'file'
        });

        const parts = relativePath.split('/');
        for (let i = 0; i < parts.length - 1; i += 1) {
            const dirPath = parts.slice(0, i + 1).join('/');
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

async function scanDirectoryEntry(entry, basePath, result) {
    if (!entry.isDirectory) {
        return;
    }

    const reader = entry.createReader();
    const allEntries = [];

    while (true) {
        const chunk = await new Promise((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });

        if (!chunk.length) {
            break;
        }

        allEntries.push(...chunk);
    }

    for (const item of allEntries) {
        const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
        if (item.isDirectory) {
            result.push({ path: itemPath, type: 'dir' });
            await scanDirectoryEntry(item, itemPath, result);
        } else {
            result.push({ path: itemPath, type: 'file' });
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

function renderTree(tree, includeEmptyDirs, maxDepth) {
    const lines = [];
    lines.push(formatNodeLine(tree.name, tree.comment));

    const children = sortNodes(Object.values(tree.children));
    appendTreeLines(children, '', lines, includeEmptyDirs, 1, maxDepth);

    return lines.join('\n');
}

function appendTreeLines(children, indent, lines, includeEmptyDirs, depth, maxDepth) {
    if (depth > maxDepth) {
        return;
    }

    children.forEach((child, index) => {
        const isLast = index === children.length - 1;
        const branch = isLast ? '└── ' : '├── ';

        lines.push(`${indent}${branch}${formatNodeLine(child.name, child.comment)}`);

        const nextChildren = sortNodes(Object.values(child.children));
        const shouldContinue = nextChildren.length > 0 || (includeEmptyDirs && child.type === 'dir');
        if (!shouldContinue) {
            return;
        }

        const nextIndent = `${indent}${isLast ? '    ' : '│   '}`;
        appendTreeLines(nextChildren, nextIndent, lines, includeEmptyDirs, depth + 1, maxDepth);
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




