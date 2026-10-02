# GPLソース資料

このディレクトリには、APKの一般版Webソースと、同梱されたYaneuraOu/AobaNNUEエンジンおよびAndroid連携部分のソース資料があります。GPL-3.0本文は `../LICENSES/GPL-3.0.txt` にあります。

エンジンは `engine-src/` のビルド手順を参照してください。APKの評価データは `eval/nn.bin` です。再配布時はAPKと同じ配布先からこのソースを取得できる状態にしてください。

`app/web/` は一般版APKへ入れたWebアプリ一式です。一般版の正解・不正解音は `app/web/src/audio.js` 内でWeb Audioを使って合成し、外部音声素材は同梱していません。問題データの元ファイルと変換器は `problems/` および `tools/convert-problems.mjs` にあります。


