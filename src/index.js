import crypto from 'crypto';

import getNewFeedItems from './feed';

import {
  addFeedItemToNotion,
  deleteOldUnreadFeedItemsFromNotion,
  feedItemExistsInNotion,
} from './notion';

import htmlToNotionBlocks from './parser';
import { normalizeUrl, proxyImageUrl } from './helpers';

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

  await addFeedItemToNotion(notionItem);
}

async function index() {
  const feedItems = await getNewFeedItems();

  console.log(`Found ${feedItems.length} feed items.`);

  for (let i = 0; i < feedItems.length; i += 1) {
    const item = feedItems[i];

    const guid = getItemGuid(item);

    /*
     * This is the key change:
     *
     * We no longer rely on RUN_FREQUENCY for deduplication.
     */
    const exists = await feedItemExistsInNotion(guid);

    if (exists) {
      console.log(`Skipping existing item: ${item.title}`);
    } else {
      await processFeedItem(item, guid);
    }
  }

  await deleteOldUnreadFeedItemsFromNotion();
}

index();
