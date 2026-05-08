// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{State, Window, Emitter};

// 影响扫描的配置
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ScanConfig {
    directories_only: bool,
    include_link_symbols: bool,
    max_depth: usize,
    ignore_patterns: String,
}

// 影响渲染的配置
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RenderConfig {
    include_empty: bool,
    only_empty: bool,
}

#[derive(Debug, Clone)]
struct TreeNode {
    name: String,
    rel_path: String,
    is_dir: bool,
    is_symlink: bool,
    symlink_target: Option<String>,
    children: Vec<TreeNode>,
}

// 全局缓存状态，存储上一次扫描的完整树，避免修改渲染配置时重复读盘
#[derive(Default)]
struct AppState {
    cached_tree: Mutex<Option<TreeNode>>,
}

// 构建 Glob 规则器
fn build_globset(patterns: &str) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for line in patterns.lines() {
        let line = line.trim();
        if !line.is_empty() && !line.starts_with('#') {
            if let Ok(glob) = Glob::new(line) {
                builder.add(glob);
            }
        }
    }
    builder.build().map_err(|e| e.to_string())
}

// 核心扫描函数：包含软链接穿越、Glob忽略、并向前端发送实时进度
fn build_tree(
    physical_path: &Path,
    node_name: &str,
    rel_path: &str,
    depth: usize,
    config: &ScanConfig,
    globset: &GlobSet,
    window: &Window,
    count: &mut usize,
) -> Result<TreeNode, String> {
    let mut children = Vec::new();

    if let Ok(entries) = fs::read_dir(physical_path) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let new_rel_path = if rel_path.is_empty() { file_name.clone() } else { format!("{}/{}", rel_path, file_name) };

            // 1.3.0 特性：使用 Glob 在底层直接拦截
            if globset.is_match(&new_rel_path) { continue; }

            *count += 1;
            // 实时发送扫描进度给前端动画 (每 50 个文件发送一次避免卡顿)
            if *count % 50 == 0 {
                let _ = window.emit("scan-progress", *count);
            }

            let symlink_metadata = fs::symlink_metadata(entry.path()).ok();
            let is_symlink = symlink_metadata.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
            let metadata = fs::metadata(entry.path()).ok();
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);

            let mut symlink_target = None;
            if is_symlink && config.include_link_symbols {
                if let Ok(target) = fs::read_link(entry.path()) {
                    symlink_target = Some(target.to_string_lossy().to_string());
                }
            }

            if is_dir {
                if depth < config.max_depth {
                    let target_physical_path = if is_symlink {
                        fs::canonicalize(entry.path()).unwrap_or_else(|_| entry.path())
                    } else {
                        entry.path()
                    };

                    if let Ok(mut child_node) = build_tree(&target_physical_path, &file_name, &new_rel_path, depth + 1, config, globset, window, count) {
                        child_node.is_symlink = is_symlink;
                        child_node.symlink_target = symlink_target;
                        children.push(child_node);
                    }
                } else {
                    children.push(TreeNode { name: file_name, rel_path: new_rel_path, is_dir: true, is_symlink, symlink_target, children: vec![] });
                }
            } else if !config.directories_only {
                children.push(TreeNode { name: file_name, rel_path: new_rel_path, is_dir: false, is_symlink, symlink_target, children: vec![] });
            }
        }
    }

    children.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(TreeNode {
        name: node_name.to_string(),
        rel_path: rel_path.to_string(),
        is_dir: true,
        is_symlink: false,
        symlink_target: None,
        children,
    })
}

fn has_empty_dir(node: &TreeNode) -> bool {
    if !node.is_dir { return false; }
    if node.children.is_empty() { return true; }
    node.children.iter().any(has_empty_dir)
}

// 1.2.1 特性：完美修复收尾 BUG
fn render_tree(
    node: &TreeNode,
    prefix: &str,
    is_last: bool,
    config: &RenderConfig,
    comments: &HashMap<String, String>,
    out: &mut String,
    is_root: bool,
    root_name: &str,
    include_link_symbols: bool, // 渲染时需要知道是否展示软链接符号
) {
    if !is_root {
        if config.only_empty && !has_empty_dir(node) { return; }
        if !config.include_empty && node.is_dir && node.children.is_empty() { return; }
    }

    let comment_key = if is_root { root_name } else { &node.rel_path };
    let comment_str = comments.get(comment_key).map(|c| format!(" # {}", c)).unwrap_or_default();

    let display_name = if node.is_symlink && include_link_symbols {
        if let Some(target) = &node.symlink_target {
            format!("{} -> {}", node.name, target)
        } else {
            node.name.clone()
        }
    } else if is_root {
        root_name.to_string()
    } else {
        node.name.clone()
    };

    if is_root {
        out.push_str(&format!("{}{}\n", display_name, comment_str));
    } else {
        let branch = if is_last { "└── " } else { "├── " };
        out.push_str(&format!("{}{}{}{}\n", prefix, branch, display_name, comment_str));
    }

    let next_prefix = format!("{}{}", prefix, if is_last { "    " } else { "│   " });
    
    // 【关键】：先过滤出真实可见的子节点，再计算谁是最后一个，完美解决收尾 BUG
    let visible_children: Vec<&TreeNode> = node.children.iter().filter(|c| {
        if config.only_empty && !has_empty_dir(c) { return false; }
        if !config.include_empty && c.is_dir && c.children.is_empty() { return false; }
        true
    }).collect();

    for (i, child) in visible_children.iter().enumerate() {
        let is_last_child = i == visible_children.len() - 1;
        render_tree(child, &next_prefix, is_last_child, config, comments, out, false, root_name, include_link_symbols);
    }
}

// 命令 1：仅扫描并缓存 (1.1.0 优化逻辑：缓存配置避免重扫)
#[tauri::command]
async fn scan_directory(
    window: Window,
    state: State<'_, AppState>,
    path: String,
    root_name: String,
    config: ScanConfig,
) -> Result<usize, String> {
    let globset = build_globset(&config.ignore_patterns)?;
    let root_path = PathBuf::from(&path);
    if !root_path.exists() { return Err("所选路径不存在".into()); }

    let mut count = 0;
    let tree = build_tree(&root_path, &root_name, "", 1, &config, &globset, &window, &mut count)?;
    
    // 发送最终数量
    let _ = window.emit("scan-progress", count);

    // 将扫描结果存入内存，供渲染使用
    *state.cached_tree.lock().unwrap() = Some(tree);

    Ok(count)
}

// 命令 2：从缓存读取并渲染 (纯字符串操作，极快)
#[tauri::command]
async fn render_cached_tree(
    state: State<'_, AppState>,
    config: RenderConfig,
    comments_str: String,
    root_name: String,
    include_link_symbols: bool,
) -> Result<String, String> {
    let comments = parse_comments(&comments_str);
    let mut output = String::new();

    let cache_lock = state.cached_tree.lock().unwrap();
    if let Some(tree) = cache_lock.as_ref() {
        render_tree(tree, "", true, &config, &comments, &mut output, true, &root_name, include_link_symbols);
        Ok(output)
    } else {
        Err("没有缓存的目录树数据，请先扫描".into())
    }
}

fn parse_comments(comments_str: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in comments_str.lines() {
        if let Some(idx) = line.find('#') {
            if idx > 0 {
                let key = line[..idx].trim().to_string();
                let val = line[idx + 1..].trim().to_string();
                if !key.is_empty() && !val.is_empty() { map.insert(key, val); }
            }
        }
    }
    map
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default()) // 注册全局缓存状态
        .invoke_handler(tauri::generate_handler![scan_directory, render_cached_tree])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}