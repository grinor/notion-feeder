import dotenv from 'dotenv';

dotenv.config();

/*
 * 可选：把图片 URL 通过第三方图片代理转发。
 *
 * 用途：部分网站做了防盗链（校验 Referer / 拦截非浏览器 UA），
 * Notion 的服务端抓取图片时会失败，导致图片在 Notion 里显示为空白或损坏。
 * 通过代理（如 images.weserv.nl）可以绕过。
 *
 * 在 .env 中设置，例如：
 *   IMAGE_PROXY_URL=https://images.weserv.nl/?url=
 *
 * 留空则直接使用原始图片地址，不做代理。
 */
const IMAGE_PROXY_URL = (process.env.IMAGE_PROXY_URL || '').trim();

/*
 * 把图片 / 链接地址规范化为绝对 URL。
 *
 * baseUrl 存在时，相对路径和协议相对地址（//xxx）会基于它解析：
 *   new URL('/img/a.jpg', 'https://site.com/post/1') -> https://site.com/img/a.jpg
 *   new URL('//cdn.x.com/a.jpg', 'https://site.com')  -> https://cdn.x.com/a.jpg
 *
 * baseUrl 缺失时，只有绝对 URL 能通过，其余返回 null。
 * data:image 内联图无法作为 Notion external image，直接返回 null。
 */
export function normalizeUrl(url, baseUrl) {
  if (!url) {
    return null;
  }

  const value = String(url).trim();

  if (!value || value.startsWith('data:image')) {
    return null;
  }

  try {
    return new URL(value, baseUrl || undefined).toString();
  } catch (error) {
    return null;
  }
}

export function proxyImageUrl(url) {
  if (!IMAGE_PROXY_URL || !url) {
    return url;
  }

  try {
    return `${IMAGE_PROXY_URL}${encodeURIComponent(url)}`;
  } catch (error) {
    return url;
  }
}

export default function timeDifference(date1, date2) {
  const difference = Math.floor(date1) - Math.floor(date2);

  const diffInDays = Math.floor(difference / 60 / 60 / 24);
  const diffInHours = Math.floor(difference / 60 / 60);
  const diffInMinutes = Math.floor(difference / 60);
  const diffInSeconds = Math.floor(difference);

  return {
    date1,
    date2,
    diffInDays,
    diffInHours,
    diffInMinutes,
    diffInSeconds,
  };
}
