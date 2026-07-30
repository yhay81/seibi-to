# Security

脆弱性は公開Issueへ詳細を書かず、GitHubのPrivate vulnerability reportingから報告して
ください。

- 車両内容を受け取るAPIやサーバー側schemaを作らない
- 利用者入力はDOM `textContent`だけで表示する
- 匿名イベントはsame-origin、許可リスト、1KB上限、45日保持に限定する
- 写真をブラウザ内でJPEGへ再圧縮し、EXIFを含む元ファイルは保存しない
- CSP、frame禁止、MIME sniffing防止、strict referrer policyを適用する
