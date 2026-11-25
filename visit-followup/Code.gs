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
  EIGHT_FOLDER_NAME: 'エイト取込',   // エイトから書き出したCSVを入れるフォルダ
  EIGHT_RECENT_DAYS: 14,             // エイトのCSVで、名刺交換日がこの日数より古い名刺は通知しない
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
  const eight = getOrCreateFolder_(props, 'EIGHT_FOLDER_ID', CONFIG.EIGHT_FOLDER_NAME);

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
    `エイトのCSVを入れるフォルダ: ${eight.getUrl()}`,
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
    processEightCsv_();
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

  cards.forEach((card) => registerCard_(card, file.getDateCreated(), file.getUrl(), true));
}

/**
 * 名刺1枚分を訪問ログに登録し、お礼メールの下書き（または予約）とチャット通知を行う。
 * useTime=false のときは時刻での予定の推測をせず、会社名が一致する予定だけを紐づける。
 */
function registerCard_(card, takenAt, sourceUrl, useTime) {
  const now = new Date();
  const sheet = getSheet_();
  const event = findVisitEvent_(card.company, takenAt, useTime);
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
    sourceUrl,
  ]);
  sheet.getRange(sheet.getLastRow(), COL['ハガキ'] + 1).insertCheckboxes();

  notifyChat_(buildCardMessage_(card, event, status));
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

// ---------------------------------------------------------------- エイトのCSV取り込み

const EIGHT_DONE_PREFIX = '[取込済] ';
const EIGHT_SEEN_SHEET = 'エイト取込済み';

// エイトのCSVの見出し名の候補（上にあるものほど優先）
const EIGHT_COLUMNS = {
  company: ['会社名', '会社', '企業名', 'company'],
  department: ['部署名', '部署', '所属', 'department'],
  title: ['役職', '役職名', '肩書き', '肩書', 'title'],
  name: ['氏名', '名前', 'フルネーム', 'name'],
  last: ['姓', '氏名(姓)', '姓(漢字)', 'lastname'],
  first: ['名', '氏名(名)', '名(漢字)', 'firstname'],
  postal_code: ['郵便番号', '〒', 'zip', 'postalcode'],
  address: ['住所', '所在地', '住所1', 'address'],
  address2: ['住所2', '建物名', 'ビル名'],
  email: ['e-mail', 'eメール', 'email', 'メールアドレス', 'メール', 'mail'],
  phone: ['tel会社', 'tel部門', 'tel直通', 'tel', '電話番号', '電話', '会社電話'],
  mobile: ['携帯電話', '携帯', '携帯番号', 'mobile'],
  date: ['名刺交換日', '交換日', '名刺交換日時', '取り込み日', '登録日'],
};

/** 「エイト取込」フォルダに入ったCSVから、新しく増えた名刺だけを取り込む */
function processEightCsv_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('EIGHT_FOLDER_ID');
  if (!id) return;
  const folder = DriveApp.getFolderById(id);
  const done = DriveApp.getFolderById(props.getProperty('DONE_FOLDER_ID'));
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith(ERROR_PREFIX) || !isTableFile_(file)) continue;
    try {
      importEightFile_(file);
      file.setName(EIGHT_DONE_PREFIX + file.getName());
      file.moveTo(done);
    } catch (e) {
      if (e instanceof RetryLater) continue;
      console.error(e);
      file.setName(ERROR_PREFIX + file.getName());
      notifyChat_(`⚠️ エイトのCSVを取り込めませんでした\n${file.getUrl()}\n理由: ${e.message}`);
    }
  }
}

function isTableFile_(file) {
  const mime = file.getMimeType();
  return /\.csv$/i.test(file.getName()) || mime === 'text/csv' || mime === MimeType.GOOGLE_SHEETS;
}

function importEightFile_(file) {
  const props = PropertiesService.getScriptProperties();
  const table = readTable_(file).filter((r) => r.some((c) => String(c).trim()));
  if (table.length < 2) throw new Error('名刺のデータが入っていません');
  const cols = mapEightColumns_(table[0]);

  const seen = getSeenKeys_();
  const firstTime = !props.getProperty('EIGHT_INITIALIZED');
  const today = fmt_(new Date(), 'yyyy/MM/dd');
  const limit = new Date(Date.now() - CONFIG.EIGHT_RECENT_DAYS * 24 * 3600 * 1000);
  const log = getSheet_();
  const logRows = log.getDataRange().getValues();
  const newKeys = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  table.slice(1).forEach((row) => {
    const card = eightRowToCard_(row, cols);
    if (!card.company && !card.name) return;
    const key = cardKey_(card);
    if (seen.set.has(key)) return;
    seen.set.add(key);
    newKeys.push([key, fmt_(new Date(), 'yyyy/MM/dd HH:mm')]);

    const exchanged = cols.date.length ? parseLooseDate_(pickValue_(row, cols.date)) : null;
    // 初回は過去の名刺を大量に通知しないよう、今日交換した名刺だけを対象にする
    const isNew = firstTime
      ? !!exchanged && fmt_(exchanged, 'yyyy/MM/dd') === today
      : !exchanged || exchanged >= limit;
    if (!isNew) { skipped++; return; }

    // 写真でも登録済みの名刺なら、エイトの正確なデータで訪問ログを上書きする
    const idx = findLogRow_(logRows, card, limit);
    if (idx > 0) {
      if (updateLogRow_(log, idx, logRows[idx], card)) updated++;
      return;
    }
    registerCard_(card, exchanged || new Date(), file.getUrl(), false);
    added++;
  });

  if (newKeys.length) seen.sheet.getRange(seen.sheet.getLastRow() + 1, 1, newKeys.length, 2).setValues(newKeys);
  props.setProperty('EIGHT_INITIALIZED', '1');

  if (firstTime && skipped) {
    notifyChat_(`📥 エイトの名刺 ${skipped}件を「取り込み済み」として登録しました。\n次回からは、新しく増えた名刺だけを通知します。`);
  }
  if (updated) notifyChat_(`🔄 写真で登録済みの名刺 ${updated}件を、エイトのデータで更新しました。`);
  if (!firstTime && !added && !updated) notifyChat_('📥 エイトのCSVを確認しました。新しい名刺はありませんでした。');
}

function readTable_(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  const blob = file.getBlob();
  let text = blob.getDataAsString('UTF-8');
  if (text.includes('�')) text = blob.getDataAsString('Shift_JIS'); // 文字化けしたらShift_JISで読み直す
  return Utilities.parseCsv(text.replace(/^﻿/, ''));
}

function normHeader_(h) {
  return String(h).normalize('NFKC').toLowerCase().replace(/[\s()「」・_]/g, '');
}

/** 見出し行から、項目ごとに該当する列の番号（候補順）を求める */
function mapEightColumns_(header) {
  const norm = header.map(normHeader_);
  const cols = {};
  Object.entries(EIGHT_COLUMNS).forEach(([field, names]) => {
    cols[field] = [];
    names.map(normHeader_).forEach((n) => {
      norm.forEach((h, i) => { if (h === n && !cols[field].includes(i)) cols[field].push(i); });
    });
  });
  const hasName = cols.name.length || cols.last.length;
  if (!cols.company.length && !hasName) {
    throw new Error(`CSVの見出しが想定と違います（見出し: ${header.slice(0, 15).join(', ')}）`);
  }
  return cols;
}

function pickValue_(row, idxs) {
  for (const i of idxs) {
    const v = String(row[i] == null ? '' : row[i]).trim();
    if (v) return v;
  }
  return '';
}

function eightRowToCard_(row, cols) {
  const name = pickValue_(row, cols.name) ||
    [pickValue_(row, cols.last), pickValue_(row, cols.first)].filter(Boolean).join(' ');
  const address = [pickValue_(row, cols.address), pickValue_(row, cols.address2)].filter(Boolean).join(' ');
  const zip = pickValue_(row, cols.postal_code).normalize('NFKC').replace(/[〒\s-]/g, '');
  return cleanCard_({
    company: pickValue_(row, cols.company),
    department: pickValue_(row, cols.department),
    title: pickValue_(row, cols.title),
    name,
    postal_code: /^\d{7}$/.test(zip) ? `${zip.slice(0, 3)}-${zip.slice(3)}` : zip,
    address,
    email: pickValue_(row, cols.email),
    phone: pickValue_(row, cols.phone),
    mobile: pickValue_(row, cols.mobile),
  });
}

function cardKey_(c) {
  if (c.email) return c.email.toLowerCase();
  return normalizeCompany_(c.company) + '|' + c.name.replace(/\s|　/g, '');
}

function parseLooseDate_(v) {
  if (v instanceof Date) return v;
  const m = String(v || '').normalize('NFKC').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** 訪問ログ（直近）から同じ人の行を探す。メールアドレスか「会社名＋氏名」で照合 */
function findLogRow_(rows, card, since) {
  const email = card.email.toLowerCase();
  const nameKey = normalizeCompany_(card.company) + '|' + card.name.replace(/\s|　/g, '');
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i];
    const d = toDate_(r[COL['訪問日']]);
    if (d && d < since) continue;
    const rEmail = String(r[COL['メール']]).toLowerCase();
    const rKey = normalizeCompany_(r[COL['会社名']]) + '|' + String(r[COL['氏名']]).replace(/\s|　/g, '');
    if ((email && rEmail === email) || rKey === nameKey) return i;
  }
  return -1;
}

function updateLogRow_(sheet, idx, row, card) {
  const map = { company: '会社名', department: '部署', title: '役職', name: '氏名', postal_code: '郵便番号',
    address: '住所', email: 'メール', phone: '電話', mobile: '携帯' };
  let changed = false;
  Object.entries(map).forEach(([f, h]) => {
    if (card[f] && String(row[COL[h]]) !== card[f]) {
      sheet.getRange(idx + 1, COL[h] + 1).setValue(card[f]);
      changed = true;
    }
  });
  return changed;
}

function getSeenKeys_() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  let sh = ss.getSheetByName(EIGHT_SEEN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EIGHT_SEEN_SHEET);
    sh.appendRow(['キー', '取込日時']);
    sh.getRange('A:B').setNumberFormat('@');
    sh.hideSheet();
  }
  const n = sh.getLastRow() - 1;
  const keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map((r) => String(r[0])) : [];
  return { sheet: sh, set: new Set(keys) };
}

// ---------------------------------------------------------------- カレンダー

function getVisitEvents_(day) {
  return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEventsForDay(day)
    .filter((e) => !e.isAllDayEvent())
    .filter((e) => e.getLocation() || CONFIG.VISIT_KEYWORDS.some((k) => e.getTitle().includes(k)));
}

/** 会社名が予定に入っている訪問予定を探す。なければ撮影時刻に近い訪問予定 */
function findVisitEvent_(company, at, useTime = true) {
  const events = getVisitEvents_(at);
  if (!events.length) return null;

  const key = normalizeCompany_(company);
  if (key) {
    const hit = events.find((e) =>
      normalizeCompany_([e.getTitle(), e.getLocation(), e.getDescription()].join(' ')).includes(key));
    if (hit) return hit;
  }
  if (!useTime) return null;

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
    [STATUS.NO_EMAIL]: 'お礼メール：メールアドレスが読み取れませんでした（訪問ログの「メール」欄に入力すると下書きを作ります）',
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
