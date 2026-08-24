import cheerio from 'cheerio';

const MAX_TEXT_LENGTH = 2000;

function chunkText(text) {
  if (!text) {
    return [];
  }

  const chunks = [];

  for (let i = 0; i < text.length; i += MAX_TEXT_LENGTH) {
    chunks.push(text.substring(i, i + MAX_TEXT_LENGTH));
  }

  return chunks;
}

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).toString();
  } catch (error) {
    return null;
  }
}

function getImageUrl($, element) {
  const attributes = [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-lazy',
    'data-url',
    'src',
  ];

  for (let i = 0; i < attributes.length; i += 1) {
    const value = $(element).attr(attributes[i]);

    if (value && !value.startsWith('data:image')) {
      return normalizeUrl(value);
    }
  }

  /*
   * Handle srcset.
   *
   * Example:
   * image-small.jpg 480w,
   * image-large.jpg 1200w
   *
   * We choose the last URL, which is usually the largest one.
   */
  const srcset = $(element).attr('srcset');

  if (srcset) {
    const candidates = srcset
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (candidates.length > 0) {
      const lastCandidate = candidates[candidates.length - 1];
      const url = lastCandidate.split(/\s+/)[0];

      return normalizeUrl(url);
    }
  }

  return null;
}

function createRichText($, element) {
  const text = $(element).text().replace(/\s+/g, ' ').trim();

  if (!text) {
    return [];
  }

  return chunkText(text).map((content) => ({
    type: 'text',
    text: {
      content,
    },
  }));
}

function createParagraph($, element) {
  const richText = createRichText($, element);

  if (richText.length === 0) {
    return null;
  }

  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richText,
    },
  };
}

function createHeading($, element, level) {
  const richText = createRichText($, element);

  if (richText.length === 0) {
    return null;
  }

  return {
    object: 'block',
    type: `heading_${level}`,
    [`heading_${level}`]: {
      rich_text: richText,
    },
  };
}

function createQuote($, element) {
  const richText = createRichText($, element);

  if (richText.length === 0) {
    return null;
  }

  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: richText,
    },
  };
}

function createImage($, element) {
  const url = getImageUrl($, element);

  if (!url) {
    return null;
  }

  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: {
        url,
      },
    },
  };
}

function createDivider() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

function createBookmark($, element) {
  const href = normalizeUrl($(element).attr('href'));

  if (!href) {
    return null;
  }

  return {
    object: 'block',
    type: 'bookmark',
    bookmark: {
      url: href,
    },
  };
}

function createListItem($, element, ordered) {
  const richText = createRichText($, element);

  if (richText.length === 0) {
    return null;
  }

  const type = ordered
    ? 'numbered_list_item'
    : 'bulleted_list_item';

  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richText,
    },
  };
}

function processElement($, element) {
  if (!element || element.type !== 'tag') {
    return null;
  }

  const tagName = element.name.toLowerCase();

  switch (tagName) {
    case 'p':
      return createParagraph($, element);

    case 'h1':
      return createHeading($, element, 1);

    case 'h2':
      return createHeading($, element, 2);

    case 'h3':
      return createHeading($, element, 3);

    case 'h4':
    case 'h5':
    case 'h6':
      return createHeading($, element, 3);

    case 'blockquote':
      return createQuote($, element);

    case 'img':
      return createImage($, element);

    case 'figure': {
      const image = $(element).find('img').first();

      if (image.length > 0) {
        return createImage($, image[0]);
      }

      return null;
    }

    case 'hr':
      return createDivider();

    case 'a':
      return createBookmark($, element);

    case 'li': {
      const parent = $(element).parent().get(0);
      const ordered = parent && parent.name === 'ol';

      return createListItem($, element, ordered);
    }

    default:
      return null;
  }
}

function processContainer($, element) {
  const blocks = [];

  $(element)
    .contents()
    .each((_, child) => {
      if (child.type !== 'tag') {
        return;
      }

      const tagName = child.name.toLowerCase();

      /*
       * Containers need to be recursively traversed.
       */
      if (
        [
          'div',
          'section',
          'article',
          'main',
          'header',
          'footer',
          'figure',
        ].includes(tagName)
      ) {
        const directBlock = processElement($, child);

        if (directBlock) {
          blocks.push(directBlock);
          return;
        }

        blocks.push(...processContainer($, child));
        return;
      }

      const block = processElement($, child);

      if (block) {
        blocks.push(block);
      }
    });

  return blocks;
}

export default function htmlToNotionBlocks(htmlContent) {
  if (!htmlContent) {
    return [];
  }

  try {
    const $ = cheerio.load(
      `<div id="notion-feeder-root">${htmlContent}</div>`,
      {
        decodeEntities: true,
      },
    );

    return processContainer(
      $,
      $('#notion-feeder-root')[0],
    );
  } catch (error) {
    console.error('Failed to parse HTML content');
    console.error(error);

    return [];
  }
}
