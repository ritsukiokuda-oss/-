/**
 * 訪問フォロー自動化（Google Apps Script）
 *
 * 1. Googleドライブの「名刺_受信」フォルダに名刺の写真（またはPDF）を入れる
 * 2. 10分ごとに自動で読み取り → スプレッドシート「訪問ログ」に記録 → Googleチャットに通知
 * 3. Googleカレンダーの訪問予定が終わったら、お礼メールを Gmail の下書きに作成
 * 4. 毎日夕方、その日のハガキ宛先一覧を Googleチャットにまとめて通知
 *
 * 初回は CONFIG を書き換えてから setup() を1回実行してください（README.md 参照）。
 */

// ===================== ここを書き換えてください =====================
const CONFIG = {
  MY_COMPANY: '株式会社ジェイ・ポート', // 自社名
  MY_NAME: '奥田',                   // 自分の名前（メールの差出人名にも使います）
  SIGNATURE: [                       // メールの署名
    '○●----------------------------------------------------------------------●○',
    '株式会社ジェイ・ポート　次長　奥田',
    '〒538-0041　大阪市鶴見区今津北3-3-13',
    'TEL☎：06-6963-5351',
    'FAX：06-6963-5338',
    'E-Mail：okuda@j-port.co.jp',
    'URL:株式会社ジェイ・ポート 公式サイト（http://www.j-port.co.jp）',
    'Facebook:公式Facebookページ（http://www.facebook.com/jport.osaka）',
    'ジェイ・ポートお役立ちブログ:お役立ちブログはこちら（http://www.j-port.co.jp/blog/）',
    '○●----------------------------------------------------------------------●○',
  ].join('\n'),

  SUMMARY_HOUR: 18,                  // ハガキ宛先まとめを通知する時刻（時）
  CALENDAR_ID: 'primary',            // 使うカレンダー（通常はこのまま）
  // 予定名にこの言葉が入っているか、場所が入っている予定を「訪問」とみなします
  VISIT_KEYWORDS: ['訪問', '商談', '打合せ', '打ち合わせ', '面談', '挨拶', 'MTG', 'ミーティング'],

  INBOX_FOLDER_NAME: '名刺_受信',
  DONE_FOLDER_NAME: '名刺_処理済み',
  SHEET_NAME: '訪問ログ',
  MODEL: 'claude-opus-5-5',          // 名刺の読み取りに使うClaudeのモデル
  MAX_FILES_PER_RUN: 10,
};

// お礼メールのひな形。{{ }} の部分は自動で置き換わります。
const MAIL_SUBJECT = '{{本日}}のご面談のお礼（{{自社名}} {{自分の名前}}）';
// {{宛名}} は「会社名／部署・役職／氏名 様」の3行になります（空の行は自動で省きます）
const MAIL_BODY = `{{宛名}}

いつも大変お世話になっております。
{{自社名}}の{{自分の名前}}でございます。

{{本日}}はお忙しい中、ご対応下さり誠にありがとうございました。

宜しくお願い申し上げます。

{{署名}}`;
// ====================================================================

const HEADERS = ['登録日時', '訪問日', '会社名', '部署', '役職', '氏名', '郵便番号', '住所',
  'メール', '電話', '携帯', 'カレンダー予定', '予定終了', 'お礼メール', 'ハガキ', '名刺画像'];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

const STATUS = {
  WAITING: '予定終了後に作成',
  DONE: '下書き作成済',
  NO_EMAIL: 'メールなし',
};
const ERROR_PREFIX = '[読取エラー] ';
const TZ = () => Session.getScriptTimeZone();

class RetryLater extends Error {}

// ---------------------------------------------------------------- 初期設定

/** 初回に1回だけ実行：フォルダ・スプレッドシート・自動実行を作成します */
function setup() {
  const props = PropertiesService.getScriptProperties();

  const inbox = getOrCreateFolder_(props, 'INBOX_FOLDER_ID', CONFIG.INBOX_FOLDER_NAME);
  const done = getOrCreateFolder_(props, 'DONE_FOLDER_ID', CONFIG.DONE_FOLDER_NAME);

  let ssId = props.getProperty('SHEET_ID');
  if (!ssId) {
    const ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
    const sheet = ss.getSheets()[0];
    sheet.setName(CONFIG.SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#e8f0fe');
    // 郵便番号・電話番号の先頭の0が消えないよう、ハガキ列以外は文字列として扱う
    HEADERS.forEach((h, i) => {
      if (h !== 'ハガキ') sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    ssId = ss.getId();
    props.setProperty('SHEET_ID', ssId);
  }

  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runEvery10Minutes').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('sendDailySummary').timeBased().atHour(CONFIG.SUMMARY_HOUR).everyDays(1).create();

  const missing = ['CHAT_WEBHOOK_URL'].filter((k) => !props.getProperty(k));
  console.log([
    '設定が完了しました。',
    `名刺を入れるフォルダ: ${inbox.getUrl()}`,
    `処理済みフォルダ: ${done.getUrl()}`,
    `訪問ログ: ${SpreadsheetApp.openById(ssId).getUrl()}`,
    missing.length ? `※ スクリプトプロパティが未設定です: ${missing.join(', ')}` : '',
  ].join('\n'));
}

/** Googleチャットに届くか確認する用 */
function testNotify() {
  notifyChat_('✅ 訪問フォローの通知テストです。この投稿が見えていれば設定OKです。');
}

// ---------------------------------------------------------------- 定期実行

/** 10分ごとに自動実行：新しい名刺の取り込み ＋ 予定が終わった分のお礼メール下書き */
function runEvery10Minutes() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    processInbox_();
    createDueDrafts_();
  } finally {
    lock.releaseLock();
  }
}

function processInbox_() {
  const props = PropertiesService.getScriptProperties();
  const inbox = DriveApp.getFolderById(props.getProperty('INBOX_FOLDER_ID'));
  const done = DriveApp.getFolderById(props.getProperty('DONE_FOLDER_ID'));
  const files = inbox.getFiles();
  let count = 0;

  while (files.hasNext() && count < CONFIG.MAX_FILES_PER_RUN) {
    const file = files.next();
    if (file.getName().startsWith(ERROR_PREFIX)) continue;
    if (!isSupportedMime_(file.getMimeType())) continue;
    count++;
    try {
      handleCardFile_(file);
      file.moveTo(done);
    } catch (e) {
      if (e instanceof RetryLater) {
        console.log(`後で再試行: ${file.getName()} (${e.message})`);
        continue;
      }
      console.error(e);
      file.setName(ERROR_PREFIX + file.getName());
      notifyChat_(`⚠️ 名刺を読み取れませんでした\n${file.getUrl()}\n理由: ${e.message}\n` +
        '撮り直した写真を入れるか、訪問ログに手で入力してください。');
    }
  }
}

function handleCardFile_(file) {
  const cards = extractCards_(file).filter((c) => c.company || c.name);
  if (!cards.length) throw new Error('名刺が写っていないか、文字が読めませんでした');

  const takenAt = file.getDateCreated();
  const now = new Date();
  const sheet = getSheet_();

  cards.forEach((card) => {
    const event = findVisitEvent_(card.company, takenAt);
    const visitDate = event ? event.getStartTime() : takenAt;
    const eventEnd = event ? event.getEndTime() : null;

    let status;
    if (!card.email) status = STATUS.NO_EMAIL;
    else if (eventEnd && eventEnd > now) status = STATUS.WAITING;
    else {
      createThankYouDraft_(card, visitDate);
      status = STATUS.DONE;
    }

    sheet.appendRow([
      fmt_(now, 'yyyy/MM/dd HH:mm'),
      fmt_(visitDate, 'yyyy/MM/dd'),
      card.company, card.department, card.title, card.name,
      card.postal_code, card.address, card.email, card.phone, card.mobile,
      event ? event.getTitle() : '',
      eventEnd ? fmt_(eventEnd, 'yyyy/MM/dd HH:mm') : '',
      status,
      false,
      file.getUrl(),
    ]);
    sheet.getRange(sheet.getLastRow(), COL['ハガキ'] + 1).insertCheckboxes();

    notifyChat_(buildCardMessage_(card, event, status));
  });
}

/** 予定が終わった「予定終了後に作成」の行（とメールを後から入力した行）について、お礼メールの下書きを作る */
function createDueDrafts_() {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const st = r[COL['お礼メール']];
    // 「メールなし」でも、あとから訪問ログにメールアドレスを手入力すれば下書きを作る
    const filledLater = st === STATUS.NO_EMAIL && String(r[COL['メール']]).includes('@');
    if (st !== STATUS.WAITING && !filledLater) continue;
    const end = toDate_(r[COL['予定終了']]);
    if (end && end > now) continue;

    const card = rowToCard_(r);
    createThankYouDraft_(card, toDate_(r[COL['訪問日']]) || now);
    sheet.getRange(i + 1, COL['お礼メール'] + 1).setValue(STATUS.DONE);
    notifyChat_(`✉️ お礼メールの下書きを作成しました\n${card.company} ${card.name} 様（${card.email}）\n` +
      'Gmailの「下書き」から確認して送信してください。');
  }
}

/** 毎日夕方に自動実行：今日のハガキ宛先一覧と、名刺未登録の訪問を通知 */
function sendDailySummary() {
  const today = fmt_(new Date(), 'yyyy/MM/dd');
  const rows = getSheet_().getDataRange().getValues().slice(1)
    .filter((r) => toDateStr_(r[COL['訪問日']]) === today);

  const registered = new Set(rows.map((r) => r[COL['カレンダー予定']]).filter(Boolean));
  const unregistered = getVisitEvents_(new Date())
    .filter((e) => e.getEndTime() <= new Date() && !registered.has(e.getTitle()));

  if (!rows.length && !unregistered.length) return;

  const lines = [`📮 *本日のハガキ宛先（${rows.length}件）* ${today}`];
  rows.forEach((r, i) => {
    const dept = [r[COL['部署']], r[COL['役職']]].filter(Boolean).join(' ');
    const postal = r[COL['郵便番号']] ? `〒${r[COL['郵便番号']]} ` : '';
    lines.push('');
    lines.push(`${i + 1}. *${r[COL['会社名']]}*${dept ? '　' + dept : ''}`);
    lines.push(`　 ${r[COL['氏名']]} 様`);
    lines.push(`　 ${postal}${r[COL['住所']] || '（住所不明）'}`);
  });

  if (unregistered.length) {
    lines.push('', `⚠️ *名刺が未登録の訪問（${unregistered.length}件）*`);
    unregistered.forEach((e) => lines.push(`・${fmt_(e.getStartTime(), 'HH:mm')} ${e.getTitle()}`));
    lines.push('名刺の写真を「名刺_受信」フォルダに入れてください。');
  }

  const ssUrl = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl();
  lines.push('', `訪問ログ: ${ssUrl}`);
  notifyChat_(lines.join('\n'));
}

// ---------------------------------------------------------------- 名刺の読み取り

function isSupportedMime_(mime) {
  return mime.startsWith('image/') || mime === MimeType.PDF;
}

function extractCards_(file) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  return apiKey ? extractWithClaude_(file, apiKey) : [extractWithDriveOcr_(file)];
}

const CARD_FIELDS = ['company', 'department', 'title', 'name', 'postal_code', 'address', 'email', 'phone', 'mobile'];

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: CARD_FIELDS,
        properties: Object.fromEntries(CARD_FIELDS.map((f) => [f, { type: 'string' }])),
      },
    },
  },
};

const CARD_PROMPT = `この画像は名刺です（複数枚写っていることもあります）。名刺ごとに次の項目を抜き出してください。
- company: 会社名（「株式会社」なども含めた正式名称）
- department: 部署名
- title: 役職
- name: 氏名（姓と名の間に半角スペース）
- postal_code: 郵便番号（「123-4567」の形式）
- address: 住所（ビル名・階まで。郵便番号は含めない）
- email, phone, mobile: メールアドレス、電話番号、携帯番号
読み取れない項目は空文字にしてください。住所が複数ある場合は、本人の所属拠点の住所を選んでください。
名刺が写っていなければ cards を空の配列にしてください。`;

function extractWithClaude_(file, apiKey) {
  const media = toClaudeMedia_(file);
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CARD_SCHEMA } },
      fallbacks: 'default',
      messages: [{ role: 'user', content: [media, { type: 'text', text: CARD_PROMPT }] }],
    }),
  });

  const code = res.getResponseCode();
  if (code === 429 || code >= 500) throw new RetryLater(`Claude API ${code}`);
  const body = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error(`Claude API エラー ${code}: ${body.error && body.error.message}`);
  if (body.stop_reason === 'refusal') throw new Error('Claude が読み取りを断りました');
  if (body.stop_reason === 'max_tokens') throw new Error('読み取り結果が長すぎて途中で切れました');

  const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text).cards.map(cleanCard_);
}

/**
 * 読み取りに使うファイルを用意する。
 * そのまま使える形式・サイズならそのまま、大きい写真やHEIC（iPhoneの写真）は
 * ドライブが作るサムネイル（JPEG）に置き換える。
 */
function getReadableBlob_(file, maxBytes) {
  const mime = file.getMimeType();
  const size = file.getSize();
  if (mime === MimeType.PDF) return file.getBlob();
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) && size < maxBytes) return file.getBlob();
  const meta = Drive.Files.get(file.getId(), { fields: 'thumbnailLink' });
  if (!meta.thumbnailLink) throw new RetryLater('サムネイルがまだ作られていません');
  const thumb = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s2000'), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (thumb.getResponseCode() !== 200) throw new RetryLater(`サムネイル取得失敗 ${thumb.getResponseCode()}`);
  return thumb.getBlob().setContentType('image/jpeg').setName('card.jpg');
}

/** Claude に送れる形に変換 */
function toClaudeMedia_(file) {
  const blob = getReadableBlob_(file, 3.5 * 1024 * 1024);
  const type = blob.getContentType() === MimeType.PDF ? 'document' : 'image';
  return { type, source: { type: 'base64', media_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } };
}

/** APIキーなしの場合：ドライブの文字認識（OCR）＋ルールで読み取る */
function extractWithDriveOcr_(file) {
  const doc = Drive.Files.create(
    { name: 'tmp_ocr_' + file.getName(), mimeType: MimeType.GOOGLE_DOCS },
    getReadableBlob_(file, 1.8 * 1024 * 1024), // ドライブの文字認識は2MBまで
    { ocrLanguage: 'ja', fields: 'id' }
  );
  try {
    return parseCardText_(DocumentApp.openById(doc.id).getBody().getText());
  } finally {
    Drive.Files.remove(doc.id);
  }
}

function parseCardText_(raw) {
  const text = raw.normalize('NFKC');
  const lines = text.split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const COMPANY_RE = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|\(株\)|\(有\)|Co\.,|Inc\.|Ltd\.?|Corporation)/i;
  const TITLE_RE = /(代表取締役社長|代表取締役|専務取締役|常務取締役|取締役|代表|社長|会長|副社長|執行役員|本部長|事業部長|部長代理|部長|次長|室長|課長代理|課長|支店長|所長|店長|係長|主任|主査|マネージャー|マネジャー|リーダー|チーフ)/;
  const TITLE_G = new RegExp(TITLE_RE.source, 'g');
  const DEPT_TOKEN_RE = /(本部|事業部|部|課|室|グループ|チーム|支店|支社|営業所|事業所|センター|局|係)$/;
  const ADDR_RE = /(北海道|東京都|京都府|大阪府|.{2,3}県|\S{1,5}[市区郡]\S*?(町|村|丁目|番地|\d))/;
  const NOT_TEXT_RE = /@|https?:|www\.|TEL|FAX|Tel|Fax|電話|携帯|Mobile|E-?mail/i;
  const POSTAL_RE = /〒?\s*\d{3}-\d{4}/;

  const email = (text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [''])[0];
  const postalM = text.match(/〒\s*(\d{3})-?(\d{4})/) || text.match(/(?:^|\s)(\d{3})-(\d{4})(?:\s|$)/m);
  const mobileM = text.match(/0[789]0-?\d{4}-?\d{4}/);
  const phoneM = text.match(/(?:TEL|Tel|tel|電話|T)[\s.:：]*(0\d{1,4}-\d{1,4}-\d{3,4})/) ||
    text.match(/(0[1-6]\d{0,3}-\d{1,4}-\d{3,4})/);

  // 会社名
  const company = lines.find((l) => COMPANY_RE.test(l) && !NOT_TEXT_RE.test(l)) || '';

  // 住所（「大阪市〜」のように都道府県がない住所にも対応。次の行のビル名もつなげる）
  let address = '';
  const ai = lines.findIndex((l) => l !== company && !NOT_TEXT_RE.test(l) &&
    ADDR_RE.test(l.replace(POSTAL_RE, '').replace(/^住所[:：]?/, '')));
  if (ai >= 0) {
    address = lines[ai].replace(POSTAL_RE, '').replace(/^住所[:：]?/, '').trim();
    const next = lines[ai + 1] || '';
    if (/(ビル|タワー|ハイツ|マンション|\d+F|\d+階|号室|号館)/.test(next) && !NOT_TEXT_RE.test(next)) address += ' ' + next;
  }

  // 部署・役職・氏名（「営業部 部長 田中一郎」のように1行にまとまっていても分ける）
  const JP = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々]';
  const NAME_RE = new RegExp(`^${JP}{1,5}( ${JP}{1,5})?$`, 'u');
  const isDept = (t) => t.length >= 3 && DEPT_TOKEN_RE.test(t);
  let title = '';
  const depts = [];
  const nameCands = [];
  lines.forEach((l, idx) => {
    if (l === company || idx === ai || NOT_TEXT_RE.test(l) || /\d{2,}/.test(l)) return;
    const t = l.match(TITLE_RE);
    if (t && !title) title = t[0];
    const tokens = l.replace(TITLE_G, ' ').trim().split(' ').filter(Boolean);
    tokens.filter(isDept).forEach((d) => depts.push(d));
    const rest = tokens.filter((x) => !isDept(x)).join(' ');
    if (rest && NAME_RE.test(rest) && rest.replace(' ', '').length >= 2) {
      nameCands.push({ name: rest, score: (t ? 2 : 0) + (rest.includes(' ') ? 1 : 0) });
    }
  });
  nameCands.sort((a, b) => b.score - a.score);

  return cleanCard_({
    company,
    department: depts.join(' '),
    title,
    name: nameCands.length ? nameCands[0].name : '',
    postal_code: postalM ? `${postalM[1]}-${postalM[2]}` : '',
    address,
    email,
    phone: phoneM ? phoneM[1] : '',
    mobile: mobileM ? mobileM[0] : '',
  });
}

function cleanCard_(c) {
  const out = {};
  CARD_FIELDS.forEach((f) => { out[f] = String(c[f] || '').trim(); });
  return out;
}

// ---------------------------------------------------------------- カレンダー

function getVisitEvents_(day) {
  return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEventsForDay(day)
    .filter((e) => !e.isAllDayEvent())
    .filter((e) => e.getLocation() || CONFIG.VISIT_KEYWORDS.some((k) => e.getTitle().includes(k)));
}

/** 会社名が予定に入っている訪問予定を探す。なければ撮影時刻に近い訪問予定 */
function findVisitEvent_(company, at) {
  const events = getVisitEvents_(at);
  if (!events.length) return null;

  const key = normalizeCompany_(company);
  if (key) {
    const hit = events.find((e) =>
      normalizeCompany_([e.getTitle(), e.getLocation(), e.getDescription()].join(' ')).includes(key));
    if (hit) return hit;
  }

  const margin = 90 * 60 * 1000;
  const t = at.getTime();
  const near = events
    .filter((e) => e.getStartTime().getTime() - margin <= t && t <= e.getEndTime().getTime() + margin)
    .sort((a, b) => distance_(a, t) - distance_(b, t));
  return near[0] || null;
}

function distance_(e, t) {
  const s = e.getStartTime().getTime();
  const en = e.getEndTime().getTime();
  return t < s ? s - t : t > en ? t - en : 0;
}

function normalizeCompany_(s) {
  return String(s || '').normalize('NFKC')
    .replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|\(株\)|\(有\)|\s|　/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------- メール・通知

function createThankYouDraft_(card, visitDate) {
  const isToday = fmt_(visitDate, 'yyyyMMdd') === fmt_(new Date(), 'yyyyMMdd');
  const vars = {
    '宛名': [card.company, [card.department, card.title].filter(Boolean).join(' '), card.name ? card.name + ' 様' : '']
      .filter(Boolean).join('\n'),
    '会社名': card.company,
    '氏名': card.name,
    '自社名': CONFIG.MY_COMPANY,
    '自分の名前': CONFIG.MY_NAME,
    '署名': CONFIG.SIGNATURE,
    '本日': isToday ? '本日' : '先日',
  };
  const subject = fillTemplate_(MAIL_SUBJECT, vars);
  const body = fillTemplate_(MAIL_BODY, vars);
  GmailApp.createDraft(card.email, subject, body, { name: CONFIG.MY_NAME });
}

function fillTemplate_(tpl, vars) {
  return tpl.replace(/\{\{(.+?)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

function buildCardMessage_(card, event, status) {
  const dept = [card.department, card.title].filter(Boolean).join(' ');
  const lines = [
    '📇 *名刺を登録しました*',
    `*${card.company || '（会社名不明）'}*${dept ? '　' + dept : ''}`,
    `${card.name || '（氏名不明）'} 様`,
    `${card.postal_code ? '〒' + card.postal_code + ' ' : ''}${card.address || '（住所不明）'}`,
  ];
  if (card.email) lines.push(`✉ ${card.email}`);
  lines.push(event
    ? `📅 ${event.getTitle()}（${fmt_(event.getStartTime(), 'HH:mm')}〜${fmt_(event.getEndTime(), 'HH:mm')}）`
    : '📅 カレンダーの予定とは紐づきませんでした');
  const mail = {
    [STATUS.WAITING]: `お礼メール：予定終了（${event ? fmt_(event.getEndTime(), 'HH:mm') : ''}）後に下書きを作成します`,
    [STATUS.DONE]: 'お礼メール：Gmailに下書きを作成しました',
    [STATUS.NO_EMAIL]: 'お礼メール：メールアドレスが読み取れなかったため作成していません',
  }[status];
  lines.push(`📝 ${mail}`);
  return lines.join('\n');
}

function notifyChat_(text) {
  const url = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL');
  if (!url) {
    console.log('[CHAT_WEBHOOK_URL 未設定] ' + text);
    return;
  }
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) console.error(`Googleチャット通知失敗 ${res.getResponseCode()}: ${res.getContentText()}`);
}

// ---------------------------------------------------------------- 補助

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(id);
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

function getOrCreateFolder_(props, key, name) {
  const id = props.getProperty(key);
  if (id) return DriveApp.getFolderById(id);
  const it = DriveApp.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function rowToCard_(r) {
  return cleanCard_({
    company: r[COL['会社名']], department: r[COL['部署']], title: r[COL['役職']], name: r[COL['氏名']],
    postal_code: r[COL['郵便番号']], address: r[COL['住所']], email: r[COL['メール']],
    phone: r[COL['電話']], mobile: r[COL['携帯']],
  });
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, TZ(), pattern);
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const s = String(v);
  return Utilities.parseDate(s, TZ(), s.includes(':') ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd');
}

function toDateStr_(v) {
  return v instanceof Date ? fmt_(v, 'yyyy/MM/dd') : String(v || '');
}
