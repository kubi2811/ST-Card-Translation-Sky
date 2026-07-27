# Đại tu bộ cào wiki (bug 120 + 121 + 122)

## Hiện trạng (khảo sát 27/07)
- `wikiScraper.ts` (568): `fetchWikiContent` đọc **MỘT trang** (Fandom API → MediaWiki API →
  allorigins HTML) rồi `runWikiScrape` đẩy nguyên văn vào batch AI. Không crawl link con,
  không depth, không dedup URL, không resume.
- `wikiCrawlerEngine.ts` (1763): điều hướng menu wiki cho Copilot/WikiCollector — có sẵn
  META_FILTERS (lọc trang meta), proxy rotation (4-5 tầng), validateTitlesExist. TÁI DÙNG.
- `WikiScraperPanel.tsx` (676): tab "Cào Wiki" của Lorebook — bị thay bằng panel mới.
- `WikiCollectorPanel` (copilot, route /wiki): GIỮ NGUYÊN — nó là công cụ duyệt-chọn-lọc
  thủ công, không phải bộ cào tự động; chỉ dùng chung engine.

## Hoà giải 3 ý kiến (120 / 121 / 122)
| Vấn đề | Quyết định |
|---|---|
| 120+122 "cào HẾT mọi trang" vs 121 "giới hạn depth/maxPages" | Theo 121: có depth + maxPages (mặc định 2 / 60). "Hết" trên Wikipedia là hàng triệu trang — bất khả thi trong trình duyệt; giới hạn là điều khiển của user, auto-expand bật thì đi rộng dần theo BFS cho tới trần. |
| 121 "semantic dedup bằng embedding" | Không thêm dependency/embedding API. Dùng 3 lớp sẵn có (identity + bigram Jaccard + TF-IDF cosine, `isDuplicateEntry` từ việc 90) + FactIndex TF-IDF cho fact-level. Đây LÀ semantic comparison ở mức chấp nhận, chạy offline, tất định. |
| 122 "áp dụng dedup ở cả Auto Creator + Lorebook" | Đã đạt từ việc 90: cả ba đường (Auto Creator, AI Sinh theo Batch, Wiki Import mới) đều đi qua `isDuplicateEntry`. |
| Chia batch không giẫm chân (120+121+122) | Coordinator chia TẬP TRANG tất định: batch i nhận trang i, i+N, i+2N… — mạnh hơn lane-hint của việc 90 vì dữ liệu nguồn tách hẳn, không dựa vào lời dặn prompt. |
| 120 "xoá toàn bộ cào cũ" | Thay `wikiScraper.ts` + `WikiScraperPanel.tsx` bằng bộ mới; giữ `wikiCrawlerEngine.ts` (WikiCollector của Copilot vẫn dùng, và bộ mới tái dùng proxy+filter của nó). |

## Kiến trúc mới `src/lib/wikiImport/`
```
types.ts          WikiImportConfig/Progress/PageDoc/CrawlState — hợp đồng chung
platform.ts       nhận diện nền tảng TỔNG QUÁT (không hardcode từng site):
                  – có /wiki/ + api.php trả lời ⇒ họ MediaWiki (Fandom, wiki.gg, Miraheze,
                    Wikipedia, Bulbapedia, tự host)
                  – baike.baidu.com ⇒ Baidu (HTML, cấu trúc /item/)
                  – còn lại ⇒ generic HTML
fetchClient.ts    fetch 1 URL: proxy rotation (tái dùng thứ tự của engine cũ) + retry +
                  rate-limit (min interval per host) + cache Map + AbortSignal
htmlExtract.ts    HTML → PageDoc {title, text theo section, infobox, aliases, links nội bộ}
                  DOMParser; lọc link meta (Special:/User:/Talk:/File:/action=edit/#…)
                  + META_FILTERS tái dùng; giữ bảng/infobox/danh sách thành text
mediaWiki.ts      đường api.php: parse → wikitext/sections + links + langlinks (tên đa
                  ngôn ngữ cho Keys); fallback HTML khi API tắt
crawler.ts        BFS: seed → depth N, normalize URL (bỏ #fragment, query rác, decode),
                  visited set, per-host, bỏ link chết (HEAD/GET fail), redirect-loop
                  (theo final URL), maxPages, tiến trình {crawled, queued, eta}, resume
                  từ CrawlState, pause/cancel
factIndex.ts      TF-IDF index fact đã dùng (câu/đoạn đã vào entry) — worker kiểm trước
                  khi viết, coordinator ghi sau khi nhận
coordinator.ts    chia PageDoc thành N batch tất định (round-robin theo thứ tự cào),
                  worker song song (concurrency theo pool), mỗi worker chỉ thấy batch
                  mình + fact index chung + danh sách title entry đã tạo; lớp cuối
                  isDuplicateEntry + sàn ký tự (việc 90)
entryGen.ts       prompt sinh entry TỪ NỘI DUNG TRANG (không sáng tác): luật chất lượng
                  (cấm trivia/hiển-nhiên/không-suy-diễn/không-headcanon, mâu thuẫn thì
                  ghi chú nguồn), keys = title + aliases + langlinks, token target
index.ts          runWikiImport(config, ctx) — điểm vào duy nhất, resume state persist
                  qua localStorage key theo URL
```

## UI mới `WikiImportPanel.tsx` (thay tab Cào Wiki)
Input đúng 121: URL, số entries, token/entry, auto-expand (bật = BFS tới trần), depth
(1-4), maxPages, canon-only (checkbox — lọc category chứa non-canon/fanon khi wiki có).
Tiến trình: đã cào/còn hàng đợi/ETA, số entry đã tạo, log, Pause/Resume/Stop; resume
sau F5 nhờ CrawlState persist.

## Trình tự làm + verify (122)
1. types + platform + htmlExtract + crawler thuần → test (URL mẫu trong message 121:
   Fandom×7, MediaWiki×4, wiki.gg×4, Miraheze×2, Baidu×4).
2. fetchClient (inject fetch để test không mạng) + mediaWiki.
3. factIndex + coordinator (test: partition không giao nhau; fact trùng bị chặn).
4. entryGen + runWikiImport.
5. UI panel + gỡ WikiScraperPanel/wikiScraper cũ + i18n.
6. Build + toàn bộ test + báo cáo xung đột đã hoà giải.
