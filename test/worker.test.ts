import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { app, scheduled, type Bindings } from "../src/worker";

const migrationPath = fileURLToPath(new URL("../migrations/0001_events.sql", import.meta.url));
const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const serviceWorkerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const stylesPath = fileURLToPath(new URL("../public/styles.css", import.meta.url));
const origin = "http://localhost";
const session = "a2d0e2f2-66fd-4fd4-8e87-b0ef67ad194a";

let miniflare: Miniflare;
let bindings: Bindings;

const eventRequest = (
  name: string,
  options: { body?: string; origin?: string; qa?: boolean; session?: string } = {},
) => ({
  body: options.body ?? JSON.stringify({ name }),
  headers: {
    "content-type": "application/json",
    origin: options.origin ?? origin,
    "x-seibi-qa": options.qa ? "1" : "0",
    "x-seibi-session": options.session ?? session,
  },
  method: "POST",
});

beforeEach(async () => {
  miniflare = new Miniflare({
    d1Databases: { DB: "seibi-to-test" },
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
  });
  const database = await miniflare.getD1Database("DB");
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await database.prepare(statement).run();
  }
  bindings = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    DB: database as unknown as D1Database,
  };
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("public pages", () => {
  it.each([
    ["/", 'class="garage-door"', "https://seibi-to.yhay81.com/"],
    ["/guide", 'class="guide-steps"', "https://seibi-to.yhay81.com/guide"],
    ["/privacy", 'class="privacy-flow"', "https://seibi-to.yhay81.com/privacy"],
  ])("%s は製品固有の画面を返す", async (path, marker, canonical) => {
    const response = await app.request(path, undefined, bindings);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(marker);
    expect(html).toContain(`href="${canonical}" rel="canonical"`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(html).not.toMatch(/成功条件|市場スコア|公開実験/);
  });

  it("車庫画面は視覚的な計器盤、外部module、持出し導線を持つ", async () => {
    const response = await app.request("/", undefined, bindings);
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('class="instrument-panel"');
    expect(html).toContain('class="service-lane"');
    expect(html).toContain('class="history-bay"');
    expect(html).toContain('class="local-flow"');
    expect(html).toMatch(/<script src="\/app\.js" type="module"><\/script>/);
    expect(html).toContain("写真込み .seibito");
    expect(html).toContain("表計算用 CSV");
    expect(html).toContain("引渡し用に印刷 / PDF");
  });

  it("未知のページは404、静的アセットはASSETSへ渡す", async () => {
    const page = await app.request("/missing", undefined, bindings);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("この区画は空いています");
    const asset = await app.request("/unknown.css", undefined, bindings);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("asset");
  });
});

describe("anonymous telemetry", () => {
  it.each([
    "visited",
    "vehicle_created",
    "record_added",
    "reminder_added",
    "printed",
    "project_exported",
    "project_imported",
    "returned",
  ])("%s を許可する", async (name) => {
    const response = await app.request("/api/events", eventRequest(name), bindings);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  });

  it("イベント名、本文field、セッションIDを許可リストで制限する", async () => {
    const event = await app.request("/api/events", eventRequest("photo_uploaded"), bindings);
    expect(event.status).toBe(400);
    const content = await app.request(
      "/api/events",
      eventRequest("record_added", {
        body: JSON.stringify({ name: "record_added", odometer: 32000 }),
      }),
      bindings,
    );
    expect(content.status).toBe(400);
    const invalidSession = await app.request(
      "/api/events",
      eventRequest("visited", { session: "not-a-session" }),
      bindings,
    );
    expect(invalidSession.status).toBe(400);
  });

  it("JSON以外、不正JSON、1KB超の本文を拒否する", async () => {
    const media = await app.request(
      "/api/events",
      {
        body: "name=visited",
        headers: { "content-type": "text/plain", "x-seibi-session": session },
        method: "POST",
      },
      bindings,
    );
    expect(media.status).toBe(415);
    const malformed = await app.request(
      "/api/events",
      eventRequest("visited", { body: "{" }),
      bindings,
    );
    expect(malformed.status).toBe(400);
    const oversized = await app.request(
      "/api/events",
      eventRequest("visited", { body: JSON.stringify({ name: "x".repeat(1100) }) }),
      bindings,
    );
    expect(oversized.status).toBe(413);
  });

  it("別originからの記録を拒否する", async () => {
    const response = await app.request(
      "/api/events",
      eventRequest("visited", { origin: "https://example.com" }),
      bindings,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "cross_site_request" });
  });

  it("自動QAイベントを実利用から分離する", async () => {
    await app.request("/api/events", eventRequest("record_added", { qa: true }), bindings);
    await app.request("/api/events", eventRequest("record_added"), bindings);
    const rows = await bindings.DB.prepare(
      "SELECT is_qa, COUNT(*) AS count FROM product_events GROUP BY is_qa ORDER BY is_qa",
    ).all<{ count: number; is_qa: number }>();
    expect(rows.results).toEqual([
      { count: 1, is_qa: 0 },
      { count: 1, is_qa: 1 },
    ]);
  });

  it("45日を過ぎた計測だけを削除する", async () => {
    const now = Math.floor(Date.now() / 1000);
    await bindings.DB.prepare(
      `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
       VALUES ('visited', ?, '2026-01-01', ?, 0), ('visited', ?, '2026-07-30', ?, 0)`,
    )
      .bind(session, now - 46 * 86400, session, now)
      .run();
    await scheduled({} as ScheduledController, bindings, {} as ExecutionContext);
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM product_events").first<{
      count: number;
    }>();
    expect(row?.count).toBe(1);
  });
});

describe("local garage contract", () => {
  it("車両内容を送らず、IndexedDB内の車・履歴・期限だけを扱う", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(source).toContain('fetch("/api/events"');
    expect(source).toContain("indexedDB.open");
    expect(source).toContain('createObjectStore("vehicles"');
    expect(source).toContain('createObjectStore("records"');
    expect(source).toContain('createObjectStore("reminders"');
    expect(source).toContain("const maximumVehicles = 3");
    expect(source).toContain("const maximumRecords = 300");
    expect(source).toContain("const maximumReminders = 50");
    expect(source).not.toMatch(/innerHTML|eval\(|new Function/);
  });

  it("写真を端末内で再圧縮し、全バックアップ・CSV・PDFを持ち出せる", async () => {
    const [source, styles] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(stylesPath, "utf8"),
    ]);
    expect(source).toContain("createImageBitmap");
    expect(source).toContain("canvas.toBlob");
    expect(source).toContain("maximumPhotoBytes = 220_000");
    expect(source).toContain(".seibito");
    expect(source).toContain("text/csv");
    expect(source).toContain("window.print()");
    expect(source).toContain("/^[=+\\-@]/u");
    expect(styles).toContain("size: A4 portrait");
    expect(styles).toContain("@media print");
  });

  it("静的製品面をネットワーク優先でオフラインキャッシュする", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    expect(source).toContain('const cacheName = "seibi-to-v1"');
    expect(source).toContain("caches.open");
    expect(source).toContain("fetch(event.request)");
    expect(source).not.toContain("/api/events");
  });
});
