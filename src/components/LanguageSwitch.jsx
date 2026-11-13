import { Languages } from 'lucide-react';
import { setLocale, useLocale } from '../i18n/index.js';

export function LanguageSwitch() {
  const locale = useLocale();
  return <button type="button" className="secondary-button language-switch"
    aria-label={locale === 'en' ? 'Switch to Chinese' : '切换到英语'}
    title={locale === 'en' ? 'Switch to Chinese' : '切换到英语'}
    onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}>
    <Languages size={16} aria-hidden="true" />
    <span lang={locale === 'en' ? 'zh-CN' : 'en'}>{locale === 'en' ? '中文' : 'English'}</span>
  </button>;
}
