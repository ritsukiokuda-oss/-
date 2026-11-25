# リール自動制作ボット（reelbot）

猫や犬が「人間そっくりのリアルな動き」をするInstagramリールを、4つの担当に分けて自動で作るプログラムです。

| 担当 | 担い手 | やること |
| --- | --- | --- |
| ネタ担当 | Claude | あるある×動物のネタを考え、動画AI用の英語プロンプト・テロップ・キャプション・ハッシュタグまで作る。分析担当の学びを毎回反映する |
| 制作担当 | 動画生成AI（Kling / Veo / Runway）＋ ffmpeg | 動画を生成し、1080×1920・テロップ入り・音声付きのリール形式に仕上げる |
| チェック担当 | Claude（画像認識）＋ 自動検査 | 長さ・解像度・音声を検査し、フレームを見てAIの破綻（足が増える、顔の崩れなど）・リアルさ・つかみ・規約リスクを採点する。不合格なら改良したプロンプトで作り直す |
| 分析担当 | Instagram Graph API ＋ Claude | 再生数・リーチ・保存・シェア・平均視聴時間を集めてレポートを作る。学びは `data/learnings.md` に保存され、次回のネタ出しに自動で使われる |

投稿前の**最終承認だけは人が行います**（`approve`）。

```
ネタ担当 ──▶ 制作担当 ──▶ チェック担当 ──(不合格: 作り直し)──┐
   ▲                          │ 合格                          │
   │                          ▼                               │
   │                    人が最終承認 ──▶ 投稿                  │
   └──── 学び ◀── 分析担当 ◀── 再生数などを取得 ◀──────────────┘
```

## 動画生成AIの比較（2026年11月時点の目安）

| サービス | 1秒あたり | 1本あたり | 毎日1本・作り直し込みの月額 | 強み | 弱み |
| --- | --- | --- | --- | --- | --- |
| **Kling**（std 720p） | 約$0.084 | 10秒で約$0.84 | 約$38（約5,900円） | 動物の体の動き・毛並みがリアル。この手の「人間っぽい動物」動画で最も使われている。画像から動画にもできる | 公式APIの事前購入パックは高額（少額で試すなら代理サービス経由が手軽）。音声なし（音は後から付ける） |
| Kling（pro 1080p） | 約$0.112 | 10秒で約$1.12 | 約$50 | 上記に加えて高画質 | 生成に時間がかかる |
| **Google Veo 3.1 Fast** | 約$0.10（1080pは$0.12） | 8秒で約$0.80 | 約$36 | **効果音・鳴き声などの音声付き**で生成される。指示通りに作る力が強い | 最長8秒。人間っぽい動きの大げささはKlingに劣ることがある。Standard版は$0.40/秒と高い |
| **Runway Gen-4.5** | 約$0.12 | 10秒で約$1.20 | 約$54 | APIと管理画面が使いやすい。カメラワークの指定が得意 | 3社の中で割高。動物の自然さはKlingが上のことが多い |
| Claude（ネタ・チェック・分析） | — | 1本あたり数円〜十数円 | 月数ドル程度 | | |

※ 価格は第三者サイトの集計で、頻繁に変わります。契約前に各社の公式ページで確認してください。為替は1ドル=155円で計算。
※ 「作り直し込み」は、チェック不合格で平均1.5回生成すると仮定した金額です。

**おすすめ**: 最初は **Kling（std）** で始め、音声付きでの差を比べたくなったら `VIDEO_PROVIDER=veo` に切り替えて同じネタで比較するのが良いと思います。設定を1行変えるだけで切り替えられます。

## 準備

1. Python 3.10以上と ffmpeg をインストール
2. 依存パッケージを入れる
   ```bash
   cd reels
   pip install -r requirements.txt
   cp .env.example .env   # ここにAPIキーを書く
   ```
3. 必要なキー
   - `ANTHROPIC_API_KEY`: Claude（ネタ・チェック・分析）
   - 使う動画生成AIのキー（Kling なら AccessKey と SecretKey）
   - Instagram: プロアカウント（ビジネス／クリエイター）＋ Meta for Developers でアプリを作り、`instagram_basic`・`instagram_content_publish`・`instagram_manage_insights` の権限を持つ長期アクセストークンを取得して `IG_USER_ID` と `IG_ACCESS_TOKEN` に設定

### キー無しで流れだけ試す

```bash
REELBOT_FAKE_LLM=1 VIDEO_PROVIDER=mock python -m reelbot run -n 2
```
テスト映像とサンプルのネタで、ネタ出し→制作→チェックまでの流れを確認できます。

## 使い方

```bash
python -m reelbot ideas -n 5          # ネタ担当: ネタを5個出す
python -m reelbot produce -n 1        # 制作担当+チェック担当: 1本作って検品（不合格なら自動で作り直し）
python -m reelbot run -n 1            # 上の2つをまとめて実行
python -m reelbot status              # 制作台帳（状態・点数・再生数・コスト）を見る

# data/videos/ の動画を人が見て判断
python -m reelbot approve <ID>        # 最終承認
python -m reelbot reject <ID>         # 不採用

# 投稿（どちらか）
python -m reelbot publish <ID> --video-url https://…/video.mp4   # APIで投稿（動画は公開URLに置く必要あり）
python -m reelbot mark-published <ID> <メディアID>                # アプリで手動投稿した場合

python -m reelbot analyze             # 分析担当: 数字を集めてレポート作成（data/reports/）
python -m reelbot cost                # 今の設定でのコストの目安
```

毎日自動で回す場合は、cron などで `run` と `analyze` を定期実行してください（承認と投稿は人が行う想定です）。

## 注意点

- **AIで作ったことの表示**: Instagramはリアルな見た目のAI生成動画に「AI情報」ラベルを求めています。投稿時にラベルをオンにしてください。
- **他人の動画はコピーしない**: 参考動画は「型」を学ぶためだけに使い、映像やキャプションは丸写ししないでください。ネタ担当にも禁止ルールを入れています。
- **APIで投稿する場合**: Instagram APIは動画ファイルを直接アップロードできず、公開URL（AWS S3、Cloudflare R2 など）から取り込みます。
- **モデル名の確認**: `KLING_MODEL`・`VEO_MODEL`・`RUNWAY_MODEL` の既定値は執筆時点のものです。各社のAPIドキュメントで最新のモデル名を確認して `.env` に設定してください。

## ファイル構成

```
reelbot/
  ideas.py      ネタ担当
  producer.py   制作担当
  providers/    動画生成AIの切り替え（mock / kling / veo / runway）
  media.py      ffmpeg（整形・テロップ・フレーム抽出）
  checker.py    チェック担当
  analyst.py    分析担当
  instagram.py  Instagram Graph API（投稿・インサイト）
  store.py      全担当が共有する制作台帳 data/board.json
  cli.py        コマンド
data/           生成物（git管理外）: board.json, videos/, reports/, learnings.md
```
