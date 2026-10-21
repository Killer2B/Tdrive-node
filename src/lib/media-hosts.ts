/**
 * مواقع الوسائط التي تُعالَج عبر yt-dlp.
 * أي رابط آخر يُعامَل تحميلًا مباشرًا. القائمة مصدر الحقيقة الوحيد (المسارات والطابور).
 */
export const MEDIA_HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'music.youtube.com',
  'vimeo.com',
  'dailymotion.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'twitter.com',
  'x.com',
  'twitch.tv',
  'soundcloud.com',
  'reddit.com',
  'bilibili.com',
  'ok.ru',
  'rutube.ru',
  'vk.com',
  'pinterest.com',
  'nicovideo.jp',
  'bitchute.com',
  'odysee.com',
  'rumble.com',
  'streamable.com',
];

/** هل المضيف من موقع وسائط مدعوم (يشمل النطاقات الفرعية)؟ */
export function isMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (!h) return false;
  return MEDIA_HOSTS.some((m) => h === m || h.endsWith('.' + m));
}
