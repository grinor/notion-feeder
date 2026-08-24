import fs from 'fs';
import path from 'path';

/*
 * 已处理 GUID 历史记录。
 *
 * Notion 中被删除（归档）的页面无法通过 API 查询到，
 * 所以仅靠查库去重的话，手动删掉一条后重跑会把同一篇文章重新抓进来。
 *
 * 这个文件（默认 data/seen-guids.json）持久记录所有处理过的 GUID：
 * - 运行前加载，命中则直接跳过（连 Notion 查询都省了）
 * - 运行结束后把新增的 GUID 写回文件
 * - CI 中会把更新后的文件提交回仓库，形成长期记忆
 *
 * 可通过环境变量 SEEN_GUIDS_FILE 覆盖文件路径。
 */
const SEEN_GUIDS_FILE = process.env.SEEN_GUIDS_FILE || 'data/seen-guids.json';

export function loadSeenGuids() {
  try {
    const raw = fs.readFileSync(SEEN_GUIDS_FILE, 'utf8');
    const list = JSON.parse(raw);

    return new Set(Array.isArray(list) ? list : []);
  } catch (error) {
    // 文件不存在或损坏时，从空集合开始。
    return new Set();
  }
}

export function saveSeenGuids(seenGuids) {
  try {
    fs.mkdirSync(path.dirname(SEEN_GUIDS_FILE), { recursive: true });
    fs.writeFileSync(
      SEEN_GUIDS_FILE,
      JSON.stringify([...seenGuids].sort(), null, 2)
    );
  } catch (error) {
    console.error('Failed to save seen GUIDs:', error.message);
  }
}
