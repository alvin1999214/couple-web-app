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
- SQLite 持久化資料，Docker named volume 保存內容
- 版本化 SQLite migration、升級前一致性備份及常用查詢 index
- 首次開啟會引導設定雙方名字、共同預算與開始日期；不預載示範資料

## 本地啟動

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

## 開發與測試

若本地已安裝 Python 3.10+：

```bash
python app.py
python -m unittest discover -s tests -v
```

專案結構：

```text
app.py              # Composition root，只負責組裝及啟動
ourspace/config.py  # 環境設定與 UI domain 常數
ourspace/database.py # SQLite connection、transaction 與共用存取 helper
ourspace/migration_runner.py # Migration transaction、版本檢查及升級前備份
ourspace/migrations/ # 按版本排列、不可修改的 schema migrations
ourspace/http.py    # HTTP／JSON／靜態檔案 adapter
ourspace/router.py  # 宣告式 API route mapping
ourspace/expense_filters.py # 開支日期／類別 filter domain model
ourspace/services/  # 依 expenses、shopping、todos 等 feature 分拆
ourspace/validation.py # 共用輸入驗證
static/index.html   # 頁面結構與 SVG icon sprite
static/styles.css   # 響應式介面與動畫
static/app.js       # widget 渲染、表單、拖拉互動
tests/test_app.py   # 資料層核心測試
tests/test_migrations.py # 舊資料升級、rollback、table／field 擴展測試
```

## 資料庫升級

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
