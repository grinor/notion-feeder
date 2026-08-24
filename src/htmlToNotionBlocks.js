import cheerio from 'cheerio';
import { normalizeUrl, proxyImageUrl } from './helpers';

const MAX_TEXT_LENGTH = 2000;

/*
 * 需要递归深入子节点的标签。
 *
 * picture / noscript / span 等标签本身不产生块，
 * 但内部可能包含 <img>（响应式图片、懒加载图片、WordPress 的 noscript 回退等）。
 * ul / ol 也需要递归，否则嵌套列表会整个丢失。
 */
const CONTAINER_TAGS = [
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'figure',
  'picture',
  'noscript',
  'span',
  'ul',
  'ol',
];

/*
 * 常见懒加载属性。
 *
 * 顺序很重要：data-* 里一般是真实图片地址，
 * 所以优先取 data-*，最后才回退到 src（src 可能是占位图）。
 */
const LAZY_IMAGE_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-lazy',
  'data-url',
  'data-echo',
  'data-lazysrc',
  'data-original-src',
  'data-ng-src',
  'data-hi-res-src',
  'data-image',
];

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

/*
 * 从一个 <img> 元素上提取图片地址。
 *
 * 优先级：
 * 1. data-* 懒加载属性（真实地址）
 * 2. srcset / data-srcset / data-lazy-srcset（响应式图片）
 * 3. src（可能是占位图，最后兜底）
 */
function getImageUrl($, element, baseUrl) {
  for (let i = 0; i < LAZY_IMAGE_ATTRIBUTES.length; i += 1) {
    const value = $(element).attr(LAZY_IMAGE_ATTRIBUTES[i]);

    if (value) {
      const url = normalizeUrl(value, baseUrl);

      if (url) {
        return url;
      }
    }
  }

  const srcset =
    $(element).attr('srcset') ||
    $(element).attr('data-srcset') ||
    $(element).attr('data-lazy-srcset');

  if (srcset) {
    const candidates = srcset
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    /*
     * 从最后一个候选开始取（通常是最大尺寸的图），
     * 逐个尝试解析，跳过无法解析的候选（例如 data:image 占位）。
     */
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const url = normalizeUrl(candidates[i].split(/\s+/)[0], baseUrl);

      if (url) {
        return url;
      }
    }
  }

  const src = $(element).attr('src');

  if (src) {
    const url = normalizeUrl(src, baseUrl);

    if (url) {
      return url;
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

function createImage($, element, baseUrl, seenImageUrls) {
  const url = getImageUrl($, element, baseUrl);

  if (!url) {
    return null;
  }

  /*
   * 同一篇内容里重复出现的图片只保留第一张，
   * 避免懒加载场景（占位图 + noscript 回退图）产生重复块。
   */
  if (seenImageUrls.has(url)) {
    return null;
  }

  seenImageUrls.add(url);

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

  const type = ordered ? 'numbered_list_item' : 'bulleted_list_item';

  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richText,
    },
  };
}

function processElement($, element, baseUrl, seenImageUrls) {
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
      return createImage($, element, baseUrl, seenImageUrls);

    case 'figure': {
      const image = $(element).find('img').first();

      if (image.length > 0) {
        return createImage($, image[0], baseUrl, seenImageUrls);
      }

      return null;
    }

    case 'hr':
      return createDivider();

    case 'a': {
      /*
       * 链接包裹的图片（常见于缩略图）→ 直接生成图片块。
       */
      const image = $(element).find('img').first();

      if (image.length > 0) {
        const imageBlock = createImage($, image[0], baseUrl, seenImageUrls);

        if (imageBlock) {
          return imageBlock;
        }
      }

      /*
       * 带 href 的链接 → bookmark。
       */
      const bookmark = createBookmark($, element);

      if (bookmark) {
        return bookmark;
      }

      /*
       * 无 href 的纯文字链接 → 段落。
       */
      return createParagraph($, element);
    }

    case 'li': {
      const parent = $(element).parent().get(0);
      const ordered = parent && parent.name === 'ol';

      return createListItem($, element, ordered);
    }

    default:
      return null;
  }
}

function processContainer($, element, baseUrl, seenImageUrls) {
  const blocks = [];

  $(element)
    .contents()
    .each((_, child) => {
      if (child.type !== 'tag') {
        return;
      }

      const tagName = child.name.toLowerCase();

      const directBlock = processElement($, child, baseUrl, seenImageUrls);

      if (directBlock) {
        blocks.push(directBlock);
      }

      /*
       * 是否继续深入子节点：
       *
       * 1. 容器标签（div/section/picture/noscript/span/ul/ol...）：
       *    子节点里可能有新的块。
       * 2. 元素内部包含图片（img/picture/figure），但直接处理没有产生图片块：
       *    例如 <li><img></li>、<p><img></p> 这种嵌套。
       *
       * <a> 不递归：链接内的文字/图片已在 processElement 中处理，
       * 避免 <p>文字<a>链接</a></p> 这类结构里文字被重复生成。
       */
      const directBlockIsImage = directBlock && directBlock.type === 'image';
      const containsImages = $(child).find('img, picture, figure').length > 0;
      const isContainer = CONTAINER_TAGS.includes(tagName);
      const isLink = tagName === 'a';

      if (!isLink && (isContainer || (containsImages && !directBlockIsImage))) {
        blocks.push(...processContainer($, child, baseUrl, seenImageUrls));
      }
    });

  return blocks;
}

/*
 * 把 HTML 正文转换成 Notion blocks。
 *
 * @param {string} htmlContent RSS 条目的 HTML 正文
 * @param {string} [baseUrl] 文章链接或 feed 地址，用于解析相对路径图片
 */
export default function htmlToNotionBlocks(htmlContent, baseUrl = null) {
  if (!htmlContent) {
    return [];
  }

  try {
    const $ = cheerio.load(
      `<div id="notion-feeder-root">${htmlContent}</div>`,
      {
        decodeEntities: true,
      }
    );

    const seenImageUrls = new Set();

    return processContainer(
      $,
      $('#notion-feeder-root')[0],
      baseUrl,
      seenImageUrls
    );
  } catch (error) {
    console.error('Failed to parse HTML content');
    console.error(error);

    return [];
  }
}
