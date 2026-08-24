import dotenv from 'dotenv';
import { Client, LogLevel } from '@notionhq/client';

dotenv.config();

const {
  NOTION_API_TOKEN,
  NOTION_READER_DATABASE_ID,
  NOTION_FEEDS_DATABASE_ID,
  CI,
} = process.env;

const logLevel = CI ? LogLevel.INFO : LogLevel.DEBUG;

const notion = new Client({
  auth: NOTION_API_TOKEN,
  logLevel,
});

export async function getFeedUrlsFromNotion() {
  let response;

  try {
    response = await notion.databases.query({
      database_id: NOTION_FEEDS_DATABASE_ID,
      filter: {
        property: 'Enabled',
        checkbox: {
          equals: true,
        },
      },
    });
  } catch (err) {
    console.error(err);
    return [];
  }

  return response.results
    .map((item) => {
      const title = item.properties.Title?.title?.[0]?.plain_text;
      const feedUrl = item.properties.Link?.url;

      if (!feedUrl) {
        return null;
      }

      return {
        title: title || '',
        feedUrl,
      };
    })
    .filter(Boolean);
}

/**
 * Check whether an RSS item already exists in Notion.
 *
 * GUID is the primary deduplication key.
 *
 * Returns one of:
 * - 'exists':  the item is present in the database
 * - 'missing': the item is not present
 * - 'error':   the query failed (callers should fail closed)
 */
export async function feedItemExistsInNotion(guid) {
  if (!guid) {
    return 'missing';
  }

  try {
    const response = await notion.databases.query({
      database_id: NOTION_READER_DATABASE_ID,
      filter: {
        property: 'GUID',
        rich_text: {
          equals: guid,
        },
      },
      page_size: 1,
    });

    return response.results.length > 0 ? 'exists' : 'missing';
  } catch (err) {
    console.error('Failed to check GUID:', guid);
    console.error(err);

    // Fail closed.
    // If Notion cannot be queried, do NOT create the item,
    // otherwise a temporary API problem could cause duplicates.
    return 'error';
  }
}

function chunkArray(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

export async function addFeedItemToNotion(notionItem) {
  const { title, link, guid, content } = notionItem;

  if (!title && !link && !guid) {
    console.error('Invalid feed item:', notionItem);
    return null;
  }

  const properties = {
    Title: {
      title: [
        {
          text: {
            content: title || 'Untitled',
          },
        },
      ],
    },
  };

  if (link) {
    properties.Link = {
      url: link,
    };
  }

  if (guid) {
    properties.GUID = {
      rich_text: [
        {
          text: {
            content: guid.substring(0, 2000),
          },
        },
      ],
    };
  }

  try {
    /*
     * Notion's page creation API has a limit on the number of
     * children that can be supplied in one request.
     *
     * Create the page with the first batch, then append the rest.
     */
    const contentChunks = chunkArray(content || [], 100);

    const firstChunk = contentChunks.shift() || [];

    const response = await notion.pages.create({
      parent: {
        database_id: NOTION_READER_DATABASE_ID,
      },
      properties,
      children: firstChunk,
    });

    /*
     * Append remaining blocks.
     */
    for (let i = 0; i < contentChunks.length; i += 1) {
      await notion.blocks.children.append({
        block_id: response.id,
        children: contentChunks[i],
      });
    }

    return response;
  } catch (err) {
    console.error(`Failed to create Notion item: ${title}`);
    console.error(err);
    return null;
  }
}

export async function deleteOldUnreadFeedItemsFromNotion() {
  // Create a datetime which is 30 days earlier than the current time.
  const fetchBeforeDate = new Date();
  fetchBeforeDate.setDate(fetchBeforeDate.getDate() - 30);

  let response;

  try {
    response = await notion.databases.query({
      database_id: NOTION_READER_DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Created At',
            date: {
              on_or_before: fetchBeforeDate.toJSON(),
            },
          },
          {
            property: 'Read',
            checkbox: {
              equals: false,
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(err);
    return;
  }

  const feedItemsIds = response.results.map((item) => item.id);

  for (let i = 0; i < feedItemsIds.length; i += 1) {
    const id = feedItemsIds[i];

    try {
      await notion.pages.update({
        page_id: id,
        archived: true,
      });
    } catch (err) {
      console.error(err);
    }
  }
}
