# Teletubbyland — 情侶同居生活 Web App

一個簡潔、可自由排列的共同生活 dashboard。介面採用香港繁體中文及港幣（HKD）；前端使用原生 HTML／CSS／JavaScript，後端為 Python 標準函式庫 HTTP API 與 SQLite，毋須額外套件。

## 主要功能

- 港幣每月預算、可新增／編輯／刪除的分類開支，以及按日期範圍顯示的消費走勢
- 全域開支篩選：今天、本週、本月、最近 7／30 天、類別，以及跨年份月份月曆
- 圖表同時保留所選月份總開支，啟用篩選後另列篩選總額、筆數及每筆開支日期
- 分帳支援平均、自訂百分比，以及按雙方收入自動計算比例
- 共同購物清單可編輯及批量清理；完成時輸入實付金額再建立獨立開支，已完成項目 30 日後自動清理
- 日常 Todo、負責人與期限
- 紀念日、生日等特別日子倒數與每年提醒
- 不同尺寸 widget，桌面可拖拉排序、調整大小、隱藏／恢復
- 手機與桌面響應式 UI、轉場動畫與 reduced-motion 支援
- Ravenclaw 星空藍魔法學院主題、Teletubbyland「星空下的家」線條徽章及 Safari 主畫面 app icon
- SQLite 持久化資料，Docker named volume 保存內容
- 版本化 SQLite migration、升級前一致性備份及常用查詢 index
- 首次開啟會引導設定雙方名字、共同預算與開始日期；不預載示範資料

## 本地啟動

### AI 單據記帳

在「記一筆」選擇拍攝或上傳單據，識別後核對／修改名稱、實付總額、分類及日期，選擇付款人並確認記帳。每張單據建立一筆總額開支，不逐項拆帳；確認前不會寫入資料庫。確認記帳時，額外壓縮的儲存版照片與開支在同一 transaction 儲存至本地 SQLite `expense_invoices` 表（BLOB），不是獨立圖片檔；取消、只做識別或記帳失敗都不會保存照片。開支列表及編輯視窗可查看單據；修改開支保留照片，刪除開支同時刪除照片。照片包含於既有 `data/ourspace.db`（Docker 的 `ourspace_data` volume）及資料庫備份中，舊備份仍保留當時的照片。無法識別的欄位留空；外幣／不明幣別必須自行填寫實際港幣金額。

識別後及儲存前會搜尋所有歷史單據：圖片內容完全相同，或日期及港幣金額相同時，顯示「這張單據可能已經上傳過了」，並提供已有單據圖片連結。重新拍照可透過日期及金額找到疑似重複；這是候選提示，並非保證辨認所有重拍照片（例如 OCR 日期／金額誤讀）。用戶需查看圖片並勾選確認是另一張單據才可繼續；儲存前發現新的候選會再次要求確認，未確認時 API 回傳 `409`（`code: duplicate_invoice`、`duplicates`），不寫入開支或照片。確認後以 `reviewed_invoice_ids` 傳送已核對的記錄 ID。相同日期及金額的不同消費也可能觸發提示。沿用既有資料表，舊單據立即參與檢查，無需新增 migration；Docker 部署需重新 build。

Docker Compose 會讀取專案根目錄的 `.env`，可依 `.env.example` 設定：

```dotenv
INVOICE_OCR_BASE_URL=https://cpa.lokiicode.com/v1
INVOICE_OCR_MODEL=gemini-3.8-flash-high
INVOICE_OCR_API_KEY=你的實際APIkey
```

API key 只在後端使用；`sk-xxxxxx` 為佔位值，必須換成有效 key。OAuth 由 CLIProxyAPI 管理，本程式透過其 `/chat/completions` 接口傳送照片。模型名稱按上述設定原樣傳送，需確保代理帳戶已開通該模型。更新設定後執行 `docker compose up -d --build`。直接使用 `python app.py` 時需先在 shell 匯出這些環境變數（不會自動讀取 `.env`）。

瀏覽器會將識別版照片縮放至最長邊 2400px 並轉成 JPEG，上傳原圖上限 20 MB，送至 OCR 上限 4 MB。儲存版另外以最長邊 1600px、JPEG 品質 75% 起始壓縮，超過 600 KB（600,000 bytes）會先降低品質，再縮小尺寸，直到符合上限；不放大小圖。只有儲存版會隨確認記帳送出，原圖和識別版不會保存。此設定適用於新上傳的照片，既有照片不重新壓縮。識別逾時可重新上傳或手動填寫。HEIC 支援取決於瀏覽器，無法讀取時請改用 JPEG。`POST /api/expenses/ocr` 只回傳待確認草稿，最終儲存沿用 `POST /api/expenses`。

### 淘寶／拼多多多頁截圖記帳

桌面可按「淘寶／拼多多記賬」；手機可在「記一筆」選「淘寶／拼多多多頁截圖」。一次選擇 1–10 張訂單頁面，AI 聯合識別多筆已付款訂單（最多 100 筆），相同可見訂單編號會合併。沒有日期、實付金額或幣別的欄位留空，不會默認成今天或港幣。未付款、取消及全額退款訂單由識別提示要求排除；結果仍需用戶核對，並非平台同步或完整性保證。

核對清單可修改平台、訂單編號、名稱、原幣金額、幣別、港幣金額、日期及分類，或移除不需要的項目。購物日期可一次「套用至全部」或「套用至勾選項目」，不同日期可分組處理。人民幣訂單可手動填寫港幣扣款，或輸入自己的 CNY→HKD 匯率並換算勾選項目；不會查詢或默認匯率。此批共用一位付款人，付款人不同請分批匯入。勾選只控制批量操作，所有保留項目都會儲存。

查看來源截圖、核對日期及港幣金額後，勾選確認並批量記帳。每筆保留首張來源截圖，沿用開支的「單據」連結查看。多張截圖確認前只在瀏覽器暫存；關閉視窗會放棄草稿。已有相同平台／訂單編號會拒絕重複匯入；沒有編號的訂單會按已有圖片、日期及金額提示疑似重複，仍需人工核對。整批資料在同一 transaction 儲存，任何一筆失敗都不會部分入賬。網絡錯誤時保留並鎖定原提交，可按「重試原批次」確認結果，重試不會再次新增。

沿用上述 `INVOICE_OCR_*` 設定，模型需支援多張圖片。識別版最長邊 3000px、每張不超過 1 MB；儲存版最長邊 2000px、每張不超過 600 KB。超長或模糊頁面請拆成清晰截圖。`POST /api/expenses/orders/ocr` 只回傳草稿；`POST /api/expenses/orders/import` 接收確認後的整批資料。兩個端點請求上限為 14 MB，圖片解碼總和上限 10 MB。migration v006 新增 `expense_orders` 保存訂單編號及原幣資料，`order_import_batches` 保存重試識別碼；啟動時自動升級及備份，Docker 部署需重新 build。

```bash
docker compose up --build
```

完成後開啟 <http://localhost:8000>。停止服務：

```bash
docker compose down
```

資料存放於 `ourspace_data` Docker volume；一般的 `docker compose down` 不會刪除資料。

若曾啟動過舊版並希望重新體驗全新的首次設定，可自行刪除舊 volume：

```bash
docker compose down -v
```

此操作會永久刪除舊資料，已有正式資料時請勿執行。

## 架構總覽

本專案刻意維持零第三方 runtime dependency：後端使用 Python 標準函式庫，前端使用原生 HTML／CSS／JavaScript。依賴方向固定由外向內，domain/service 不應依賴 HTTP 或前端細節。

```text
Browser UI (static/)
        │ JSON over HTTP
        ▼
HTTP adapter (ourspace/http.py)
        │ route dispatch
        ▼
Router (ourspace/router.py)
        │ calls one feature service
        ▼
Services (ourspace/services/) ──► Domain helpers / validation
        │ SQL within a transaction
        ▼
Database lifecycle (ourspace/database.py)
        │ startup only
        ├──► Migration runner (ourspace/migration_runner.py)
        └──► SQLite (/app/data/ourspace.db)
```

各層責任：

| 層級 | 應負責 | 不應負責 |
|---|---|---|
| `app.py` | 組裝 Database、Router、HTTP server；啟動 migration | Domain logic、SQL、輸入驗證 |
| `http.py` | HTTP method、JSON、status code、靜態檔案、安全 header | Feature rules、直接存取資料庫 |
| `router.py` | URL mapping、path/query parameter 轉交、onboarding gate | 業務計算、大量流程代碼 |
| `services/` | 一個 feature 的 use case、transaction boundary、SQL | HTML／CSS、HTTP response 實作 |
| Domain helpers | 可重用且可單獨測試的計算與驗證 | Connection lifecycle |
| `database.py` | Connection、commit／rollback、SQLite PRAGMA | Feature-specific query |
| `migrations/` | Schema、index、舊資料 backfill | Runtime request logic |
| `static/app.js` | UI state、API 呼叫、render、表單與互動 | 作為業務資料的唯一真相來源 |

## 專案結構

```text
.
├── .dockerignore                  # 排除 image 不需要的本機資料及 cache
├── .gitignore                     # 排除 database、cache 及本機檔案
├── app.py                         # Composition root 及 HTTP server 啟動點
├── docker-compose.yml             # localhost port、DATA_DIR、named volume
├── Dockerfile                     # 無 root、Python 3.12 Alpine runtime
├── README.md                      # 架構、操作及接手規則（本文件）
├── ourspace/
│   ├── __init__.py                # Python package marker
│   ├── config.py                  # 環境設定、HKD／zh-HK、類別及預設 widget layout
│   ├── database.py                # SQLite connection、transaction、共用存取 helpers
│   ├── errors.py                  # API 可預期錯誤及 HTTP status
│   ├── expense_filters.py         # 日期範圍／類別 filter domain model
│   ├── http.py                    # HTTP／JSON／靜態檔案 adapter
│   ├── maintenance.py             # 已完成購物項目的保留期清理規則
│   ├── migration_runner.py        # Migration 順序、transaction、驗證及備份
│   ├── router.py                  # 宣告式 API route mapping
│   ├── split.py                   # 平均、自訂及收入比例分帳計算
│   ├── validation.py              # 共用文字、數字、日期、類別及 boolean 驗證
│   ├── migrations/
│   │   ├── __init__.py            # 唯一 migration registry
│   │   ├── types.py               # Immutable Migration 定義
│   │   ├── helpers.py             # 安全 additive schema helpers
│   │   ├── v001_initial.py        # 初始 tables
│   │   ├── v002_shopping_completed_at.py
│   │   └── v003_query_indexes.py
│   └── services/
│       ├── shared.py              # Service dependency base
│       ├── dashboard.py           # Dashboard read model 及開支統計
│       ├── expenses.py            # 開支 CRUD
│       ├── settings.py            # Onboarding、設定及 layout persistence
│       ├── shopping.py            # 購物 CRUD、完成購物並建立開支
│       ├── todos.py               # Todo CRUD／完成狀態
│       └── special_days.py        # 特別日子 CRUD
├── static/
│   ├── assets/                    # Logo master、favicon、Apple／PWA icon sizes
│   ├── index.html                 # App shell、PWA metadata、onboarding、filter、modal、SVG sprite
│   ├── manifest.webmanifest       # Standalone app 名稱、顏色及 icon 宣告
│   ├── styles.css                 # Design tokens、widget、動畫及 responsive layout
│   └── app.js                     # SPA state、API、renderer、form config、event delegation
└── tests/
    ├── test_app.py                # Feature、資料保留及 validation integration tests
    └── test_migrations.py         # 舊 schema 升級、backup、rollback、擴展測試
```

## 重要 Domain 規則

- 首次使用前，除 health、status、dashboard 及 onboarding 外，所有 domain route 都由 Router 阻擋。
- 新資料庫不可加入 demo／default user data；onboarding 完成前應保持空白。
- 購物清單與開支不是同一筆資料。完成購物時才輸入實付價格並建立開支；之後刪除或清理購物項目不得刪除開支。
- 已完成購物項目保留 30 日；清理是 dashboard read 時的 maintenance side effect，開支永久保留。
- `expense_total` 是目前 filter 總額；`month_expense_total` 是所選月份、全部類別的總額，兩者不可混用。
- `today` 由瀏覽器以 `YYYY-MM-DD` 傳入 dashboard API，避免 Docker UTC 與香港本地日期不同。
- 日期在資料庫以 ISO `YYYY-MM-DD` 儲存，讓字串排序及 `BETWEEN` query 保持正確。
- Settings 使用 key/value JSON；新增設定仍需在 service 驗證並提供舊資料 fallback。
- 金額目前以兩位小數 `REAL` 保存。若改用整數港仙，必須以新 migration、舊資料 backfill 及 API compatibility 測試完成，不可直接改欄位。

## 前端架構及跨檔案契約

`static/app.js` 是小型 SPA，主要流程是：

1. `loadDashboard()` 將 global filter 組成 query string。
2. API 回傳完整 dashboard read model，存入唯一的 `state.data`。
3. `renderDashboard()` 按 persisted layout 呼叫各 widget renderer。
4. 所有新增／編輯表單由 `forms` config 建立；共用 modal 負責 submit。
5. Mutation 成功後重新載入 dashboard，不在前端自行模擬後端結果。

修改前端時必須遵守：

- UI 文案使用香港常用繁體中文，locale 為 `zh-HK`，貨幣為 HKD。
- 所有 API 或 user-generated text 插入 HTML 前必須經 `esc()`；不要直接拼接未處理輸入。
- 新增 widget 時，同步更新 `config.DEFAULT_LAYOUT`／`WIDGET_IDS`、`app.js` 的 `widgetMeta`、renderer mapping 及 CSS。
- 新增開支類別時，同步更新 `config.CATEGORY_META`、`app.js` 的 `categories`、filter options 及相關測試。
- CSS／JavaScript 行為有更新時，同步提升 `index.html` 的 `?v=` asset version，避免舊 browser cache。
- 手機最低寬度以 320px 為基準；新增 UI 要檢查 390px mobile 及 desktop layout。
- 動畫必須保留 `prefers-reduced-motion` fallback。

### 視覺設計系統

- 主題是 Ravenclaw 氣質的原創「星空魔法學院／古老圖書館」風格，不直接使用或複製任何官方電影校徽、角色、字標或受保護圖像。
- 主色為午夜星空藍 `#08152f`、月光銀藍 `#e7edf6`、學院藍 `#31598f` 及古銅金 `#c9a45c`。
- Display typography 使用 `Cinzel`／`Noto Serif TC`，操作文字使用 `Noto Sans TC`；必須保留 system fallback。
- 深色星空藍 app shell 承托月光冷藍 widgets；重要 CTA 用古銅金，開支重點用學院藍，完成狀態用青綠。
- `teletubbyland-home-emblem-master.png` 是品牌 master；介面及 metadata 應使用相應縮圖，不要直接下載或替換成官方 franchise artwork。
- Logo 是原創「星空下的家」簡線圖形，以古銅金屋形與銀藍星光表達兩個人的共同生活；修改時要重新輸出並檢查 32、180、192、512px，確保在 iOS mask 及 favicon 小尺寸仍清晰。

## Safari 加入主畫面

`index.html` 已提供 Apple mobile web app metadata、180px touch icon、`viewport-fit=cover` 及 standalone safe-area 樣式；`manifest.webmanifest` 同時供支援 manifest 的瀏覽器使用。

在 iPhone／iPad 安裝：

1. 用 Safari 開啟可連接此 Docker 服務的網址。手機上的 `localhost` 代表手機本身，應使用電腦的區域網絡 IP 或已部署的 HTTPS 網址。
2. 按 Safari「分享」按鈕，選擇「加入主畫面」。
3. 確認預覽顯示 Teletubbyland「星空下的家」徽章，再按「加入」。
4. 從主畫面開啟後會使用 standalone 模式、星空藍 status bar 及 iOS safe areas。

iOS 可能保存舊的 touch icon；Logo 更新後如仍顯示舊圖，先刪除原有主畫面捷徑，再從 Safari 重新加入。此 app 的資料及 API 仍由本機 Docker server 提供，因此手機離開可連接該 server 的網絡後不會有完整離線功能。

## 新增或修改功能

一般 feature 的落點順序：

1. 判斷是否需要 schema 變更；需要便先建立下一個 migration。
2. 把共用驗證或純計算放入 `validation.py` 或獨立 domain module。
3. 在對應 service 實作 use case；同一個 use case 的多個 SQL 寫入使用同一 connection。
4. 在 `router.py` 只加入薄 route mapping，不把流程寫進 lambda／Router。
5. Dashboard 需要顯示資料時，在 `DashboardService` 擴充 read model。
6. 前端先擴充 state／renderer／forms config，再加入 event delegation 及 responsive CSS。
7. 為成功、驗證失敗、舊資料 compatibility 及資料保留語意加入測試。

避免產生 god class：若一個 service 開始處理其他 feature、同一計算在兩處出現，或 Router／`app.py` 出現 domain branch，應先抽成小 service 或 domain helper。

## 資料庫及 Migration 規則

資料庫 schema 由 `schema_migrations` 記錄版本。程式啟動時只會依序執行尚未套用的 migration，每一步都在獨立 transaction 內完成；失敗時會 rollback，已套用的 migration 不會重跑。

當既有資料庫需要升級，程式會先透過 SQLite backup API 建立一致性備份：

```text
/app/data/backups/ourspace-before-v{版本}-{UTC時間}.db
```

備份與主資料庫同樣位於 `ourspace_data` volume。這能保障 migration 失敗，但不能防止 `docker compose down -v` 或整個 volume 被刪除；重要資料仍應另行複製至 volume 以外的位置。

新增 schema 變更時：

1. 在 `ourspace/migrations/` 建立下一個連續版本，例如 `v004_expense_note.py`。
2. 匯出一個 `Migration(4, "expense_note", apply)`，並在 `migrations/__init__.py` 註冊。
3. 新 field 優先先設為 nullable 或提供 default，再 backfill 舊資料。
4. 不可修改或重新命名已發布的 migration；需要修正時建立下一版本。
5. 在 `tests/test_migrations.py` 加入由舊 schema 升級並核對原有資料的測試。

其他規則：

- Migration 版本必須由 1 開始、連續、唯一並按升序註冊。
- 新增 table 使用 `CREATE TABLE`；新增 field 優先使用 `ensure_column()`，migration 本身仍需可安全重試。
- 新增 `NOT NULL` field 時先提供 default／nullable、backfill，再於後續 migration 收緊限制。
- 不可在 `database.py`、service startup 或 request handler 即場執行 `ALTER TABLE`。
- 常用 filter／sort field 應在 migration 加 index，並以測試或 `EXPLAIN QUERY PLAN` 驗證。
- `ourspace_data` 適合 container rebuild 持久化，但不是 off-site backup；`docker compose down -v` 會連 migration backups 一併刪除。

目前主要 tables：

| Table | 用途及關係 |
|---|---|
| `settings` | JSON key/value；onboarding、預算、名字、split、layout |
| `expenses` | 開支 ledger；`shopping_item_id` 只記錄來源，不控制購物項目 lifecycle |
| `expense_invoices` | migration v005；每筆開支最多一張本地單據照片，隨開支一同新增／刪除 |
| `expense_orders` | migration v006；網購訂單編號、平台及原幣資料，隨開支刪除 |
| `order_import_batches` | migration v006；批量提交的重試識別碼及結果 |
| `shopping_items` | 待購／已完成狀態；`expense_id` 刪除時設為 `NULL` |
| `todos` | 待辦、負責人、期限、完成狀態 |
| `special_days` | 特別日子及每年重複設定 |
| `schema_migrations` | 已套用 schema version、名稱及時間 |

## API 慣例

- Request／response 使用 JSON；錯誤統一為 `{ "error": "香港繁體中文訊息" }`。
- 可預期輸入錯誤使用 `ApiError`；不要用裸 exception 表達 validation failure。
- Create route 回傳 `201`；update／delete 通常回傳 `{ "ok": true }`。
- 所有 SQL value 使用 parameter binding，不把 user input 拼入 SQL。
- Route 是否需要完成 onboarding 由 `Route.requires_setup` 控制。
- Dashboard 是組合 read endpoint；feature mutation 保持為獨立 endpoint。

API 清單的單一真相來源是 `ourspace/router.py`。新增或改名 endpoint 時，必須同時更新前端呼叫及 integration tests。

## 開發、測試及交付清單

若本地已安裝 Python 3.10+：

```bash
python app.py
python -m unittest discover -s tests -v
python -m py_compile app.py ourspace/*.py ourspace/migrations/*.py ourspace/services/*.py
node --check static/app.js
```

提交前至少確認：

- 全部測試通過，fresh database 及 legacy migration 都有覆蓋。
- 沒有加入 demo data，也沒有覆寫現有 Docker volume。
- Mutation 的 validation、transaction、404／409 等錯誤語意完整。
- 新 schema 只透過下一版本 migration 套用，舊 row 已驗證仍存在。
- Desktop 與 mobile UI 均可操作，loading／empty／error state 沒有失效。
- README 的 project tree、domain rule 或 migration 指引仍與代碼一致。

## 給 AI Agent／新開發者的接手次序

1. 先閱讀本 README，再查看 `git status`，保留任何不屬於當前任務的現有修改。
2. 從 `router.py` 找 feature 入口，再讀對應 service、domain helper 及 tests；不要先把所有邏輯搬進 `app.py`。
3. 涉及資料格式時先讀 migration registry 及 legacy tests，絕不直接修改已發布 migration。
4. 涉及 UI 時搜尋相關 renderer、form config、event selector 及 CSS class，確認跨檔案契約。
5. 以最小、可測試的 feature boundary 實作，維持 DRY，完成後執行完整驗證清單。
6. 交付時說明修改檔案、migration version、資料 compatibility、測試結果及 Docker 是否需要 rebuild。

若 README 與代碼不一致，以測試及實際代碼為當前行為，但應在同一變更中修正 README，避免下一位接手者沿用過時資訊。
