# 整備灯

愛車の整備日、走行距離、費用、次回期限、写真を端末内だけで管理する日本語Web
サービスです。

- 車両番号、VIN、位置情報、アカウントは不要
- 整備履歴と次回の年月・距離を同じ計器盤で確認
- 写真は端末内でJPEGへ再圧縮し、IndexedDBだけに保存
- CSV、印刷/PDF、写真込み`.seibito`バックアップ
- 内容を送らない匿名操作計測だけを45日で削除

## Development

```powershell
npm install --cache .npm-cache
npm run check
npm test
npm run build
```

Runtime: Cloudflare Workers / D1, Hono / Hono JSX, Vite+, TypeScript.
