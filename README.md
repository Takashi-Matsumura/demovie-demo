# Demovie

画面録画に背景、ズーム、キャプションを足して、見せられるデモ動画に仕上げるブラウザアプリです。
動画はブラウザの中で処理します。自動キャプションを使うと、フレーム画像が設定した VLM サーバへ送られます。既定の接続先は同じ PC の `127.0.0.1` です。

> 開発中の MVP です。編集内容は保存されず、リロードすると消えます。

## 機能

- 画面録画、動画ファイルの読み込み、サンプル動画の生成
- 分割、削除、並べ替えによるカット編集
- 倍率、中心、長さを指定できるズーム
- 背景、余白、角丸、影の調整
- VLM による自動キャプションと、手動での追加、修正、削除、表示範囲の調整
- 1920×1080、30fps の動画書き出し（MP4。ブラウザが対応していなければ WebM）

## 必要なもの

- Node.js 20.9 以上
- デスクトップ版の Chrome または Edge
- 自動キャプションを使う場合は、画像入力に対応したモデルを動かす [llama.cpp](https://github.com/ggml-org/llama.cpp) の `llama-server`

## セットアップ

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。

画面録画は `localhost` か HTTPS で開いたときだけ使えます。

### 自動キャプション

画像入力に対応したモデルと、対応する mmproj ファイルで `llama-server` を起動します。既定の接続先は `http://127.0.0.1:8084` です。

```bash
llama-server -m <model>.gguf --mmproj <mmproj>.gguf --host 127.0.0.1 --port 8084
```

接続先を変える場合は、`.env.local` に次のように指定します。

```bash
NEXT_PUBLIC_VISION_URL=http://127.0.0.1:8084
```

外部のサーバを指定すると、動画のフレーム画像がそのサーバへ送信されます。ブラウザから直接呼び出すため、サーバ側で CORS の許可も必要です。

生成されるキャプションはモデルの推測を含みます。書き出す前に内容を確認してください。

## 開発

```bash
npm run typecheck
npm run lint
npm test
```

## 謝辞

Demovie の開発では、[OpenScreen](https://github.com/getopenscreen/openscreen) の機能やコンセプトを参考にしました。録画をデモ動画に仕上げるという体験を、オープンソースとして公開している OpenScreen の作者と貢献者のみなさんに感謝します。

Demovie は独立したプロジェクトです。OpenScreen のコードや素材は使用しておらず、OpenScreen プロジェクトとは関係がありません。OpenScreen の公式プロジェクトや派生版ではなく、同プロジェクトから承認を受けたものでもありません。Demovie に関するお問い合わせを OpenScreen プロジェクトへ送らないようお願いします。

## ライセンス

[MIT License](./LICENSE)
