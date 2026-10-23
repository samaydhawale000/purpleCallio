/**
 * Localised, user-facing strings emitted by the translation relay
 * (`repeat.requested.prompt`, `limit.message`, the "uncertain" caption label).
 * Unknown languages fall back to English.
 */

const MAX_ORIGINAL_CHARS = 120;

/** "hi-IN" → "hi", "zh_Hant" → "zh". */
export function baseLanguage(language: string | null | undefined): string {
  return (language ?? '').trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

function pick<T>(table: Record<string, T>, language: string): T {
  return table[baseLanguage(language)] ?? table.en;
}

const REPEAT_PROMPTS: Record<string, string> = {
  en: 'They didn’t catch: “{original}” — please repeat.',
  hi: 'वे समझ नहीं पाए: “{original}” — कृपया दोबारा कहें।',
  mr: 'त्यांना समजले नाही: “{original}” — कृपया पुन्हा सांगा.',
  ta: 'அவர்களுக்குப் புரியவில்லை: “{original}” — தயவுசெய்து மீண்டும் சொல்லுங்கள்.',
  te: 'వారికి అర్థం కాలేదు: “{original}” — దయచేసి మళ్ళీ చెప్పండి.',
  bn: 'ওঁরা বুঝতে পারেননি: “{original}” — অনুগ্রহ করে আবার বলুন।',
  gu: 'તેઓ સમજી શક્યા નહીં: “{original}” — કૃપા કરીને ફરીથી કહો.',
  kn: 'ಅವರಿಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ: “{original}” — ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.',
  ml: 'അവർക്ക് മനസ്സിലായില്ല: “{original}” — ദയവായി വീണ്ടും പറയൂ.',
  pa: 'ਉਹ ਸਮਝ ਨਹੀਂ ਸਕੇ: “{original}” — ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕਹੋ।',
  or: 'ସେମାନେ ବୁଝିପାରିଲେ ନାହିଁ: “{original}” — ଦୟାକରି ପୁଣି କୁହନ୍ତୁ।',
  ur: 'وہ سمجھ نہیں سکے: “{original}” — براہ کرم دوبارہ کہیں۔',
  as: 'তেওঁলোকে বুজি নাপালে: “{original}” — অনুগ্ৰহ কৰি আকৌ কওক।',
  es: 'No lo entendieron: “{original}” — por favor, repítelo.',
  fr: 'Votre interlocuteur n’a pas compris : « {original} » — veuillez répéter.',
  de: 'Nicht verstanden: „{original}“ — bitte wiederholen.',
  pt: 'Não entenderam: “{original}” — por favor, repita.',
  ar: 'لم يفهموا: «{original}» — يُرجى التكرار.',
  ja: '相手が聞き取れませんでした：「{original}」— もう一度お話しください。',
  zh: '对方没有听清：“{original}”——请再说一遍。',
};

/** Collapses whitespace and cuts to ~120 characters (code points), on a word when possible. */
export function truncateOriginal(
  original: string,
  max = MAX_ORIGINAL_CHARS,
): string {
  const text = (original ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space >= max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,.;:!?।]+$/u, '')}…`;
}

export function repeatPrompt(language: string, original: string): string {
  const template = pick(REPEAT_PROMPTS, language);
  const text = truncateOriginal(original);
  return template.replace('{original}', () => text);
}

type LimitKind = 'warning' | 'stepped_down' | 'paused';

interface LimitStrings {
  /** About one minute left. */
  warningOne: string;
  /** About {n} minutes left. */
  warningMany: string;
  stepped_down: string;
  paused: string;
}

const LIMIT_MESSAGES: Record<string, LimitStrings> = {
  en: {
    warningOne: 'Translation ends in about 1 minute',
    warningMany: 'Translation ends in about {n} minutes',
    stepped_down: 'Translation switched to captions to stay within the limit',
    paused: 'Translation paused — limit reached. The call continues.',
  },
  hi: {
    warningOne: 'अनुवाद लगभग 1 मिनट में समाप्त होगा',
    warningMany: 'अनुवाद लगभग {n} मिनट में समाप्त होगा',
    stepped_down: 'सीमा के भीतर रहने के लिए अनुवाद को कैप्शन पर बदल दिया गया',
    paused: 'अनुवाद रोका गया — सीमा पूरी हो गई। कॉल जारी है।',
  },
  mr: {
    warningOne: 'भाषांतर सुमारे 1 मिनिटात संपेल',
    warningMany: 'भाषांतर सुमारे {n} मिनिटांत संपेल',
    stepped_down: 'मर्यादेत राहण्यासाठी भाषांतर कॅप्शनवर बदलले आहे',
    paused: 'भाषांतर थांबवले — मर्यादा पूर्ण झाली. कॉल सुरू आहे.',
  },
  ta: {
    warningOne: 'மொழிபெயர்ப்பு சுமார் 1 நிமிடத்தில் முடியும்',
    warningMany: 'மொழிபெயர்ப்பு சுமார் {n} நிமிடங்களில் முடியும்',
    stepped_down:
      'வரம்பிற்குள் இருக்க மொழிபெயர்ப்பு வசனங்களுக்கு (captions) மாற்றப்பட்டது',
    paused:
      'மொழிபெயர்ப்பு நிறுத்தப்பட்டது — வரம்பு எட்டப்பட்டது. அழைப்பு தொடர்கிறது.',
  },
  te: {
    warningOne: 'అనువాదం సుమారు 1 నిమిషంలో ముగుస్తుంది',
    warningMany: 'అనువాదం సుమారు {n} నిమిషాల్లో ముగుస్తుంది',
    stepped_down: 'పరిమితిలో ఉండేందుకు అనువాదం క్యాప్షన్‌లకు మార్చబడింది',
    paused: 'అనువాదం నిలిపివేయబడింది — పరిమితి చేరుకుంది. కాల్ కొనసాగుతుంది.',
  },
  bn: {
    warningOne: 'অনুবাদ প্রায় 1 মিনিটের মধ্যে শেষ হবে',
    warningMany: 'অনুবাদ প্রায় {n} মিনিটের মধ্যে শেষ হবে',
    stepped_down: 'সীমার মধ্যে থাকতে অনুবাদ ক্যাপশনে বদলানো হয়েছে',
    paused: 'অনুবাদ থামানো হয়েছে — সীমা পূর্ণ হয়েছে। কল চলছে।',
  },
};

/**
 * CostGuard message for the `limit` event. For `warning`, `remainingSeconds`
 * (when given) is rounded to whole minutes, at least one.
 */
export function limitMessage(
  language: string,
  kind: LimitKind,
  remainingSeconds?: number,
): string {
  const strings = pick(LIMIT_MESSAGES, language);
  if (kind === 'stepped_down') return strings.stepped_down;
  if (kind === 'paused') return strings.paused;
  const minutes =
    typeof remainingSeconds === 'number' && Number.isFinite(remainingSeconds)
      ? Math.max(1, Math.round(remainingSeconds / 60))
      : 1;
  return minutes === 1
    ? strings.warningOne
    : strings.warningMany.replace('{n}', String(minutes));
}

const UNCERTAIN_LABELS: Record<string, string> = {
  en: 'May not be accurate — check',
  hi: 'शायद सटीक न हो — जाँच लें',
  mr: 'कदाचित अचूक नसेल — तपासा',
  ta: 'துல்லியமாக இல்லாமல் இருக்கலாம் — சரிபார்க்கவும்',
  te: 'ఖచ్చితంగా ఉండకపోవచ్చు — సరిచూసుకోండి',
  bn: 'সঠিক না-ও হতে পারে — যাচাই করুন',
  gu: 'કદાચ સચોટ ન હોય — તપાસો',
  kn: 'ನಿಖರವಾಗಿರದಿರಬಹುದು — ಪರಿಶೀಲಿಸಿ',
  ml: 'കൃത്യമാകണമെന്നില്ല — പരിശോധിക്കുക',
  pa: 'ਸ਼ਾਇਦ ਸਹੀ ਨਾ ਹੋਵੇ — ਜਾਂਚ ਕਰੋ',
  ur: 'ممکن ہے درست نہ ہو — جانچ لیں',
  es: 'Puede no ser exacto — compruébalo',
  fr: 'Peut-être inexact — à vérifier',
  de: 'Möglicherweise ungenau — bitte prüfen',
  pt: 'Pode não estar correto — verifique',
};

export function uncertainLabel(language: string): string {
  return pick(UNCERTAIN_LABELS, language);
}
