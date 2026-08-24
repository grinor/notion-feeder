import crypto from 'crypto';

import getNewFeedItems from './feed';

import {
  addFeedItemToNotion,
  deleteOldUnreadFeedItemsFromNotion,
  feedItemExistsInNotion,
} from './notion';

import htmlToNotionBlocks from './parser';

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
  const fallback = [
    item.title || '',
    item.pubDate || item.isoDate || '',
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(fallback)
    .digest('hex');
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
      continue;
    }

    const htmlContent = getContent(item);

    const content = htmlToNotionBlocks(htmlContent);

    const notionItem = {
      title: item.title || 'Untitled',
      link: item.link || null,
      guid,
      content,
    };

    console.log(`Adding: ${notionItem.title}`);

    await addFeedItemToNotion(notionItem);
  }

  await deleteOldUnreadFeedItemsFromNotion();
}

index();
