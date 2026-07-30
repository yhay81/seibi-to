# Metrics

- `visited`: 公開画面を開いた
- `vehicle_created`: 車を登録した
- `record_added`: 整備記録を追加した
- `reminder_added`: 次回期限を追加した
- `printed`: 印刷/PDFを開いた
- `project_exported`: CSVまたは`.seibito`を書き出した
- `project_imported`: `.seibito`を読み込んだ
- `returned`: 別の日に再訪した

匿名ブラウザID、JST日付、QAフラグ以外をイベントへ含めません。`x-seibi-qa: 1`は実利用
集計から除外し、イベントは45日後に削除します。
