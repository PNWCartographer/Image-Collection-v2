/** Supported UI languages. */
export type Lang = 'en' | 'zh-TW' | 'zh-CN'

/**
 * Inline translation helper.
 * Returns the string matching the current language.
 *
 * Usage: t(lang, 'Browse', '瀏覽', '浏览')
 */
export function t(lang: Lang, en: string, zhTW: string, zhCN: string): string {
  if (lang === 'en') return en
  if (lang === 'zh-TW') return zhTW
  return zhCN
}
