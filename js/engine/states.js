/**
 * Reader states: how the person feels right now (not how the book should feel).
 * Each state maps to book preferences. When `ask` is true the UI lets the
 * reader choose between "lift" (change my mood) and "match" (keep me company),
 * because both are valid reading needs and guessing wrong feels dismissive.
 */
export const READER_STATES = {
  sad: {
    label: 'دلت گرفته',
    patterns: [/غمگینم/, /ناراحتم/, /دلم گرفته/, /دلگیرم/, /افسرده ?(ام|م)(?=\s|$)/, /حالم (بده|خوب نیست|گرفته ست|گرفتس)/, /دپرس ?(ام|م)(?=\s|$)/, /(^|\s)دپم(?=\s|$)/, /غم دارم/, /دلم پره/],
    ask: true,
    lift: { label: 'حالم رو عوض کن', prefs: [['mood', 'hopeful', 1], ['mood', 'cozy', 0.8], ['mood', 'funny', 0.6], ['darkness', 'not-dark', 0.8]] },
    match: { label: 'باهام هم‌حال باش', prefs: [['mood', 'melancholic', 1], ['mood', 'philosophical', 0.5], ['mood', 'hopeful', 0.4]] },
  },
  tired: {
    label: 'خسته‌ای',
    patterns: [/خسته ?(ام|م)(?=\s|$)/, /خستم/, /خسته شدم/, /بی حالم/, /انرژی ندارم/, /ذهنم (خسته|کشش ندار)/, /مغزم (کشش ندار|نمی ?کشه)/, /کم حوصله ?(ام|م)(?=\s|$)/],
    ask: false,
    lift: { label: 'یه چیز سبک و کوتاه', prefs: [['complexity', 'easy', 1], ['length', 'short', 0.7], ['mood', 'cozy', 0.6], ['pace', 'fast', 0.4]] },
  },
  anxious: {
    label: 'ذهنت شلوغه',
    patterns: [/استرس (دارم|زیاده)/, /مضطربم/, /اضطراب دارم/, /نگرانم/, /دلشوره دارم/, /ذهنم (شلوغه|آشوبه|درگیره)/, /پراسترس ?(ام|م)(?=\s|$)/],
    ask: true,
    lift: { label: 'آرومم کن', prefs: [['mood', 'cozy', 1], ['mood', 'hopeful', 0.8], ['mood', 'tense', -0.7], ['darkness', 'light', 0.8]] },
    match: { label: 'سرگرمم کن تا فکرم آزاد شه', prefs: [['mood', 'adventurous', 1], ['pace', 'fast', 0.8], ['mood', 'funny', 0.5], ['darkness', 'not-dark', 0.6]] },
  },
  bored: {
    label: 'حوصله‌ت سر رفته',
    patterns: [/حوصل(م|ه ?ام) سر رفته/, /بی حوصله ?(ام|م)(?=\s|$)/, /کسل ?(ام|م)(?=\s|$)/, /یکنواخت شده/],
    ask: false,
    lift: { label: 'یه چیز پرهیجان', prefs: [['mood', 'adventurous', 1], ['mood', 'wonder', 0.8], ['pace', 'fast', 0.8], ['mood', 'tense', 0.5]] },
  },
  lonely: {
    label: 'احساس تنهایی می‌کنی',
    patterns: [/تنها ?(ام|م)(?=\s|$)/, /احساس تنهایی/, /دلتنگم/, /کسی رو ندارم/],
    ask: true,
    lift: { label: 'یه همراه گرم', prefs: [['theme', 'friendship', 1], ['mood', 'cozy', 0.8], ['mood', 'funny', 0.5]] },
    match: { label: 'کتابی که تنهایی رو بفهمه', prefs: [['theme', 'isolation', 1], ['mood', 'melancholic', 0.7], ['mood', 'philosophical', 0.5]] },
  },
  angry: {
    label: 'کلافه‌ای',
    patterns: [/عصبانی ?(ام|م)(?=\s|$)/, /عصبی ?(ام|م)(?=\s|$)/, /کلافه ?(ام|م)(?=\s|$)/, /خشمگینم/, /اعصابم خورده/],
    ask: true,
    lift: { label: 'آرومم کن', prefs: [['mood', 'cozy', 1], ['mood', 'hopeful', 0.7], ['mood', 'philosophical', 0.4]] },
    match: { label: 'یه داستان بی‌رحم و پرخشم', prefs: [['mood', 'dark', 1], ['mood', 'tense', 0.8], ['theme', 'morally-grey', 0.6]] },
  },
  happy: {
    label: 'سرحالی',
    patterns: [/شادم/, /خوشحالم/, /سرحالم/, /حالم خوبه/, /پرانرژی ?(ام|م)(?=\s|$)/],
    ask: false,
    lift: { label: 'یه ماجرای شگفت‌انگیز', prefs: [['mood', 'wonder', 0.8], ['mood', 'adventurous', 0.8], ['mood', 'funny', 0.6]] },
  },
  curious: {
    label: 'کنجکاوی',
    patterns: [/کنجکاوم/, /دلم یه چیز (عجیب|متفاوت|جدید) می ?خواد/, /یه چیز متفاوت/],
    ask: false,
    lift: { label: 'یه چیز متفاوت و فکربرانگیز', prefs: [['mood', 'mysterious', 1], ['mood', 'wonder', 0.8], ['mood', 'philosophical', 0.6]] },
  },
};
