import { useEffect, useMemo, useRef, useState } from "react";
import { analyzePdf } from "./analysis/pdfAnalyzer";
import type {
  Detection,
  DocumentAnalysis,
  DocumentDetection,
  Severity,
} from "./analysis/types";

const severityLabels: Record<Severity, string> = {
  info: "情報",
  caution: "注意",
  high: "高リスク",
};

function downloadReport(analysis: DocumentAnalysis) {
  const report = {
    ...analysis,
    pages: analysis.pages.map(({ previewUrl: _previewUrl, ...page }) => page),
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${analysis.fileName.replace(/\.pdf$/iu, "")}-pdfender-report.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function DetectionCard({
  detection,
  selected,
  onSelect,
}: {
  detection: Detection;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`detection-card ${selected ? "selected" : ""}`}
      data-severity={detection.severity}
      onClick={onSelect}
      type="button"
    >
      <span className="detection-heading">
        <span className="severity-badge">{severityLabels[detection.severity]}</span>
        <strong>確信度 {detection.score}</strong>
      </span>
      <span className="detected-text">
        {detection.text || "（抽出できない文字列）"}
      </span>
      <span className="signal-list">
        {detection.signals.map((signal) => (
          <span key={signal.kind}>{signal.label}</span>
        ))}
      </span>
    </button>
  );
}

function DocumentDetectionCard({
  detection,
}: {
  detection: DocumentDetection;
}) {
  return (
    <article className="document-detection-card" data-severity={detection.severity}>
      <span className="detection-heading">
        <span className="severity-badge">{severityLabels[detection.severity]}</span>
        <strong>確信度 {detection.score}</strong>
      </span>
      <span className="document-detection-source">{detection.source}</span>
      <span className="detected-text">{detection.text}</span>
      <span className="signal-list">
        {detection.signals.map((signal) => (
          <span key={signal.kind}>{signal.label}</span>
        ))}
      </span>
      <small>{detection.signals[0]?.detail}</small>
    </article>
  );
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activePageRef = useRef<HTMLButtonElement>(null);
  const pageButtonsRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const selectedDetectionBoxRef = useRef<HTMLButtonElement>(null);
  const aboutButtonRef = useRef<HTMLButtonElement>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const page = analysis?.pages.find((item) => item.pageNumber === selectedPage) ?? null;
  const selectedDetection = useMemo(
    () => page?.detections.find((item) => item.id === selectedDetectionId) ?? null,
    [page, selectedDetectionId],
  );
  const detectionPages = useMemo(
    () => analysis?.pages.filter((item) => item.detections.length > 0) ?? [],
    [analysis],
  );
  const currentDetectionPageIndex = detectionPages.findIndex(
    (item) => item.pageNumber === selectedPage,
  );

  function selectPage(pageNumber: number) {
    const next = analysis?.pages.find((item) => item.pageNumber === pageNumber);
    if (!next) return;
    setSelectedPage(pageNumber);
    setSelectedDetectionId(next.detections[0]?.id ?? null);
  }

  function jumpDetectionPage(direction: -1 | 1) {
    if (detectionPages.length === 0) return;

    let targetIndex: number;
    if (currentDetectionPageIndex >= 0) {
      targetIndex =
        (currentDetectionPageIndex + direction + detectionPages.length) % detectionPages.length;
    } else if (direction === 1) {
      const nextIndex = detectionPages.findIndex((item) => item.pageNumber > selectedPage);
      targetIndex = nextIndex >= 0 ? nextIndex : 0;
    } else {
      let previousIndex = -1;
      for (let index = detectionPages.length - 1; index >= 0; index -= 1) {
        if (detectionPages[index].pageNumber < selectedPage) {
          previousIndex = index;
          break;
        }
      }
      targetIndex = previousIndex >= 0 ? previousIndex : detectionPages.length - 1;
    }

    selectPage(detectionPages[targetIndex].pageNumber);
  }

  useEffect(() => {
    const scroller = pageButtonsRef.current;
    const active = activePageRef.current;
    if (!scroller || !active) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < scrollerRect.top) {
      scroller.scrollTop -= scrollerRect.top - activeRect.top + 6;
    } else if (activeRect.bottom > scrollerRect.bottom) {
      scroller.scrollTop += activeRect.bottom - scrollerRect.bottom + 6;
    }
    if (activeRect.left < scrollerRect.left) {
      scroller.scrollLeft -= scrollerRect.left - activeRect.left + 6;
    } else if (activeRect.right > scrollerRect.right) {
      scroller.scrollLeft += activeRect.right - scrollerRect.right + 6;
    }
  }, [analysis, selectedPage]);

  useEffect(() => {
    if (!selectedDetectionId) return;

    const frame = requestAnimationFrame(() => {
      const scroller = previewStageRef.current;
      const selectedBox = selectedDetectionBoxRef.current;
      if (!scroller || !selectedBox) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const boxRect = selectedBox.getBoundingClientRect();
      const safeInset = 24;
      const isOutsideVertically =
        boxRect.top < scrollerRect.top + safeInset ||
        boxRect.bottom > scrollerRect.bottom - safeInset;
      const isOutsideHorizontally =
        boxRect.left < scrollerRect.left + safeInset ||
        boxRect.right > scrollerRect.right - safeInset;

      if (isOutsideVertically) {
        scroller.scrollTop +=
          boxRect.top + boxRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
      }
      if (isOutsideHorizontally) {
        scroller.scrollLeft +=
          boxRect.left + boxRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedDetectionId, selectedPage]);

  useEffect(() => {
    if (!isAboutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAboutOpen(false);
        requestAnimationFrame(() => aboutButtonRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isAboutOpen]);

  function closeAbout() {
    setIsAboutOpen(false);
    requestAnimationFrame(() => aboutButtonRef.current?.focus());
  }

  async function inspectFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDFファイルを選択してください。");
      return;
    }
    setError(null);
    setAnalysis(null);
    setSelectedPage(1);
    setSelectedDetectionId(null);
    setProgress({ completed: 0, total: 1 });
    try {
      const result = await analyzePdf(file, (completed, total) =>
        setProgress({ completed, total }),
      );
      setAnalysis(result);
      const firstDetection = result.pages.flatMap((item) => item.detections)[0];
      if (firstDetection) {
        setSelectedPage(firstDetection.pageNumber);
        setSelectedDetectionId(firstDetection.id);
      }
    } catch (cause) {
      console.error(cause);
      setError(
        cause instanceof Error
          ? `解析に失敗しました：${cause.message}`
          : "PDFの解析に失敗しました。",
      );
    } finally {
      setProgress(null);
    }
  }

  const totalDetections = analysis
    ? Object.values(analysis.summary).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <main className={analysis ? "has-analysis" : ""}>
      <header className="app-chrome">
        <div className="brand-lockup">
          <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
          <span>PDFender</span>
        </div>
        <button
          ref={aboutButtonRef}
          className="about-icon-button"
          type="button"
          aria-label="このツールについて"
          title="このツールについて"
          onClick={() => setIsAboutOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 10.8v5.4M12 7.7h.01" />
          </svg>
        </button>
      </header>

      {!analysis && (
        <section
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void inspectFile(file);
          }}
        >
          <input
            ref={inputRef}
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspectFile(file);
              event.target.value = "";
            }}
            type="file"
          />
          <span className="file-icon" aria-hidden="true">PDF</span>
          <h2>検査するPDFを選択</h2>
          <p>ここにドラッグ＆ドロップすることもできます</p>
          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            PDFは外部へ送信されません
          </div>
          <button type="button" onClick={() => inputRef.current?.click()}>
            PDFを選ぶ
          </button>
          {progress && (
            <div className="progress" role="status">
              <span
                style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
              />
              <small>
                {progress.completed}/{progress.total}ページを解析中
              </small>
            </div>
          )}
        </section>
      )}

      {error && <p className="error-message">{error}</p>}

      {analysis && page && (
        <>
          <section className="summary-bar">
            <div className="file-summary">
              <span className="summary-file-icon" aria-hidden="true">PDF</span>
              <div>
                <strong>{analysis.fileName}</strong>
                <span>{analysis.pageCount}ページ</span>
              </div>
            </div>
            <div className={`review-status ${totalDetections === 0 ? "clear" : "found"}`}>
              <span className="status-indicator" aria-hidden="true" />
              <div>
                <strong>{totalDetections === 0 ? "検出なし" : `${totalDetections}件の確認候補`}</strong>
                <span>
                  {totalDetections === 0
                    ? "機械的な異常は見つかりませんでした"
                    : "右側の検出内容を確認してください"}
                </span>
              </div>
            </div>
            <div className="summary-actions">
              <button type="button" className="secondary" onClick={() => downloadReport(analysis)}>
                レポートを保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnalysis(null);
                  setSelectedDetectionId(null);
                }}
              >
                PDFを変更
              </button>
            </div>
          </section>

          <section className="workspace">
            <aside className="page-list" aria-label="ページ一覧">
              <span className="page-list-label">ページ</span>
              <div className="page-buttons" ref={pageButtonsRef}>
                {analysis.pages.map((item) => (
                  <button
                    key={item.pageNumber}
                    ref={selectedPage === item.pageNumber ? activePageRef : null}
                    className={selectedPage === item.pageNumber ? "active" : ""}
                    aria-current={selectedPage === item.pageNumber ? "page" : undefined}
                    aria-label={`${item.pageNumber}ページ${item.detections.length > 0 ? `、検出${item.detections.length}件` : ""}`}
                    title={`${item.pageNumber}ページ${item.detections.length > 0 ? `・検出${item.detections.length}件` : ""}`}
                    type="button"
                    onClick={() => selectPage(item.pageNumber)}
                  >
                    <span>{item.pageNumber}</span>
                    {item.detections.length > 0 && <b>{item.detections.length}</b>}
                  </button>
                ))}
              </div>
              <span className="page-list-total">全{analysis.pageCount}</span>
            </aside>

            <div className="preview-panel">
              <div className="preview-toolbar" aria-label="ページ移動">
                <div className="page-stepper">
                  <button
                    type="button"
                    aria-label="前のページ"
                    disabled={selectedPage <= 1}
                    onClick={() => selectPage(Math.max(1, selectedPage - 1))}
                  >
                    <svg className="page-chevron page-chevron-back" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M10 3.5 5.5 8 10 12.5" />
                    </svg>
                  </button>
                  <strong>{page.pageNumber}</strong>
                  <span>/ {analysis.pageCount}</span>
                  <button
                    type="button"
                    aria-label="次のページ"
                    disabled={selectedPage >= analysis.pageCount}
                    onClick={() => selectPage(Math.min(analysis.pageCount, selectedPage + 1))}
                  >
                    <svg className="page-chevron" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m6 3.5 4.5 4.5L6 12.5" />
                    </svg>
                  </button>
                </div>

                {detectionPages.length > 0 && (
                  <div className="detection-page-nav" aria-label="検出ページを巡回">
                    <span>検出ページ</span>
                    <button type="button" aria-label="前の検出ページ" onClick={() => jumpDetectionPage(-1)}>
                      <svg className="page-chevron page-chevron-back" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M10 3.5 5.5 8 10 12.5" />
                      </svg>
                    </button>
                    <strong>
                      {currentDetectionPageIndex >= 0 ? currentDetectionPageIndex + 1 : "–"}
                      <small>/ {detectionPages.length}</small>
                    </strong>
                    <button type="button" aria-label="次の検出ページ" onClick={() => jumpDetectionPage(1)}>
                      <svg className="page-chevron" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m6 3.5 4.5 4.5L6 12.5" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              <div className="preview-stage" ref={previewStageRef}>
                <div
                  className="page-preview"
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                >
                  <img src={page.previewUrl} alt={`${page.pageNumber}ページ目`} />
                  {page.detections.map((detection) => (
                    <button
                      key={detection.id}
                      ref={selectedDetectionId === detection.id ? selectedDetectionBoxRef : null}
                      className={`detection-box ${selectedDetectionId === detection.id ? "selected" : ""}`}
                      data-severity={detection.severity}
                      aria-label={`${detection.text}を選択`}
                      style={{
                        left: `${(detection.box.x / page.width) * 100}%`,
                        top: `${(detection.box.y / page.height) * 100}%`,
                        width: `${Math.max(1, (detection.box.width / page.width) * 100)}%`,
                        height: `${Math.max(1, (detection.box.height / page.height) * 100)}%`,
                      }}
                      type="button"
                      onClick={() => setSelectedDetectionId(detection.id)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <aside className="results-panel">
              <div className="results-heading">
                <div>
                  <h2>このページの検出</h2>
                  <p>枠または項目を選ぶと根拠を確認できます</p>
                </div>
                <span>{page.detections.length}件</span>
              </div>
              {analysis.documentDetections.length > 0 && (
                <section className="document-detections" aria-label="文書情報の検出">
                  <div className="document-detections-heading">
                    <div>
                      <strong>文書情報</strong>
                      <span>ページに表示されないPDFプロパティ</span>
                    </div>
                    <b>{analysis.documentDetections.length}件</b>
                  </div>
                  {analysis.documentDetections.map((detection) => (
                    <DocumentDetectionCard
                      key={detection.id}
                      detection={detection}
                    />
                  ))}
                </section>
              )}
              {page.detections.length === 0 ? (
                <div className="empty-result">
                  <span className="empty-icon" aria-hidden="true">✓</span>
                  <strong>このページは検出なし</strong>
                  <p>機械的な異常は見つかりませんでした。</p>
                </div>
              ) : (
                <div className="detection-list">
                  {page.detections.map((detection) => (
                    <DetectionCard
                      key={detection.id}
                      detection={detection}
                      selected={detection.id === selectedDetectionId}
                      onSelect={() => setSelectedDetectionId(detection.id)}
                    />
                  ))}
                </div>
              )}
              {selectedDetection && (
                <div className="evidence-panel">
                  <h3>選択中の判定根拠</h3>
                  {selectedDetection.signals.map((signal) => (
                    <div key={signal.kind}>
                      <strong>{signal.label} <span>+{signal.score}</span></strong>
                      <p>{signal.detail}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="results-note">
                検出は機械的な手掛かりです。内容を確認して判断してください。
              </p>
              {totalDetections > 0 && (
                <section className="raster-followup" aria-label="検出後の対応">
                  <div>
                    <span>次の対応</span>
                    <strong>非表示文字を除去したい場合</strong>
                    <p>全ページを画像化し、文字レイヤーを持たないPDFとして再構成できます。</p>
                  </div>
                  <a
                    href="https://minoru-s.github.io/pdf-raster-exporter/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    画像PDFに変換
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 11 11 5M6 5h5v5" />
                    </svg>
                  </a>
                  <small>新しいタブで開きます。PDFはもう一度選択してください。</small>
                </section>
              )}
            </aside>
          </section>
        </>
      )}

      {isAboutOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeAbout();
          }}
        >
          <section
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <header className="modal-header">
              <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
              <div>
                <h2 id="about-title">PDFender</h2>
                <p>このツールについて</p>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="閉じる"
                autoFocus
                onClick={closeAbout}
              >
                ×
              </button>
            </header>
            <div className="modal-body">
              <p>
                PDF内の見えにくい文字、極端に小さい文字、圧縮された文字、後続オブジェクトに隠された文字などを、PDFの描画情報から確認するための静的解析ツールです。
              </p>
              <a
                className="learn-more-link"
                href={`${import.meta.env.BASE_URL}guide/index.html`}
                target="_blank"
                rel="noopener noreferrer"
              >
                検出方式をもっと詳しく
                <span aria-hidden="true">↗</span>
              </a>

              <section className="modal-section">
                <h3>免責事項</h3>
                <p>
                  検出結果は機械的な手掛かりであり、PDFの安全性やプロンプトインジェクションの有無を保証するものではありません。誤検知や見逃しが発生する可能性があります。
                </p>
                <p>
                  本ツールの利用はご自身の責任で行ってください。本ツールの利用によって生じたデータ損失、判断の誤り、動作不良その他の損害について、製作者は責任を負いません。重要な用途では元のPDFと検出箇所を必ず確認してください。
                </p>
              </section>

              <section className="modal-section">
                <h3>データの取り扱い</h3>
                <p>
                  <strong>選択したPDFの読み込み、描画、文字情報の解析、検出結果の生成は、すべてこのブラウザ内で完結します。</strong>PDFの内容、抽出した文字列、検出結果を外部サーバーへ送信する処理はありません。
                </p>
                <p>
                  サイトの利用状況を把握するため、Google Analyticsを使用しています。ページの閲覧情報やブラウザ・端末に関する情報などが匿名化された形でGoogleへ送信されることがありますが、入力したPDFの内容、抽出した文字列、検出結果などがお使いの端末から外部に送信されることは一切ありません．
                </p>
                <div className="modal-privacy">
                  <span aria-hidden="true">✓</span>
                  <strong>PDF本文・抽出文字・検出結果は送信されません</strong>
                </div>
              </section>

              <section className="modal-section">
                <h3>開発者情報</h3>
                <dl className="developer-info">
                  <div><dt>製作者</dt><dd>西藤 実</dd></div>
                  <div><dt>所属</dt><dd>中央大学 國井研究室 → 東京科学大学 長谷川研究室</dd></div>
                  <div>
                    <dt>リポジトリ</dt>
                    <dd>
                      <a
                        href="https://github.com/minoru-s/pdf-injection-detector"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub
                      </a>
                    </dd>
                  </div>
                  <div><dt>バージョン</dt><dd>0.1.0</dd></div>
                </dl>
              </section>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
