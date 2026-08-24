import Parser from 'rss-parser';
import dotenv from 'dotenv';
import { getFeedUrlsFromNotion } from './notion';

dotenv.config();

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['enclosure', 'enclosure', { keepArray: true }],
    ],
  },
});

async function getFeedItemsFrom(feedUrl) {
  let rss;

  try {
    rss = await parser.parseURL(feedUrl);
  } catch (error) {
    console.error(`Failed to fetch feed: ${feedUrl}`);
    console.error(error);
    return [];
  }

  return rss.items.map((item) => ({
    ...item,
    feedUrl,
  }));
}

export default async function getNewFeedItems() {
  let allFeedItems = [];

  const feeds = await getFeedUrlsFromNotion();

  for (let i = 0; i < feeds.length; i += 1) {
    const { feedUrl } = feeds[i];

    const feedItems = await getFeedItemsFrom(feedUrl);

    allFeedItems = [...allFeedItems, ...feedItems];
  }

  // Sort oldest → newest so that items are added in chronological order.
  allFeedItems.sort((a, b) => {
    const dateA = new Date(a.pubDate || a.isoDate || 0).getTime();
    const dateB = new Date(b.pubDate || b.isoDate || 0).getTime();

    return dateA - dateB;
  });

  return allFeedItems;
}
