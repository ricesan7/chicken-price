# Chicken Price (GitHub Pages + Actions)

- GitHub Actions で毎日スクレイプし、`docs/data/` に JSON/CSV を書き出します。
- GitHub Pages（`docs/`）で `index.html` を公開、ブラウザで確認できます。

## セットアップ手順
1. このリポジトリを GitHub に作成し、`main` ブランチへ push。
2. GitHub Pages 設定: **Settings → Pages → Build and deployment → Source: `Deploy from a branch` / Branch: `main` / Folder: `/docs`**
3. Actions 設定: このリポで **Actions を有効化**。`Scrape chicken prices` workflow が表示されます。
4. **Actions → `Scrape chicken prices` → Run workflow** を押して初回実行（もしくは `npm ci && npm run scrape` をローカルで実行して `docs/data` を埋めてから push）。
5. 公開URL: `https://<username>.github.io/<repo>/` 。`docs/data/` の JSON/CSV が読み込まれます。

## ローカルでの動作確認
```bash
npm ci
npm run scrape  # docs/data/ にファイル出力
# 任意のローカルサーバ（例: VSCodeのLive Server）で docs/ を開く
```

## 備考
- 取得先: https://www.shokucho.co.jp/original4.html
- 1日1回の取得（UTC 23:00 = JST 08:00）。
- 文字コードは UTF-8/SJIS を簡易判定で処理。
- 既存 `daily.json` を保持しつつ、新規分をマージします。
