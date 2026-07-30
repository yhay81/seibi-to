import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { requestId } from "hono/request-id";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
};

type Variables = { requestId: string };
type AppContext = Parameters<Parameters<typeof app.use>[1]>[0];

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://seibi-to.yhay81.com";
const eventLifetime = 45 * 86400;
const eventNames = new Set([
  "visited",
  "vehicle_created",
  "record_added",
  "reminder_added",
  "printed",
  "project_exported",
  "project_imported",
  "returned",
]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const jstDay = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const securityHeaders = async (c: AppContext, next: () => Promise<void>) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'",
  );
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
};

const Layout = ({
  canonical,
  children,
  description,
  script,
  title,
}: {
  canonical: string;
  children: Child;
  description: string;
  script?: string;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width, initial-scale=1" name="viewport" />
      <meta content="#17221e" name="theme-color" />
      <meta content={description} name="description" />
      <meta content={description} property="og:description" />
      <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
      <meta content="整備灯の車庫計器盤と整備履歴カード" property="og:image:alt" />
      <meta content="ja_JP" property="og:locale" />
      <meta content={title} property="og:title" />
      <meta content="website" property="og:type" />
      <meta content={canonical} property="og:url" />
      <meta content="summary_large_image" name="twitter:card" />
      <link href={canonical} rel="canonical" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      {script ? <script src={script} type="module"></script> : null}
      <title>{title}</title>
    </head>
    <body>
      <a class="skip-link" href="#main">
        本文へ移動
      </a>
      <header class="site-header">
        <a class="brand" href="/" aria-label="整備灯 ホーム">
          <span class="brand-lamp" aria-hidden="true">
            <i></i>
          </span>
          <span>整備灯</span>
        </a>
        <nav aria-label="メイン">
          <a href="/guide">使い方</a>
          <a href="/privacy">保存先</a>
        </nav>
      </header>
      {children}
      <footer>
        <span>整備灯</span>
        <span>車庫の中だけで続く整備記録</span>
      </footer>
    </body>
  </html>
);

const VehicleForm = () => (
  <form class="vehicle-form" data-vehicle-form>
    <label>
      車の呼び名
      <input maxlength={32} name="name" placeholder="青いワゴン" required />
    </label>
    <div class="field-pair">
      <label>
        メーカー
        <input maxlength={32} name="make" placeholder="例：トヨタ" />
      </label>
      <label>
        車種
        <input maxlength={48} name="model" placeholder="例：カローラ" />
      </label>
    </div>
    <div class="field-pair">
      <label>
        年式
        <input max="2100" min="1950" name="year" placeholder="2021" type="number" />
      </label>
      <label>
        現在の走行距離
        <span class="unit-input">
          <input max="9999999" min="0" name="odometer" placeholder="32500" type="number" />
          <b>km</b>
        </span>
      </label>
    </div>
    <p class="privacy-note">
      ナンバー・VIN・位置・連絡先は入力しません。この車庫はこの端末にだけ作られます。
    </p>
    <button class="primary-button" type="submit">
      <span class="button-lamp" aria-hidden="true"></span>
      車庫へ入れる
    </button>
    <p class="form-state" data-vehicle-state></p>
  </form>
);

const GaragePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/`}
    description="愛車の整備日、走行距離、費用、次回期限、写真を端末内だけで管理する車庫の計器盤。"
    script="/app.js"
    title="整備灯｜愛車の整備履歴と次回期限を端末内で"
  >
    <main class="garage" data-page="garage" id="main">
      <section class="garage-door" data-empty-garage>
        <div class="garage-visual" aria-label="車庫の中の車と整備灯">
          <div class="ceiling-lamp">
            <i></i>
          </div>
          <div class="tool-wall">
            <span class="wrench"></span>
            <span class="socket"></span>
            <span class="rag"></span>
          </div>
          <div class="car-shape">
            <span class="car-window"></span>
            <i class="wheel left"></i>
            <i class="wheel right"></i>
          </div>
          <div class="floor-line"></div>
        </div>
        <div class="first-vehicle">
          <p class="eyebrow">OPEN YOUR GARAGE</p>
          <h1>最初の一台を登録</h1>
          <p>整備のたびに日付と距離を残すと、次に気をつける時期が車庫の計器盤へ並びます。</p>
          <VehicleForm />
        </div>
      </section>

      <section class="garage-workspace" data-garage-workspace hidden>
        <div class="vehicle-rail">
          <div class="vehicle-tabs" data-vehicle-tabs aria-label="登録車両"></div>
          <button class="rail-add" data-action="add-vehicle" type="button">
            ＋ 車を追加
          </button>
        </div>

        <section class="instrument-panel" aria-label="車の状態">
          <div class="vehicle-identity">
            <div class="mini-car" aria-hidden="true">
              <span></span>
              <i></i>
              <b></b>
            </div>
            <div>
              <p class="eyebrow">IN THE GARAGE</p>
              <h1 data-vehicle-name></h1>
              <p data-vehicle-spec></p>
            </div>
          </div>
          <div class="odometer">
            <span>ODOMETER</span>
            <strong data-current-odometer>0</strong>
            <small>km</small>
          </div>
          <div class="dial-card">
            <span>12か月の整備費</span>
            <strong data-year-cost>¥0</strong>
            <div class="cost-dial" data-cost-dial aria-hidden="true"></div>
          </div>
          <div class="warning-card" data-next-warning>
            <span class="warning-light"></span>
            <div>
              <small>NEXT CHECK</small>
              <strong data-next-title>予定なし</strong>
              <p data-next-distance>次回期限を登録できます</p>
            </div>
          </div>
        </section>

        <div class="garage-actions">
          <button class="primary-button" data-action="add-record" type="button">
            <span class="button-lamp" aria-hidden="true"></span>
            整備を記録
          </button>
          <button data-action="add-reminder" type="button">
            次回期限を追加
          </button>
          <button data-action="print" type="button">
            引渡し用に印刷 / PDF
          </button>
          <details class="carry-menu">
            <summary>持ち出す・戻す</summary>
            <div>
              <button data-action="export-project" type="button">
                写真込み .seibito
              </button>
              <button data-action="export-csv" type="button">
                表計算用 CSV
              </button>
              <label class="file-button">
                .seibitoを読み込む
                <input accept=".seibito,application/json" data-import-file type="file" />
              </label>
            </div>
          </details>
          <button class="danger-button" data-action="delete-vehicle" type="button">
            この車を削除
          </button>
        </div>

        <div class="garage-grid">
          <section class="service-lane">
            <div class="section-heading">
              <div>
                <p class="eyebrow">NEXT SERVICE</p>
                <h2>次に見るところ</h2>
              </div>
              <span data-reminder-count>0件</span>
            </div>
            <div class="reminder-list" data-reminder-list></div>
            <div class="lane-empty" data-reminder-empty>
              <span class="empty-lamp"></span>
              <p>日付または走行距離で、次回の目安を置けます。</p>
            </div>
          </section>

          <section class="history-bay">
            <div class="section-heading">
              <div>
                <p class="eyebrow">SERVICE HISTORY</p>
                <h2>整備の年表</h2>
              </div>
              <span data-record-count>0件</span>
            </div>
            <div class="history-filter">
              <label>
                <span>絞り込み</span>
                <select data-history-kind>
                  <option value="all">すべて</option>
                  <option value="engine">エンジン・油脂</option>
                  <option value="tire">タイヤ・足まわり</option>
                  <option value="inspection">点検・車検</option>
                  <option value="repair">修理</option>
                  <option value="part">部品・用品</option>
                  <option value="care">洗車・ケア</option>
                  <option value="other">その他</option>
                </select>
              </label>
              <label>
                <span>検索</span>
                <input data-history-search placeholder="項目・店・メモ" type="search" />
              </label>
            </div>
            <div class="timeline" data-timeline></div>
            <div class="history-empty" data-history-empty>
              <div class="lift" aria-hidden="true">
                <span></span>
                <i></i>
              </div>
              <p>最初の整備を記録すると、ここに距離順の年表ができます。</p>
            </div>
          </section>
        </div>

        <section class="local-flow" aria-label="データの保存先">
          <div>
            <span class="flow-car">▰</span>
            <strong>車・履歴・写真</strong>
          </div>
          <span class="flow-arrow">→</span>
          <div class="browser-box">
            <span>この端末</span>
            <strong>IndexedDB</strong>
          </div>
          <span class="flow-stop">×</span>
          <div>
            <span class="flow-cloud">☁</span>
            <strong>内容の送信なし</strong>
          </div>
        </section>

        <button class="empty-garage-button" data-action="clear-garage" type="button">
          車庫を空にする
        </button>
      </section>

      <dialog class="garage-dialog" data-vehicle-dialog>
        <form method="dialog">
          <button aria-label="閉じる" class="dialog-close" value="cancel">
            ×
          </button>
        </form>
        <p class="eyebrow">ADD A VEHICLE</p>
        <h2>車を追加</h2>
        <VehicleForm />
      </dialog>

      <dialog class="garage-dialog record-dialog" data-record-dialog>
        <form class="record-form" data-record-form>
          <button aria-label="閉じる" class="dialog-close" data-action="close-record" type="button">
            ×
          </button>
          <p class="eyebrow">SERVICE CARD</p>
          <h2>整備カードを残す</h2>
          <div class="field-pair">
            <label>
              整備日
              <input name="performedOn" required type="date" />
            </label>
            <label>
              走行距離
              <span class="unit-input">
                <input max="9999999" min="0" name="odometer" required type="number" />
                <b>km</b>
              </span>
            </label>
          </div>
          <label>
            種類
            <select name="kind" required>
              <option value="engine">エンジン・油脂</option>
              <option value="tire">タイヤ・足まわり</option>
              <option value="inspection">点検・車検</option>
              <option value="repair">修理</option>
              <option value="part">部品・用品</option>
              <option value="care">洗車・ケア</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label>
            項目
            <input maxlength={60} name="title" placeholder="エンジンオイル交換" required />
          </label>
          <div class="field-pair">
            <label>
              費用
              <span class="unit-input">
                <b>¥</b>
                <input max="99999999" min="0" name="cost" placeholder="4800" type="number" />
              </span>
            </label>
            <label>
              作業先
              <input maxlength={48} name="provider" placeholder="自分 / 整備工場名" />
            </label>
          </div>
          <label>
            メモ
            <textarea
              maxlength={500}
              name="note"
              placeholder="使用部品、次に確認すること"
            ></textarea>
          </label>
          <label class="photo-drop">
            <input
              accept="image/jpeg,image/png,image/webp"
              data-photo-input
              name="photo"
              type="file"
            />
            <span class="photo-icon">▧</span>
            <strong data-photo-label>写真を1枚添える</strong>
            <small>端末内でJPEG・220KB以下へ縮小</small>
          </label>
          <input name="fromReminder" type="hidden" />
          <button class="primary-button" type="submit">
            年表へ置く
          </button>
          <p class="form-state" data-record-state></p>
        </form>
      </dialog>

      <dialog class="garage-dialog" data-reminder-dialog>
        <form class="reminder-form" data-reminder-form>
          <button
            aria-label="閉じる"
            class="dialog-close"
            data-action="close-reminder"
            type="button"
          >
            ×
          </button>
          <p class="eyebrow">NEXT CHECK</p>
          <h2>次回の目安を置く</h2>
          <label>
            確認する項目
            <input maxlength={60} name="title" placeholder="エンジンオイル" required />
          </label>
          <div class="field-pair">
            <label>
              日付の目安
              <input name="dueOn" type="date" />
            </label>
            <label>
              距離の目安
              <span class="unit-input">
                <input max="9999999" min="0" name="dueOdometer" placeholder="40000" type="number" />
                <b>km</b>
              </span>
            </label>
          </div>
          <p class="privacy-note">
            少なくとも片方を入力してください。車種固有の整備時期は取扱説明書や整備工場で確認してください。
          </p>
          <button class="primary-button" type="submit">
            計器盤へ置く
          </button>
          <p class="form-state" data-reminder-state></p>
        </form>
      </dialog>

      <template id="vehicle-tab-template">
        <button class="vehicle-tab" type="button">
          <span class="tab-car" aria-hidden="true"></span>
          <span data-tab-name></span>
        </button>
      </template>

      <template id="reminder-template">
        <article class="reminder-card">
          <span class="status-lamp"></span>
          <div>
            <small data-reminder-status></small>
            <h3 data-reminder-title></h3>
            <p data-reminder-due></p>
          </div>
          <div class="card-actions">
            <button data-reminder-action="record" type="button">
              整備を記録
            </button>
            <button data-reminder-action="delete" type="button">
              削除
            </button>
          </div>
        </article>
      </template>

      <template id="record-template">
        <article class="history-card">
          <div class="timeline-pin">
            <span></span>
          </div>
          <div class="record-main">
            <div class="record-meta">
              <span data-record-kind></span>
              <time data-record-date></time>
            </div>
            <h3 data-record-title></h3>
            <div class="record-numbers">
              <strong data-record-odometer></strong>
              <span data-record-cost></span>
            </div>
            <p data-record-provider></p>
            <p data-record-note></p>
          </div>
          <figure data-record-photo-wrap hidden>
            <img alt="" data-record-photo />
          </figure>
          <button class="card-delete" data-record-action="delete" type="button">
            削除
          </button>
        </article>
      </template>
    </main>
  </Layout>
);

const GuidePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/guide`}
    description="整備灯で愛車の整備履歴と次回期限を端末内に残す4つの手順。"
    title="使い方｜整備灯"
  >
    <main class="info-page" id="main">
      <div class="info-heading">
        <div class="guide-gauge" aria-hidden="true">
          <i></i>
          <span></span>
        </div>
        <div>
          <p class="eyebrow">FOUR CHECKS</p>
          <h1>車庫の計器盤を育てる</h1>
        </div>
      </div>
      <ol class="guide-steps">
        <li>
          <span class="step-visual car-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>1</strong>
            <h2>車の呼び名を置く</h2>
            <p>ナンバーやVINは不要です。最大3台を端末内で切り替えます。</p>
          </div>
        </li>
        <li>
          <span class="step-visual service-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>2</strong>
            <h2>整備カードを残す</h2>
            <p>日付、距離、項目、費用と任意の写真を一枚のカードにします。</p>
          </div>
        </li>
        <li>
          <span class="step-visual lamp-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>3</strong>
            <h2>次回の灯りを置く</h2>
            <p>日付または走行距離の目安を登録し、近づいた項目から確認します。</p>
          </div>
        </li>
        <li>
          <span class="step-visual file-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>4</strong>
            <h2>車と一緒に持ち出す</h2>
            <p>引渡し用PDF、CSV、写真込み編集ファイルを必要なときだけ書き出します。</p>
          </div>
        </li>
      </ol>
      <section class="safety-card">
        <span class="warning-light"></span>
        <div>
          <h2>整備時期を診断するサービスではありません</h2>
          <p>
            登録した期限は利用者自身の目安です。警告灯、異音、不具合、法定点検は車の取扱説明書を確認し、販売店・整備工場・ロードサービスへ相談してください。
          </p>
        </div>
      </section>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical={`${canonicalOrigin}/privacy`}
    description="整備灯の車両情報・写真・匿名計測の保存先と削除方法。"
    title="保存先｜整備灯"
  >
    <main class="info-page" id="main">
      <div class="info-heading">
        <div class="storage-box" aria-hidden="true">
          <span>LOCAL</span>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">PARKED HERE</p>
          <h1>記録は、この端末の車庫へ</h1>
        </div>
      </div>
      <div class="privacy-flow">
        <div>
          <span class="flow-car">▰</span>
          <strong>車・整備・期限・写真</strong>
        </div>
        <span class="flow-arrow">→</span>
        <div class="browser-box">
          <span>このブラウザ</span>
          <strong>IndexedDB</strong>
        </div>
        <span class="flow-stop">×</span>
        <div>
          <span class="flow-cloud">☁</span>
          <strong>内容APIなし</strong>
        </div>
      </div>
      <section class="privacy-copy">
        <article>
          <h2>端末内に保存</h2>
          <p>
            車の呼び名、車種、年式、距離、費用、メモ、期限、写真はIndexedDBだけに保存します。写真はJPEGへ再圧縮し、元画像のEXIFは保持しません。
          </p>
        </article>
        <article>
          <h2>匿名の操作計測</h2>
          <p>
            サーバーへ届くのは、許可済み操作名、ランダムなブラウザID、JST日付、QAフラグだけです。車両内容や件数を含めず、45日で削除します。
          </p>
        </article>
        <article>
          <h2>利用者が持ち出す</h2>
          <p>
            PDF、CSV、`.seibito`は利用者の操作でだけ生成します。ファイルの保管・送付先と、共有前に個人情報がないかの確認は利用者が決めます。
          </p>
        </article>
        <article>
          <h2>削除</h2>
          <p>
            「車庫を空にする」またはブラウザのサイトデータ削除で内容を消せます。ブラウザ削除後に復元するには、事前の`.seibito`バックアップが必要です。
          </p>
        </article>
      </section>
    </main>
  </Layout>
);

app.use("*", requestId());
app.use("*", securityHeaders);

app.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(<GaragePage />);
});
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));

app.post("/api/events", async (c) => {
  c.header("Cache-Control", "no-store");
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return c.json({ error: "cross_site_request" }, 403);
  }
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "cross_site_request" }, 403);
  }
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > 1024) return c.json({ error: "payload_too_large" }, 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) {
    return c.json({ error: "payload_too_large" }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return c.json({ error: "invalid_event" }, 400);
  }
  const { name } = payload as Record<string, unknown>;
  const sessionId = c.req.header("x-seibi-session") ?? "";
  if (
    typeof name !== "string" ||
    !eventNames.has(name) ||
    !sessionPattern.test(sessionId) ||
    Object.keys(payload).some((key) => key !== "name")
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      sessionId.toLowerCase(),
      jstDay(),
      nowSeconds(),
      c.req.header("x-seibi-qa") === "1" ? 1 : 0,
    )
    .run();
  return c.json({ accepted: true }, 202);
});

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/") || !/\.[a-z0-9]{2,8}$/iu.test(c.req.path)) {
    return c.html(
      <Layout
        canonical={`${canonicalOrigin}/`}
        description="指定されたページは見つかりませんでした。"
        title="見つかりません｜整備灯"
      >
        <main class="not-found" id="main">
          <span class="warning-light"></span>
          <h1>この区画は空いています。</h1>
          <a href="/">車庫へ戻る</a>
        </main>
      </Layout>,
      404,
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?")
    .bind(nowSeconds() - eventLifetime)
    .run();
};

export { app, scheduled };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
