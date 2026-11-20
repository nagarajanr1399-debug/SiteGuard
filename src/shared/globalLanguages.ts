export interface GlobalLanguageOption {
  code: string;
  name: string;
  nativeName: string;
  region:
    | 'Core UAE'
    | 'South Asia'
    | 'Middle East & North Africa'
    | 'Southeast Asia'
    | 'East & West Africa'
    | 'East & Central Asia'
    | 'Europe & CIS'
    | 'Americas';
  bcp47: string;
  rtl?: boolean;
}

/**
 * 112+ Global Workforce Languages representing Abu Dhabi & Dubai
 * industrial, construction, maritime, and infrastructure teams.
 */
export const GLOBAL_WORKFORCE_LANGUAGES: GlobalLanguageOption[] = [
  // Core 10 UAE Quick-Switch Languages
  { code: 'en', name: 'English', nativeName: 'English', region: 'Core UAE', bcp47: 'en-US' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', region: 'Core UAE', bcp47: 'ar-AE', rtl: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', region: 'Core UAE', bcp47: 'hi-IN' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', region: 'Core UAE', bcp47: 'ur-PK', rtl: true },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', region: 'Core UAE', bcp47: 'bn-BD' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog', region: 'Core UAE', bcp47: 'fil-PH' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', region: 'Core UAE', bcp47: 'ta-IN' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', region: 'Core UAE', bcp47: 'ml-IN' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', region: 'Core UAE', bcp47: 'ne-NP' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', region: 'Core UAE', bcp47: 'si-LK' },

  // South Asia
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', region: 'South Asia', bcp47: 'te-IN' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', region: 'South Asia', bcp47: 'pa-IN' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', region: 'South Asia', bcp47: 'mr-IN' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', region: 'South Asia', bcp47: 'gu-IN' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', region: 'South Asia', bcp47: 'kn-IN' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', region: 'South Asia', bcp47: 'or-IN' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', region: 'South Asia', bcp47: 'as-IN' },
  { code: 'sd', name: 'Sindhi', nativeName: 'سنڌي', region: 'South Asia', bcp47: 'sd-PK', rtl: true },
  { code: 'bho', name: 'Bhojpuri', nativeName: 'भोजपुरी', region: 'South Asia', bcp47: 'hi-IN' },
  { code: 'mai', name: 'Maithili', nativeName: 'मैथिली', region: 'South Asia', bcp47: 'hi-IN' },
  { code: 'kok', name: 'Konkani', nativeName: 'कोंकणी', region: 'South Asia', bcp47: 'kok-IN' },
  { code: 'ks', name: 'Kashmiri', nativeName: 'کٲشُر', region: 'South Asia', bcp47: 'ks-IN', rtl: true },
  { code: 'skr', name: 'Saraiki', nativeName: 'سرائیکی', region: 'South Asia', bcp47: 'ur-PK', rtl: true },
  { code: 'bal', name: 'Balochi', nativeName: 'بلوچی', region: 'South Asia', bcp47: 'ur-PK', rtl: true },
  { code: 'dv', name: 'Dhivehi', nativeName: 'ދިވެހި', region: 'South Asia', bcp47: 'dv-MV', rtl: true },
  { code: 'dz', name: 'Dzongkha', nativeName: 'རྫོང་ཁ', region: 'South Asia', bcp47: 'dz-BT' },
  { code: 'tcy', name: 'Tulu', nativeName: 'ತುಳು', region: 'South Asia', bcp47: 'kn-IN' },
  { code: 'sat', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', region: 'South Asia', bcp47: 'hi-IN' },
  { code: 'mni', name: 'Manipuri', nativeName: 'মৈতৈলোন্', region: 'South Asia', bcp47: 'bn-IN' },

  // Middle East & North Africa
  { code: 'fa', name: 'Persian (Farsi)', nativeName: 'فارسی', region: 'Middle East & North Africa', bcp47: 'fa-IR', rtl: true },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', region: 'Middle East & North Africa', bcp47: 'ps-AF', rtl: true },
  { code: 'prs', name: 'Dari', nativeName: 'دری', region: 'Middle East & North Africa', bcp47: 'fa-AF', rtl: true },
  { code: 'ku', name: 'Kurdish (Kurmanji)', nativeName: 'Kurdî', region: 'Middle East & North Africa', bcp47: 'ku-TR' },
  { code: 'ckb', name: 'Kurdish (Sorani)', nativeName: 'کوردی', region: 'Middle East & North Africa', bcp47: 'ckb-IQ', rtl: true },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', region: 'Middle East & North Africa', bcp47: 'tr-TR' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', region: 'Middle East & North Africa', bcp47: 'he-IL', rtl: true },
  { code: 'ber', name: 'Tamazight', nativeName: 'ⵜⴰⵎⴰⵣⵉⵖⵜ', region: 'Middle East & North Africa', bcp47: 'zgh-MA' },

  // Southeast Asia
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', region: 'Southeast Asia', bcp47: 'id-ID' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', region: 'Southeast Asia', bcp47: 'ms-MY' },
  { code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa', region: 'Southeast Asia', bcp47: 'jv-ID' },
  { code: 'su', name: 'Sundanese', nativeName: 'Basa Sunda', region: 'Southeast Asia', bcp47: 'su-ID' },
  { code: 'ceb', name: 'Cebuano', nativeName: 'Binisaya', region: 'Southeast Asia', bcp47: 'ceb-PH' },
  { code: 'ilo', name: 'Ilocano', nativeName: 'Ilokano', region: 'Southeast Asia', bcp47: 'fil-PH' },
  { code: 'hil', name: 'Hiligaynon', nativeName: 'Ilonggo', region: 'Southeast Asia', bcp47: 'fil-PH' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', region: 'Southeast Asia', bcp47: 'vi-VN' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', region: 'Southeast Asia', bcp47: 'th-TH' },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာဘာသာ', region: 'Southeast Asia', bcp47: 'my-MM' },
  { code: 'km', name: 'Khmer', nativeName: 'ភាសាខ្មែរ', region: 'Southeast Asia', bcp47: 'km-KH' },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ', region: 'Southeast Asia', bcp47: 'lo-LA' },

  // East & Central Asia
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', region: 'East & Central Asia', bcp47: 'zh-CN' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', region: 'East & Central Asia', bcp47: 'zh-TW' },
  { code: 'yue', name: 'Cantonese', nativeName: '粵語', region: 'East & Central Asia', bcp47: 'zh-HK' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', region: 'East & Central Asia', bcp47: 'ko-KR' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', region: 'East & Central Asia', bcp47: 'ja-JP' },
  { code: 'mn', name: 'Mongolian', nativeName: 'Монгол', region: 'East & Central Asia', bcp47: 'mn-MN' },
  { code: 'bo', name: 'Tibetan', nativeName: 'བོད་སྐད', region: 'East & Central Asia', bcp47: 'bo-CN' },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbekcha', region: 'East & Central Asia', bcp47: 'uz-UZ' },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақша', region: 'East & Central Asia', bcp47: 'kk-KZ' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча', region: 'East & Central Asia', bcp47: 'ky-KG' },
  { code: 'tg', name: 'Tajik', nativeName: 'Тоҷикӣ', region: 'East & Central Asia', bcp47: 'tg-TJ' },
  { code: 'tk', name: 'Turkmen', nativeName: 'Türkmençe', region: 'East & Central Asia', bcp47: 'tk-TM' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycanca', region: 'East & Central Asia', bcp47: 'az-AZ' },

  // East & West Africa
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', region: 'East & West Africa', bcp47: 'sw-KE' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', region: 'East & West Africa', bcp47: 'am-ET' },
  { code: 'ti', name: 'Tigrinya', nativeName: 'ትግርኛ', region: 'East & West Africa', bcp47: 'ti-ET' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali', region: 'East & West Africa', bcp47: 'so-SO' },
  { code: 'om', name: 'Oromo', nativeName: 'Afaan Oromoo', region: 'East & West Africa', bcp47: 'om-ET' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa', region: 'East & West Africa', bcp47: 'ha-NG' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', region: 'East & West Africa', bcp47: 'yo-NG' },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo', region: 'East & West Africa', bcp47: 'ig-NG' },
  { code: 'rw', name: 'Kinyarwanda', nativeName: 'Ikinyarwanda', region: 'East & West Africa', bcp47: 'rw-RW' },
  { code: 'lg', name: 'Luganda', nativeName: 'Luganda', region: 'East & West Africa', bcp47: 'lg-UG' },
  { code: 'ny', name: 'Chichewa', nativeName: 'Chichewa', region: 'East & West Africa', bcp47: 'ny-MW' },
  { code: 'sn', name: 'Shona', nativeName: 'chiShona', region: 'East & West Africa', bcp47: 'sn-ZW' },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', region: 'East & West Africa', bcp47: 'zu-ZA' },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', region: 'East & West Africa', bcp47: 'xh-ZA' },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', region: 'East & West Africa', bcp47: 'af-ZA' },
  { code: 'mg', name: 'Malagasy', nativeName: 'Malagasy', region: 'East & West Africa', bcp47: 'mg-MG' },
  { code: 'wo', name: 'Wolof', nativeName: 'Wolof', region: 'East & West Africa', bcp47: 'wo-SN' },
  { code: 'ln', name: 'Lingala', nativeName: 'Lingála', region: 'East & West Africa', bcp47: 'ln-CD' },
  { code: 'ak', name: 'Akan (Twi)', nativeName: 'Twi', region: 'East & West Africa', bcp47: 'ak-GH' },

  // Europe & CIS
  { code: 'fr', name: 'French', nativeName: 'Français', region: 'Europe & CIS', bcp47: 'fr-FR' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', region: 'Europe & CIS', bcp47: 'es-ES' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', region: 'Europe & CIS', bcp47: 'pt-PT' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', region: 'Europe & CIS', bcp47: 'de-DE' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', region: 'Europe & CIS', bcp47: 'it-IT' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', region: 'Europe & CIS', bcp47: 'nl-NL' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', region: 'Europe & CIS', bcp47: 'pl-PL' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', region: 'Europe & CIS', bcp47: 'ro-RO' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', region: 'Europe & CIS', bcp47: 'uk-UA' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', region: 'Europe & CIS', bcp47: 'ru-RU' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', region: 'Europe & CIS', bcp47: 'el-GR' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', region: 'Europe & CIS', bcp47: 'cs-CZ' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', region: 'Europe & CIS', bcp47: 'sk-SK' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', region: 'Europe & CIS', bcp47: 'hu-HU' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', region: 'Europe & CIS', bcp47: 'bg-BG' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', region: 'Europe & CIS', bcp47: 'sr-RS' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', region: 'Europe & CIS', bcp47: 'hr-HR' },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', region: 'Europe & CIS', bcp47: 'bs-BA' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', region: 'Europe & CIS', bcp47: 'sq-AL' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', region: 'Europe & CIS', bcp47: 'sv-SE' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', region: 'Europe & CIS', bcp47: 'nb-NO' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', region: 'Europe & CIS', bcp47: 'da-DK' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', region: 'Europe & CIS', bcp47: 'fi-FI' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', region: 'Europe & CIS', bcp47: 'et-EE' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', region: 'Europe & CIS', bcp47: 'lv-LV' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', region: 'Europe & CIS', bcp47: 'lt-LT' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', region: 'Europe & CIS', bcp47: 'ka-GE' },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', region: 'Europe & CIS', bcp47: 'hy-AM' },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская', region: 'Europe & CIS', bcp47: 'be-BY' },
  { code: 'mt', name: 'Maltese', nativeName: 'Malti', region: 'Europe & CIS', bcp47: 'mt-MT' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', region: 'Europe & CIS', bcp47: 'sl-SI' },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', region: 'Europe & CIS', bcp47: 'mk-MK' },

  // Americas
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl Ayisyen', region: 'Americas', bcp47: 'ht-HT' },
  { code: 'qu', name: 'Quechua', nativeName: 'Runasimi', region: 'Americas', bcp47: 'qu-PE' },
];

export function getGlobalLanguageByCode(code: string): GlobalLanguageOption | undefined {
  return GLOBAL_WORKFORCE_LANGUAGES.find((l) => l.code === code);
}
