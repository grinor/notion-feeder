import crypto from 'crypto';

import getNewFeedItems from './feed';

import {
  addFeedItemToNotion,
  deleteOldUnreadFeedItemsFromNotion,
  feedItemExistsInNotion,
} from './notion';

import htmlToNotionBlocks from './parser';
import { normalizeUrl, proxyImageUrl } from './helpers';
import { loadSeenGuids, saveSeenGuids } from './seenGuids';

function getItemGuid(item) {
  /*
   * RSS GUID is the best identifier.
   */
  if (item.guid) {
    return String(item.guid);
  }

  /*
   * Some feeds use `id` instead of `guid`.
   */
  if (item.id) {
    return String(item.id);
  }

  /*
   * URL is usually stable.
   */
  if (item.link) {
    return String(item.link);
  }

  /*
   * Final fallback.
   */
  const fallback = [item.title || '', item.pubDate || item.isoDate || ''].join(
    '|'
  );

  return crypto.createHash('sha256').update(fallback).digest('hex');
}

function getContent(item) {
  /*
   * content:encoded is usually better than `content`
   * for WordPress-style RSS feeds.
   */
  return (
    item.contentEncoded ||
    item['content:encoded'] ||
    item.content ||
    item.summary ||
    ''
  );
}

function createImageBlock(url) {
  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: {
        url: proxyImageUrl(url),
      },
    },
  };
}

function getEnclosures(item) {
  if (Array.isArray(item.enclosure)) {
    return item.enclosure;
  }

  if (item.enclosure) {
    return [item.enclosure];
  }

  return [];
}

/*
 * 从 RSS 条目的媒体字段里提取封面图 URL。
 *
 * 覆盖：
 * - media:thumbnail / media:content（rss-parser 解析为 { $: { url, type } }）
 * - itunes:image（{ $: { href } }）
 * - enclosure（{ url, type }，可能是对象也可能是数组）
 *
 * 只接受 type 为图片（或未声明 type）的条目。
 */
function getCoverImageUrl(item, baseUrl) {
  const candidates = [];

  const mediaGroups = [
    ...(Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : []),
    ...(Array.isArray(item.mediaContent) ? item.mediaContent : []),
    ...(Array.isArray(item.itunesImage) ? item.itunesImage : []),
  ];

  for (let i = 0; i < mediaGroups.length; i += 1) {
    const media = mediaGroups[i];
    const attrs = media && (media.$ || media);
    const url = attrs && (attrs.url || attrs.href);
    const type = attrs && attrs.type;

    if (url && (!type || String(type).startsWith('image/'))) {
      candidates.push(url);
    }
  }

  const enclosures = getEnclosures(item);

  for (let i = 0; i < enclosures.length; i += 1) {
    const enclosure = enclosures[i];

    if (
      enclosure &&
      enclosure.url &&
      (!enclosure.type || String(enclosure.type).startsWith('image/'))
    ) {
      candidates.push(enclosure.url);
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeUrl(candidates[i], baseUrl);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

async function processFeedItem(item, guid) {
  const htmlContent = getContent(item);

  /*
   * 用文章链接（优先）或 feed 地址作为基准 URL，
   * 用于把正文里相对路径的图片解析成绝对地址。
   */
  const baseUrl = normalizeUrl(item.link) || normalizeUrl(item.feedUrl) || null;

  let content = htmlToNotionBlocks(htmlContent, baseUrl);

  /*
   * 正文里没有任何图片时，尝试用 enclosure / media:content / media:thumbnail
   * 提取封面图（播客、纯图片 feed 常见，正文里往往没有 <img>）。
   */
  const hasImageBlock = content.some((block) => block.type === 'image');

  if (!hasImageBlock) {
    const coverImageUrl = getCoverImageUrl(item, baseUrl);

    if (coverImageUrl) {
      content = [createImageBlock(coverImageUrl), ...content];
    }
  }

  const notionItem = {
    title: item.title || 'Untitled',
    link: item.link || null,
    guid,
    content,
  };

  console.log(`Adding: ${notionItem.title}`);

  return addFeedItemToNotion(notionItem);
}

async function index() {
  const feedItems = await getNewFeedItems();

  console.log(`Found ${feedItems.length} feed items.`);

  /*
   * 已处理 GUID 历史：即使条目被手动从 Notion 删除（归档），
   * 也不会被重新抓取。运行结束后会写回 data/seen-guids.json，
   * 由 CI 提交回仓库形成长期记忆。
   */
  const seenGuids = loadSeenGuids();

  for (let i = 0; i < feedItems.length; i += 1) {
    const item = feedItems[i];

    const guid = getItemGuid(item);

    if (seenGuids.has(guid)) {
      console.log(`Skipping previously seen item: ${item.title}`);
    } else {
      /*
       * 查重三态：
       * - 'exists': 已存在，跳过并记入历史（防止将来删除后重新抓取）
       * - 'error':  查询失败，跳过但不记入历史（fail closed，避免误屏蔽）
       * - 'missing': 不存在，插入；只有插入成功才记入历史
       */
      const status = await feedItemExistsInNotion(guid);

      if (status === 'exists') {
        console.log(`Skipping existing item: ${item.title}`);
        seenGuids.add(guid);
      } else if (status === 'error') {
        console.log(`Skipping existing item (check failed): ${item.title}`);
      } else {
        const created = await processFeedItem(item, guid);

        if (created) {
          seenGuids.add(guid);
        }
      }
    }
  }

  saveSeenGuids(seenGuids);

  await deleteOldUnreadFeedItemsFromNotion();
}

index();
