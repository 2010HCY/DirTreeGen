const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;
const listen = window.__TAURI__.event.listen;

const dropArea = document.getElementById('dropArea');
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

let selectedPath = null;
let selectedFolderName = null;
let copyFeedbackTimer = null;
let treeCachedInBackend = false; // 标记后端是否已经存在缓存

let scanProgress = {
    count: 0,
    displayCount: 0,
    isScanning: false,
    animationFrameId: null
};

// 追踪当前的配置项 (影响渲染)
let currentConfig = {
    includeEmpty: false,
    onlyEmpty: false
};

// 追踪影响扫描的配置 (1.1.0 核心逻辑保存区)
let scanConfig = {
    directoriesOnly: false,
    includeLinkSymbols: true,
    maxDepth: 10,
    ignorePatterns: ''
};

let lastScanConfig = { ...scanConfig };

// ====== 还原：平滑数字动画效果 ======
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

// ====== 监听后端的扫描进度事件 ======
let lastUpdateTime = 0;
listen('scan-progress', (event) => {
    scanProgress.count = event.payload;
    const now = Date.now();
    if (now - lastUpdateTime > 100) { // 限制刷新频率，还原你原来的设计
        animateCounterDisplay(scanProgress.count);
        lastUpdateTime = now;
    }
});

// 仅空目录的联动逻辑
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

// ====== Tauri 原生对话框 ======
if (dropArea) {
    dropArea.addEventListener('click', async () => {
        try {
            const result = await open({ directory: true, multiple: false, title: '选择文件夹' });
            if (result) {
                selectedPath = result;
                selectedFolderName = result.split(/[\\/]/).pop() || result;
                treeCachedInBackend = false; // 更换了目录，标记缓存失效
                
                if (directoryDisplay) {
                    directoryDisplay.innerHTML = `已选择：${selectedFolderName}`;
                }
                if (generateBtn) {
                    generateBtn.disabled = false;
                }
            }
        } catch (error) { console.error('选择目录失败:', error); }
    });
}

// ====== Tauri 原生拖拽捕获 ======
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

if (dropArea) {
    listen('tauri://drag-enter', () => dropArea.classList.add('dragover'));
    listen('tauri://drag-leave', () => dropArea.classList.remove('dragover'));
    listen('tauri://drag-drop', (event) => {
        dropArea.classList.remove('dragover');
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
            selectedPath = paths[0]; 
            selectedFolderName = selectedPath.split(/[\\/]/).pop() || selectedPath;
            treeCachedInBackend = false; // 拖入了新目录，缓存失效
            
            if (directoryDisplay) directoryDisplay.innerHTML = `已选择：${selectedFolderName}`;
            if (generateBtn) generateBtn.disabled = false;
        }
    });
}

// ====== 核心：生成逻辑 (分离缓存与渲染) ======
if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        if (!selectedPath) {
            console.error('请先选择一个目录');
            return;
        }

        const newScanConfig = {
            directoriesOnly: directoriesOnly?.checked || false,
            includeLinkSymbols: includeLinkSymbols?.checked || false,
            maxDepth: Math.max(1, parseInt(maxDepthInput?.value, 10) || 10),
            ignorePatterns: ignorePatterns?.value || ''
        };

        const newCurrentConfig = {
            includeEmpty: includeEmpty?.checked || true,
            onlyEmpty: onlyEmpty?.checked || false
        };

        const rootName = (rootNameInput && rootNameInput.value.trim()) || selectedFolderName;
        const scanConfigChanged = JSON.stringify(lastScanConfig) !== JSON.stringify(newScanConfig);

        generateBtn.disabled = true;

        try {
            // 如果影响扫描的配置变了，或者从来没扫描过，则触发后端真实读盘
            if (scanConfigChanged || !treeCachedInBackend) {
                if (directoryDisplay) {
                    directoryDisplay.innerHTML = `正在读取目录...<br>已发现 0 个项目`;
                }

                scanProgress.count = 0;
                scanProgress.displayCount = 0;
                scanProgress.isScanning = true;

                // 呼叫后端扫描并缓存 (会触发上方的 scan-progress 事件)
                const finalCount = await invoke('scan_directory', { 
                    path: selectedPath, 
                    rootName: rootName,
                    config: newScanConfig 
                });

                scanProgress.isScanning = false;
                treeCachedInBackend = true;
                lastScanConfig = { ...newScanConfig };
                
                // 强制动画跑到最终值
                animateCounterDisplay(finalCount);
                setTimeout(() => {
                    if (directoryDisplay) {
                        directoryDisplay.innerHTML = `已选择：${selectedFolderName}<br>${finalCount}个项目`;
                    }
                }, 350);
            }

            // 无论是否重新扫描，都使用最新渲染配置，让后端从内存中瞬间渲染文本
            const treeText = await invoke('render_cached_tree', { 
                config: newCurrentConfig, 
                commentsStr: commentsArea?.value || '', 
                rootName: rootName,
                includeLinkSymbols: newScanConfig.includeLinkSymbols
            });

            preview.textContent = treeText;
            if (copyBtn) copyBtn.disabled = false;

        } catch (error) {
            scanProgress.isScanning = false;
            console.error('生成目录结构失败:', error);
            if (directoryDisplay) {
                directoryDisplay.textContent = '读取目录失败，请尝试其他目录';
            }
        } finally {
            generateBtn.disabled = false;
        }
    });
}

// ====== 还原：复制逻辑 ======
if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
        const plainText = preview.textContent || preview.innerText || '';
        try {
            await navigator.clipboard.writeText(plainText);
            if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
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