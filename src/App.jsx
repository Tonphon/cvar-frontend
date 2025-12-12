import { useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const DEFAULT_CONFIG = {
  lookback_days: 504,
  train_ratio: 0.7,

  alpha: 0.05,
  objective: "min_cvar",
  lambda: 0.5,

  long_only: true,
  w_max: 0.6,
  turnover_max: 0.5,

  transaction_cost_bps: 10.0,

  seed: 42,
  iters: 4000,
  step_size: 0.05,
  init_temp: 1.0,
  final_temp: 0.001,

  penalty_turnover: 50.0,
  penalty_invalid: 1000000.0,
};

const FIELD_HELP = {
  lookback_days: "How many past trading days to use (e.g., 504 ≈ ~2 years).",
  train_ratio: "Fraction of the window used for optimization. The rest is test (recent).",
  alpha: "CVaR tail level. 0.05 means 'worst 5% days'.",
  objective: "min_cvar = focus only on crash risk. mean_minus_lambda_cvar balances return vs tail risk.",
  lambda: "Risk aversion. Higher lambda = more defensive portfolio (only used in mean_minus_lambda_cvar).",
  w_max: "Max weight per asset (caps concentration). Must be ≥ 1/N for feasibility.",
  turnover_max: "Max total rebalancing amount. Lower = less trading.",
  transaction_cost_bps: "Trading cost in basis points (10 bps = 0.10%) per 1.0 turnover.",
  iters: "Simulated annealing iterations. More = better search but slower.",
  step_size: "How big each random move in weights is.",
  init_temp: "Start temperature (more exploration).",
  final_temp: "End temperature (more exploitation).",
  seed: "Random seed (repeatable results).",
  penalty_turnover: "How hard we punish exceeding turnover_max.",
};

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function makeTemplateCSV() {
  return `date,SPY.US,GLD.US,AAPL.US,MSFT.US
2020-04-15,0.70,0.15,0.10,0.05
`;
}

function makeDemoCSV() {
  return `date,SPY.US,GLD.US,TLT.US
2020-03-20,0.70,0.10,0.20
`;
}

function num(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export default function App() {
  const [portfolioFile, setPortfolioFile] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const [doMemo, setDoMemo] = useState(false);
  const [memoModel, setMemoModel] = useState("");

  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [memo, setMemo] = useState(null);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const runUrlBase = useMemo(() => (runId ? `${API_BASE}/runs/${runId}` : ""), [runId]);
  const cacheBust = useMemo(() => `t=${Date.now()}`, [runId, status?.status]);

  function updateConfig(key, value) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  function resetDefaults() {
    setConfig(DEFAULT_CONFIG);
    setDoMemo(false);
    setMemoModel("");
  }

  async function startRun() {
    setLog("");
    setSummary(null);
    setMemo(null);
    setStatus(null);
    setRunId("");

    if (!portfolioFile) {
      setLog("Please upload portfolio.csv first.");
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("portfolio", portfolioFile);
      fd.append("config_json", JSON.stringify(config));
      fd.append("do_memo", doMemo ? "true" : "false");
      if (memoModel.trim()) fd.append("memo_model", memoModel.trim());

      const res = await fetch(`${API_BASE}/api/runs`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`POST /api/runs failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      setRunId(data.run_id);

      await pollUntilDone(data.run_id);
    } catch (e) {
      setLog(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function pollUntilDone(id) {
    setLog("Run started. Polling status...");
    const maxMs = doMemo ? 240000 : 180000;
    const start = Date.now();

    while (true) {
      const res = await fetch(`${API_BASE}/api/runs/${id}`);
      if (!res.ok) throw new Error(`GET /api/runs/${id} failed: ${res.status}`);
      const st = await res.json();
      setStatus(st);

      if (st.status === "done") {
        setLog("Done! Fetching summary...");
        await fetchSummary(id);
        if (doMemo) {
          setLog("Fetching LLM memo...");
          await fetchMemo(id);
        } else {
          setLog("Done.");
        }
        return;
      }

      if (st.status === "error") {
        setLog(`Error: ${st.error || "unknown error"}`);
        return;
      }

      if (Date.now() - start > maxMs) {
        setLog("Timed out waiting for run to finish (check server logs).");
        return;
      }

      await new Promise((r) => setTimeout(r, 800));
    }
  }

  async function fetchSummary(id) {
    const res = await fetch(`${API_BASE}/api/runs/${id}/summary`);
    if (!res.ok) throw new Error(`GET /summary failed: ${res.status}`);
    setSummary(await res.json());
  }

  async function fetchMemo(id) {
    const res = await fetch(`${API_BASE}/api/runs/${id}/memo`);
    if (!res.ok) throw new Error(`GET /memo failed: ${res.status} ${await res.text()}`);
    setMemo(await res.json());
    setLog("Done.");
  }

  function artifactsLinks() {
    if (!status?.files?.length || !runUrlBase) return null;
    const important = [
      "summary.json",
      "weights_opt.csv",
      "trades.csv",
      "objective_history.csv",
      "portfolio_returns_full.csv",
    ];
    return (
      <div className="space-y-2">
        <div className="font-semibold">Downloads</div>
        <div className="flex flex-wrap gap-2">
          {important.map((p) => (
            <a
              key={p}
              className="px-3 py-1.5 rounded-xl bg-blue-200 text-white text-sm hover:bg-blue-700 transition-colors"
              href={`${runUrlBase}/${p}`}
              target="_blank"
              rel="noreferrer"
            >
              {p}
            </a>
          ))}
        </div>
      </div>
    );
  }

  // Auto-detect figures from backend response
  const plots = useMemo(() => {
    if (!status?.files?.length) return [];
    
    // Filter for figure files
    const figureFiles = status.files.filter(f => f.startsWith('figures/') && f.endsWith('.png'));
    
    // Convert filename to readable title
    const makeTitle = (path) => {
      const filename = path.replace('figures/', '').replace('.png', '');
      // Convert snake_case to Title Case
      return filename
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };
    
    return figureFiles.map(path => ({
      title: makeTitle(path),
      path: path
    }));
  }, [status?.files]);

  const memoObj = useMemo(() => {
    if (!memo) return null;
    try {
      return typeof memo === "string" ? JSON.parse(memo) : memo;
    } catch {
      return null;
    }
  }, [memo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="w-full max-w-5xl mx-auto px-4 py-8">
        <div className="space-y-6">
          <header className="text-center py-6">
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Portfolio Optimizer</h1>
            <p className="text-slate-600">CVaR-based portfolio optimization with simulated annealing</p>
          </header>

          {/* Upload */}
          <section className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">1) Upload portfolio.csv</h2>
            <p className="text-sm text-slate-600">
              Format: <code className="bg-slate-100 px-2 py-0.5 rounded">date</code>, then asset columns with
              initial weights. First row is header. Second row is the start date.
            </p>

            <input
              type="file"
              accept=".csv"
              onChange={(e) => setPortfolioFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 file:transition-colors"
            />

            {portfolioFile && (
              <div className="text-sm text-slate-700 bg-green-50 border border-green-200 rounded-xl p-3">
                ✓ Loaded: <span className="font-semibold">{portfolioFile.name}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => downloadTextFile("portfolio_template.csv", makeTemplateCSV())}
                className="px-4 py-2 rounded-xl bg-slate-600 text-white text-sm hover:bg-slate-700 transition-colors"
              >
                Download template
              </button>
              <button
                onClick={() => downloadTextFile("portfolio_demo.csv", makeDemoCSV())}
                className="px-4 py-2 rounded-xl bg-slate-600 text-white text-sm hover:bg-slate-700 transition-colors"
              >
                Download demo
              </button>
            </div>
          </section>

          {/* Config */}
          <section className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">2) Configuration</h2>
              <button
                onClick={resetDefaults}
                className="px-4 py-2 rounded-xl bg-slate-600 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
              >
                Reset defaults
              </button>
            </div>

            <div className="space-y-4">
              <ConfigCard title="Data window">
                <Field label="lookback_days" help={FIELD_HELP.lookback_days} value={config.lookback_days} step="1"
                       onChange={(v) => updateConfig("lookback_days", Math.max(50, Math.floor(num(v, 504))))} />
                <Field label="train_ratio" help={FIELD_HELP.train_ratio} value={config.train_ratio} step="0.05"
                       onChange={(v) => updateConfig("train_ratio", Math.min(0.9, Math.max(0.5, num(v, 0.7))))} />
              </ConfigCard>

              <ConfigCard title="Risk objective">
                <Select
                  label="objective"
                  help={FIELD_HELP.objective}
                  value={config.objective}
                  onChange={(v) => updateConfig("objective", v)}
                  options={[
                    { value: "min_cvar", label: "min_cvar (minimize tail risk)" },
                    { value: "mean_minus_lambda_cvar", label: "mean_minus_lambda_cvar (return − λ·risk)" },
                  ]}
                />
                <Field label="alpha" help={FIELD_HELP.alpha} value={config.alpha} step="0.01"
                       onChange={(v) => updateConfig("alpha", Math.min(0.2, Math.max(0.01, num(v, 0.05))))} />
                <Field label="lambda" help={FIELD_HELP.lambda} value={config.lambda} step="0.1"
                       disabled={config.objective !== "mean_minus_lambda_cvar"}
                       onChange={(v) => updateConfig("lambda", Math.max(0, num(v, 0.5)))} />
              </ConfigCard>

              <ConfigCard title="Constraints & cost">
                <Field label="w_max" help={FIELD_HELP.w_max} value={config.w_max} step="0.05"
                       onChange={(v) => updateConfig("w_max", Math.min(1, Math.max(0.05, num(v, 0.6))))} />
                <Field label="turnover_max" help={FIELD_HELP.turnover_max} value={config.turnover_max} step="0.05"
                       onChange={(v) => updateConfig("turnover_max", Math.min(2, Math.max(0, num(v, 0.5))))} />
                <Field label="transaction_cost_bps" help={FIELD_HELP.transaction_cost_bps} value={config.transaction_cost_bps} step="1"
                       onChange={(v) => updateConfig("transaction_cost_bps", Math.max(0, num(v, 10)))} />
              </ConfigCard>

              <ConfigCard title="Simulated annealing">
                <Field label="iters" help={FIELD_HELP.iters} value={config.iters} step="500"
                       onChange={(v) => updateConfig("iters", Math.max(200, Math.min(20000, Math.floor(num(v, 4000)))))} />
                <Field label="step_size" help={FIELD_HELP.step_size} value={config.step_size} step="0.01"
                       onChange={(v) => updateConfig("step_size", Math.max(0.001, Math.min(0.5, num(v, 0.05))))} />
                <Field label="init_temp" help={FIELD_HELP.init_temp} value={config.init_temp} step="0.1"
                       onChange={(v) => updateConfig("init_temp", Math.max(0.001, num(v, 1.0)))} />
                <Field label="final_temp" help={FIELD_HELP.final_temp} value={config.final_temp} step="0.0005"
                       onChange={(v) => updateConfig("final_temp", Math.max(0.000001, num(v, 0.001)))} />
                <Field label="seed" help={FIELD_HELP.seed} value={config.seed} step="1"
                       onChange={(v) => updateConfig("seed", Math.floor(num(v, 42)))} />
                <Field label="penalty_turnover" help={FIELD_HELP.penalty_turnover} value={config.penalty_turnover} step="5"
                       onChange={(v) => updateConfig("penalty_turnover", Math.max(0, num(v, 50)))} />
              </ConfigCard>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t">
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input
                  id="memo"
                  type="checkbox"
                  checked={doMemo}
                  onChange={(e) => setDoMemo(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                Generate "Quant Risk Assistant" memo (costs tokens)
              </label>

              <input
                className="sm:ml-auto w-full sm:w-72 px-3 py-2 rounded-xl border bg-white text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                placeholder="memo model (optional, e.g. gpt-4o-mini)"
                value={memoModel}
                onChange={(e) => setMemoModel(e.target.value)}
                disabled={!doMemo}
              />
            </div>
          </section>

          {/* Run */}
          <section className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">3) Run</h2>

            <button
              onClick={startRun}
              disabled={busy}
              className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "Running..." : "Run optimizer"}
            </button>

            <div className="text-sm text-slate-700 space-y-2">
              {log && <div className="whitespace-pre-wrap bg-slate-50 p-3 rounded-xl">{log}</div>}
              {runId && (
                <div className="text-slate-600">
                  run_id: <code className="bg-slate-100 px-2 py-0.5 rounded">{runId}</code>
                </div>
              )}
              {status && (
                <div>
                  status: <span className="font-semibold">{status.status}</span>
                  {status.error && <div className="text-red-600 mt-2 bg-red-50 p-3 rounded-xl">Error: {status.error}</div>}
                </div>
              )}
            </div>
          </section>

          {/* Results */}
          {status?.status === "done" && (
            <section className="bg-white rounded-2xl shadow-sm border p-6 space-y-6">
              <h2 className="text-lg font-semibold text-slate-900">4) Results</h2>
              {artifactsLinks()}

              {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <Stat title="Objective" value={summary.objective} />
                  <Stat title="Alpha" value={summary.alpha} />
                  <Stat title="Turnover" value={Number(summary.turnover).toFixed(4)} />
                  <Stat title="Train CVaR" value={Number(summary.train?.cvar).toFixed(4)} />
                  <Stat title="Test CVaR" value={Number(summary.test?.cvar).toFixed(4)} />
                  <Stat title="Test Mean" value={Number(summary.test?.mean).toFixed(6)} />
                </div>
              )}

              {plots.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {plots.map((p) => (
                    <PlotImage
                      key={p.path}
                      title={p.title}
                      src={`${runUrlBase}/${p.path}?${cacheBust}`}
                    />
                  ))}
                </div>
              )}

              {doMemo && memoObj && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="text-2xl">📊</div>
                    <h3 className="text-xl font-bold text-slate-900">Quant Risk Assistant</h3>
                  </div>
                  
                  {/* Headline */}
                  {memoObj.memo?.headline && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="text-base font-semibold text-blue-900">
                        {memoObj.memo.headline}
                      </div>
                    </div>
                  )}

                  {/* Key Findings */}
                  {memoObj.memo?.key_findings && Array.isArray(memoObj.memo.key_findings) && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="text-sm font-bold text-slate-900 mb-3">Key Findings</div>
                      <ul className="space-y-2">
                        {memoObj.memo.key_findings.map((finding, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-blue-600 font-bold">•</span>
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Risk Story */}
                  {memoObj.memo?.risk_story && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="text-sm font-bold text-slate-900 mb-2">Risk Story</div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {memoObj.memo.risk_story}
                      </p>
                    </div>
                  )}

                  {/* Return Story */}
                  {memoObj.memo?.return_story && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="text-sm font-bold text-slate-900 mb-2">Return Story</div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {memoObj.memo.return_story}
                      </p>
                    </div>
                  )}

                  {/* Crash Days Commentary */}
                  {memoObj.memo?.crash_days_commentary && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="text-sm font-bold text-slate-900 mb-2">Crash Days Analysis</div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {memoObj.memo.crash_days_commentary}
                      </p>
                    </div>
                  )}

                  {/* Limitations */}
                  {memoObj.memo?.limitations && Array.isArray(memoObj.memo.limitations) && (
                    <div className="bg-white rounded-xl p-4 border border-yellow-200">
                      <div className="text-sm font-bold text-slate-900 mb-3">Limitations</div>
                      <ul className="space-y-2">
                        {memoObj.memo.limitations.map((limitation, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-yellow-600 font-bold">•</span>
                            <span>{limitation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Next Experiments */}
                  {memoObj.memo?.next_experiments && Array.isArray(memoObj.memo.next_experiments) && (
                    <div className="bg-white rounded-xl p-4 border border-green-200">
                      <div className="text-sm font-bold text-slate-900 mb-3">Next Experiments</div>
                      <ul className="space-y-2">
                        {memoObj.memo.next_experiments.map((experiment, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-green-600 font-bold">•</span>
                            <span>{experiment}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Model info */}
                  {memoObj.model && (
                    <div className="text-xs text-slate-500 text-right pt-2">
                      Generated by: {memoObj.model}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigCard({ title, children }) {
  return (
    <div className="border rounded-2xl p-4 bg-slate-50">
      <div className="font-semibold mb-3 text-slate-900">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, help, value, onChange, step = "1", disabled = false }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-700 flex items-center gap-2">
        <span>{label}</span>
        {help && <InfoTip text={help} />}
      </label>
      <input
        className="w-full px-3 py-2 rounded-xl border bg-white disabled:bg-slate-100 disabled:text-slate-500 text-slate-900"
        value={value}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        type="number"
      />
    </div>
  );
}

function Select({ label, help, value, onChange, options }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-700 flex items-center gap-2">
        <span>{label}</span>
        {help && <InfoTip text={help} />}
      </label>
      <select
        className="w-full px-3 py-2 rounded-xl border bg-white text-slate-900"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function InfoTip({ text }) {
  return (
    <span className="relative group inline-flex items-center">
      <span className="w-5 h-5 rounded-full bg-blue-100 border border-blue-300 text-[11px] font-bold text-blue-700 flex items-center justify-center cursor-help">
        i
      </span>
      <span className="absolute left-0 top-6 z-10 hidden group-hover:block w-64 p-3 rounded-xl border border-slate-200 bg-white shadow-lg text-xs text-slate-800">
        {text}
      </span>
    </span>
  );
}

function PlotImage({ title, src }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  const handleRetry = () => {
    setLoading(true);
    setError(false);
    setRetryCount(prev => prev + 1);
  };

  return (
    <div className="border rounded-2xl p-3 bg-slate-50">
      <div className="text-sm font-semibold mb-2 text-slate-900">{title}</div>
      <div className="relative w-full rounded-xl bg-white border overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
            <div className="text-sm text-slate-500">Loading...</div>
          </div>
        )}
        {error ? (
          <div className="p-8 text-center">
            <div className="text-sm text-red-600 mb-3">Failed to load image</div>
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            key={`${src}-${retryCount}`}
            className="w-full"
            src={src}
            alt={title}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ title, value }) {
  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 border rounded-2xl p-4">
      <div className="text-xs text-slate-600 mb-1">{title}</div>
      <div className="text-lg font-bold text-slate-900">{String(value)}</div>
    </div>
  );
}