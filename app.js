// cytotype — browser-side inference (WASM ONNX + h5wasm)
// Everything runs locally; nothing is uploaded.

import h5wasm from "https://cdn.jsdelivr.net/npm/h5wasm@0.7.8/+esm";

const State = {
  selectedRef: "ts_blood",   // what the user CHOSE
  loadedRef: null,           // what is actually loaded into ortSession (and refMeta/classes/etc)
  refMeta: null,
  ortSession: null,
  // Indexed-by-tuple-string lookup of hash catalog
  hashLookup: null,
  classes: [],
  hvgVarNames: [],
  geneSymbols: [],
  arcfaceScale: 64.0,
  result: null,
  classFilter: null,
  textFilter: "",
  sort: "conf-desc",
  selectedCellId: null,
  debug: localStorage.getItem("ct.debug") === "1",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showStage(name) {
  $$(".stage").forEach((s) => s.classList.remove("active"));
  const el = $(`#stage-${name}`);
  if (el) el.classList.add("active");
  document.body.dataset.stage = name;
  // Sync URL hash so the browser back button "just works" and the URL
  // is meaningful. We use replaceState while inside the same logical run
  // (e.g. processing -> results) and pushState only when leaving via the nav.
  const target = name === "upload" ? "" : `#/${name}`;
  if (location.hash !== target) {
    history.replaceState({stage: name}, "", target || location.pathname);
  }
}

function navigateHome() {
  // Reset state and push a real history entry so the back button works.
  State.result = null; State.classFilter = null; State.textFilter = "";
  State.selectedCellId = null;
  document.body.classList.remove("has-gt");
  const fi = $("#file-input"); if (fi) fi.value = "";
  history.pushState({stage: "upload"}, "", location.pathname);
  showStage("upload");
}

// hashchange / popstate — react to back/forward buttons
window.addEventListener("popstate", (e) => {
  const stage = (location.hash.replace(/^#\/?/, "") || "upload");
  if (stage === "upload") {
    // Don't run navigateHome's pushState; just show the stage.
    document.body.classList.remove("has-gt");
    showStage("upload");
  } else if (stage === "results" && State.result) {
    showStage("results");
  } else {
    showStage("upload");
  }
});
function setStep(step, state) {
  const el = document.querySelector(`.step[data-step="${step}"]`);
  if (!el) return;
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}
function setProc(title, detail, percent) {
  $("#proc-title").textContent = title;
  $("#proc-detail").textContent = detail || "";
  if (percent !== undefined) $("#progress-fill").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Configure ORT to use the JSDelivr-hosted WASM files (matches script version)
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";

// ---- model + reference loading ----
async function loadReference(refId) {
  // Guard against the wrong model staying loaded after the user picks a
  // different reference. Compare against `loadedRef` (what is actually in the
  // session), not `selectedRef` (what the user just chose).
  if (State.loadedRef === refId && State.refMeta && State.ortSession) return;
  console.log(`[ct] loading reference: ${refId} (was: ${State.loadedRef || "none"})`);
  setStep("model", "active");
  setProc("Loading model…", "downloading reference bundle (one-time)", 5);

  // Fetch web_meta.json with progress tracking
  const metaResp = await fetch(`refs/${refId}/web_meta.json`);
  const metaTotal = +metaResp.headers.get("content-length") || 0;
  const metaReader = metaResp.body.getReader();
  const metaChunks = [];
  let metaLoaded = 0;
  while (true) {
    const { done, value } = await metaReader.read();
    if (done) break;
    metaChunks.push(value);
    metaLoaded += value.length;
    if (metaTotal) setProc("Loading model…", `metadata ${(metaLoaded/1e6).toFixed(1)}/${(metaTotal/1e6).toFixed(1)} MB`, 5 + 30 * (metaLoaded / metaTotal));
  }
  const metaBlob = new Blob(metaChunks);
  const metaText = await metaBlob.text();
  const meta = JSON.parse(metaText);
  State.refMeta = meta;
  State.classes = meta.classes;
  State.hvgVarNames = meta.hvg_var_names;
  State.geneSymbols = meta.gene_symbols;
  State.arcfaceScale = meta.arcface_scale || 64.0;
  $("#ref-meta").textContent = `reference: ${refId} · ${meta.n_classes} classes · ${meta.n_genes} HVG`;
  $("#ref-desc").textContent = meta.description || "";

  // Build the hash lookup: Map<"g0|g1|g2|g3", number[]>
  setProc("Loading model…", "indexing marker catalog", 35);
  await new Promise((r) => setTimeout(r, 0));
  const lookup = new Map();
  const keys = meta.hash_keys;
  const cls = meta.hash_classes;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    lookup.set(`${k[0]}|${k[1]}|${k[2]}|${k[3]}`, cls[i]);
  }
  State.hashLookup = lookup;

  // Fetch ONNX with progress
  setProc("Loading model…", "downloading neural model", 45);
  const onnxResp = await fetch(`refs/${refId}/encoder_head.onnx`);
  const onnxTotal = +onnxResp.headers.get("content-length") || 0;
  const onnxReader = onnxResp.body.getReader();
  const onnxChunks = [];
  let onnxLoaded = 0;
  while (true) {
    const { done, value } = await onnxReader.read();
    if (done) break;
    onnxChunks.push(value);
    onnxLoaded += value.length;
    if (onnxTotal) setProc("Loading model…", `model ${(onnxLoaded/1e6).toFixed(1)}/${(onnxTotal/1e6).toFixed(1)} MB`, 45 + 35 * (onnxLoaded / onnxTotal));
  }
  const onnxBlob = new Blob(onnxChunks);
  const onnxBuf = await onnxBlob.arrayBuffer();

  setProc("Loading model…", "initialising ORT session", 85);
  State.ortSession = await ort.InferenceSession.create(onnxBuf, {
    executionProviders: ["wasm"],
  });
  State.loadedRef = refId;
  console.log(`[ct] reference loaded: ${refId} (${State.classes.length} classes, ${State.hashLookup.size} catalog entries)`);
  setStep("model", "done");
  setProc("Model loaded.", "", 100);
}

// ---- h5ad parsing ----
async function parseH5ad(file) {
  setStep("parse", "active");
  setProc("Parsing .h5ad…", `${file.name} (${(file.size/1e6).toFixed(1)} MB)`, 15);
  const { FS } = await h5wasm.ready;
  const buf = new Uint8Array(await file.arrayBuffer());
  const fname = "/upload.h5ad";
  // Wipe any prior upload from the in-memory FS
  try { FS.unlink(fname); } catch {}
  FS.writeFile(fname, buf);
  const f = new h5wasm.File(fname, "r");

  // X: dense or sparse CSR. Tabula Sapiens layout uses CSR ('X' is a group with data/indices/indptr)
  const xNode = f.get("X");
  let X, nObs, nVar;
  if (xNode.type === "Dataset") {
    // dense
    const Xds = xNode;
    const shape = Xds.shape; // [n_obs, n_var]
    nObs = shape[0]; nVar = shape[1];
    X = { kind: "dense", data: Xds.value, n_obs: nObs, n_var: nVar };
  } else {
    // CSR group
    const data = f.get("X/data").value;
    const indices = f.get("X/indices").value;
    const indptr = f.get("X/indptr").value;
    // Try to read shape from group attrs
    const attrs = xNode.attrs || {};
    let shape = attrs["shape"]?.value || attrs["h5sparse_shape"]?.value;
    if (!shape) {
      // fallback: try from obs / var
      const nObsGuess = (indptr.length - 1);
      const nVarGuess = Math.max(...indices) + 1;
      shape = [nObsGuess, nVarGuess];
    }
    nObs = Number(shape[0]); nVar = Number(shape[1]);
    X = { kind: "csr", data, indices, indptr, n_obs: nObs, n_var: nVar };
  }

  // var names: var/_index or var/index
  let varNames;
  for (const name of ["var/_index", "var/index"]) {
    try { varNames = f.get(name).value; break; } catch {}
  }
  if (!varNames) {
    // Last resort: look in var group for an obvious name
    const varGroup = f.get("var");
    for (const k of varGroup.keys()) {
      if (/^(_?index|gene_id|ensembl)/.test(k)) {
        varNames = f.get(`var/${k}`).value; break;
      }
    }
  }
  if (!varNames) throw new Error("could not find gene names in adata.var");
  const varNameStrs = Array.from(varNames).map(String);

  // obs names
  let obsNames;
  for (const name of ["obs/_index", "obs/index"]) {
    try { obsNames = f.get(name).value; break; } catch {}
  }
  const obsNameStrs = obsNames ? Array.from(obsNames).map(String) : [...Array(nObs).keys()].map(i => `cell_${i}`);

  // Try to find a gene symbol column
  let geneSymbols = null;
  for (const candidate of ["gene_symbol", "feature_name", "gene_symbols", "symbol"]) {
    try {
      const g = f.get(`var/${candidate}`);
      if (g) { geneSymbols = Array.from(g.value).map(String); break; }
    } catch {}
  }

  // Try to find a ground-truth label column (for debug mode).
  // h5ad stores categorical columns as a Group with `codes` (int array) and
  // `categories` (string array). Older / non-categorical layouts store a flat
  // string array directly. Handle both robustly across h5wasm value shapes.
  const gtCandidates = ["cell_type", "cell_ontology_class", "ground_truth", "ct_truth",
                        "manual_annotation", "true_class", "cell_type_tagged", "celltype"];
  let groundTruth = null; let gtColumn = null;

  // Coerce arbitrary h5wasm output (string, TypedArray, Uint8Array, JsArray
  // of strings, etc) to a proper string array. h5wasm returns different
  // shapes depending on the HDF5 dtype.
  const _decoder = new TextDecoder("utf-8");
  function coerceStringArray(v) {
    if (v == null) return null;
    // Already an Array of strings — common for variable-length UTF-8 vlen arrays
    if (Array.isArray(v)) {
      return v.map(x => {
        if (typeof x === "string") return x;
        if (x instanceof Uint8Array) return _decoder.decode(x).replace(/\0+$/, "");
        return String(x ?? "");
      });
    }
    // ArrayBufferView (e.g. Uint8Array of fixed-length strings) — split by null bytes.
    if (ArrayBuffer.isView(v)) {
      // Heuristic: if length is much larger than expected, treat as packed bytes.
      const bytes = v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const text = _decoder.decode(bytes);
      const parts = text.split("\0").filter(s => s.length > 0);
      return parts;
    }
    // Single string
    if (typeof v === "string") return [v];
    return null;
  }

  function readObsLabels(name) {
    let node;
    try { node = f.get(`obs/${name}`); }
    catch (e) { return null; }
    if (!node) return null;

    // Strategy A: try categorical group (codes + categories children) by
    // direct path access — works whether `node` reports as Group or Dataset.
    try {
      const codesNode = f.get(`obs/${name}/codes`);
      const catsNode = f.get(`obs/${name}/categories`);
      if (codesNode && catsNode) {
        const codesRaw = codesNode.value;
        const catsRaw = catsNode.value;
        const cats = coerceStringArray(catsRaw);
        if (cats && cats.length > 0) {
          const codesArr = Array.from(codesRaw);
          const labels = codesArr.map(c => (c >= 0 && c < cats.length ? cats[c] : ""));
          if (labels.length > 0) {
            console.log(`[ct] obs/${name} parsed as categorical: ${labels.length} labels, ${cats.length} categories`);
            return labels;
          }
        }
      }
    } catch (e) {
      // fall through to strategy B
    }

    // Strategy B: try as a flat string dataset (older h5ad layout)
    try {
      const v = node.value;
      if (v != null) {
        const labels = coerceStringArray(v);
        if (labels && labels.length > 0) {
          console.log(`[ct] obs/${name} parsed as flat: ${labels.length} labels`);
          return labels;
        }
        console.log(`[ct] obs/${name} value shape unrecognised:`,
          {isArray: Array.isArray(v), isView: ArrayBuffer.isView(v), type: typeof v, ctor: v?.constructor?.name});
      }
    } catch (e) {
      console.warn(`[ct] readObsLabels(${name}) flat-dataset failed:`, e);
    }
    return null;
  }
  for (const candidate of gtCandidates) {
    const labels = readObsLabels(candidate);
    if (labels && labels.length === nObs && labels.some(s => s && s.length > 0)) {
      groundTruth = labels;
      gtColumn = candidate;
      console.log(`[ct] ground truth column: ${candidate} (${labels.length} cells, ${new Set(labels).size} unique). first 3:`, labels.slice(0, 3));
      break;
    }
  }
  if (!groundTruth) {
    console.log(`[ct] no recognised ground-truth column found in obs (tried ${gtCandidates.join(", ")})`);
  }

  setStep("parse", "done");
  return {
    X, nObs, nVar,
    varNames: varNameStrs,
    obsNames: obsNameStrs,
    geneSymbols,
    groundTruth, gtColumn,
  };
}

// ---- gene alignment ----
function alignToReference(parsed) {
  setStep("align", "active");
  setProc("Aligning genes to reference…", "", 50);
  const target = State.hvgVarNames;
  const nTarget = target.length;
  const targetSet = new Set(target);

  // Try multiple source candidates: var.index, gene_symbol
  const candidates = [
    { label: "var.index", names: parsed.varNames },
  ];
  if (parsed.geneSymbols) candidates.push({ label: "var.gene_symbol", names: parsed.geneSymbols });

  let best = null;
  for (const c of candidates) {
    let n = 0;
    for (const g of c.names) if (targetSet.has(g)) n++;
    if (best === null || n > best.n) best = { ...c, n };
  }
  const srcToIdx = new Map();
  best.names.forEach((g, i) => { if (!srcToIdx.has(g)) srcToIdx.set(g, i); });
  const colPicks = target.map(g => srcToIdx.has(g) ? srcToIdx.get(g) : -1);
  const nFound = colPicks.filter(i => i >= 0).length;

  // Build dense aligned matrix: (n_obs, n_target). Memory: 4 * n_obs * 2000 bytes = 8 MB per 1K cells.
  const nObs = parsed.nObs;
  const aligned = new Float32Array(nObs * nTarget);
  if (parsed.X.kind === "dense") {
    const D = parsed.X.data;
    const nVar = parsed.X.n_var;
    for (let r = 0; r < nObs; r++) {
      for (let j = 0; j < nTarget; j++) {
        const src = colPicks[j];
        if (src >= 0) aligned[r * nTarget + j] = Number(D[r * nVar + src]);
      }
    }
  } else {
    // CSR
    const { data, indices, indptr } = parsed.X;
    const targetCol = new Map();   // src col index -> target column index
    for (let j = 0; j < nTarget; j++) {
      const src = colPicks[j];
      if (src >= 0) targetCol.set(src, j);
    }
    for (let r = 0; r < nObs; r++) {
      const a = Number(indptr[r]); const b = Number(indptr[r + 1]);
      for (let p = a; p < b; p++) {
        const tj = targetCol.get(Number(indices[p]));
        if (tj !== undefined) aligned[r * nTarget + tj] = Number(data[p]);
      }
    }
  }
  setStep("align", "done");
  return { X: aligned, n_obs: nObs, n_var: nTarget,
           alignment: { source_column: best.label, n_target_hvg: nTarget, n_genes_found: nFound, fraction_found: nFound / nTarget } };
}

// ---- normalisation (mirror Python) ----
function detectInputKind(X, nVar) {
  // Sample first 100 rows
  const n = Math.min(100, X.length / nVar | 0);
  let max = 0; let nzCount = 0; let intLike = 0;
  for (let i = 0; i < n * nVar; i++) {
    const v = X[i];
    if (v > 0) {
      nzCount++;
      if (v > max) max = v;
      if (Math.abs(v - Math.round(v)) < 1e-6) intLike++;
    }
  }
  if (nzCount === 0) return "log";
  if (max > 50 && intLike / nzCount > 0.95) return "raw_counts";
  return "log";
}
function normaliseInPlace(X, nObs, nVar, kind, targetSum = 1e4) {
  if (kind === "log") return X;
  for (let r = 0; r < nObs; r++) {
    let sum = 0;
    const base = r * nVar;
    for (let j = 0; j < nVar; j++) sum += X[base + j];
    const scale = sum > 0 ? (targetSum / sum) : 1.0;
    for (let j = 0; j < nVar; j++) {
      const v = X[base + j] * scale;
      X[base + j] = Math.log1p(v);
    }
  }
  return X;
}

// ---- ONNX inference ----
async function runInference(X, nObs, nVar, batchSize = 256) {
  setStep("encode", "active");
  setProc("Encoding cells & classifying…", "", 65);
  const session = State.ortSession;
  const nClasses = State.classes.length;
  const cosines = new Float32Array(nObs * nClasses);
  for (let i0 = 0; i0 < nObs; i0 += batchSize) {
    const i1 = Math.min(nObs, i0 + batchSize);
    const bSize = i1 - i0;
    const inputBuf = X.subarray(i0 * nVar, i1 * nVar);
    const tensor = new ort.Tensor("float32", inputBuf, [bSize, nVar]);
    const outputs = await session.run({ input: tensor });
    const out = outputs.cosines.data; // Float32Array of length bSize * nClasses
    cosines.set(out, i0 * nClasses);
    if ((i0 / batchSize) % 4 === 0) {
      setProc("Encoding cells & classifying…", `${i1} / ${nObs}`,
              65 + 15 * (i1 / nObs));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  setStep("encode", "done");
  return cosines;
}

// ---- per-cell predictions + softmax confidence ----
function predictionsFromCosines(cosines, nObs, nClasses, scale) {
  const pred = new Int32Array(nObs);
  const alt = new Int32Array(nObs);
  const conf = new Float32Array(nObs);
  const exps = new Float32Array(nClasses);
  for (let r = 0; r < nObs; r++) {
    const off = r * nClasses;
    let mx = -Infinity, mxi = 0;
    for (let c = 0; c < nClasses; c++) {
      const v = cosines[off + c];
      if (v > mx) { mx = v; mxi = c; }
    }
    pred[r] = mxi;
    let sumE = 0;
    for (let c = 0; c < nClasses; c++) {
      const e = Math.exp((cosines[off + c] - mx) * scale);
      exps[c] = e; sumE += e;
    }
    conf[r] = exps[mxi] / sumE;
    let amx = -Infinity, ami = 0;
    for (let c = 0; c < nClasses; c++) {
      if (c === mxi) continue;
      if (exps[c] > amx) { amx = exps[c]; ami = c; }
    }
    alt[r] = ami;
  }
  return { pred, alt, conf };
}

// ---- per-cell marker audit ----
function cellAudit(rowExpr, predictedClassIdx) {
  const meta = State.refMeta;
  const panel = meta.type_marker_idx[predictedClassIdx];
  if (!panel) return { tuple: null, specificity: 0 };
  const thresh = meta.type_thresholds[predictedClassIdx];
  const present = [];
  for (let k = 0; k < panel.length; k++) {
    const idx = panel[k];
    if (rowExpr[idx] > thresh[k]) present.push([idx, rowExpr[idx]]);
  }
  if (present.length < 4) return { tuple: null, specificity: 0 };
  // Cap at top-12 by expression
  if (present.length > 12) {
    present.sort((a, b) => b[1] - a[1]);
    present.length = 12;
  }
  const cols = present.map(p => p[0]).sort((a, b) => a - b);
  let bestSpec = 0;
  let bestTuple = null;
  // C(n, 4) up to C(12,4)=495
  for (let a = 0; a < cols.length - 3; a++) {
    for (let b = a + 1; b < cols.length - 2; b++) {
      for (let c = b + 1; c < cols.length - 1; c++) {
        for (let d = c + 1; d < cols.length; d++) {
          const key = `${cols[a]}|${cols[b]}|${cols[c]}|${cols[d]}`;
          const types = State.hashLookup.get(key);
          if (!types) continue;
          if (!types.includes(predictedClassIdx)) continue;
          const spec = 1.0 / Math.max(1, types.length);
          if (spec > bestSpec) {
            bestSpec = spec;
            bestTuple = [cols[a], cols[b], cols[c], cols[d]];
          }
        }
      }
    }
  }
  if (!bestTuple) return { tuple: null, specificity: 0 };
  const symbols = bestTuple.map(i => State.geneSymbols[i] || State.hvgVarNames[i]);
  return { tuple: symbols.join("|"), specificity: bestSpec };
}

function runAudit(X, nObs, nVar, pred) {
  setStep("audit", "active");
  setProc("Extracting marker evidence…", "", 80);
  const evidence = new Array(nObs).fill("");
  const specificity = new Float32Array(nObs);
  for (let r = 0; r < nObs; r++) {
    const row = X.subarray(r * nVar, (r + 1) * nVar);
    const { tuple, specificity: spec } = cellAudit(row, pred[r]);
    if (tuple) { evidence[r] = tuple; specificity[r] = spec; }
  }
  setStep("audit", "done");
  return { evidence, specificity };
}

// ---- ground truth comparison ----
function buildGroundTruth(parsed, pred) {
  if (!parsed.groundTruth) {
    console.log("[ct] no ground truth in parsed h5ad");
    return null;
  }
  const cls = State.classes;
  // Build a normalized lookup so trailing nulls / whitespace mismatches
  // don't silently kill the match.
  const norm = (s) => String(s ?? "").replace(/\0/g, "").trim();
  const cls_to_idx = new Map(cls.map((c, i) => [norm(c), i]));
  const gtIdx = new Int32Array(parsed.nObs);
  let nWith = 0;
  const unmatched = new Set();
  for (let r = 0; r < parsed.nObs; r++) {
    const v = norm(parsed.groundTruth[r]);
    if (cls_to_idx.has(v)) { gtIdx[r] = cls_to_idx.get(v); nWith++; }
    else { gtIdx[r] = -1; if (unmatched.size < 3) unmatched.add(v); }
  }
  console.log(`[ct] GT match: ${nWith}/${parsed.nObs} cells (${(100*nWith/parsed.nObs).toFixed(1)}%)`);
  if (nWith === 0) {
    console.log(`[ct] sample unmatched labels: ${Array.from(unmatched).slice(0, 3).join(' | ')}`);
    console.log(`[ct] sample reference classes: ${cls.slice(0, 3).join(' | ')}`);
    return null;
  }
  let nCorrect = 0;
  for (let r = 0; r < parsed.nObs; r++) {
    if (gtIdx[r] >= 0 && gtIdx[r] === pred[r]) nCorrect++;
  }
  // Macro recall
  const perClass = {};
  for (let r = 0; r < parsed.nObs; r++) {
    if (gtIdx[r] < 0) continue;
    const g = gtIdx[r];
    if (!perClass[g]) perClass[g] = [0, 0];
    perClass[g][1]++;
    if (pred[r] === g) perClass[g][0]++;
  }
  const recalls = Object.values(perClass).map(([c, n]) => c / Math.max(1, n));
  const macro = recalls.reduce((a, b) => a + b, 0) / Math.max(1, recalls.length);
  return {
    column: parsed.gtColumn,
    n_with_gt: nWith,
    n_correct: nCorrect,
    top1_accuracy: nCorrect / nWith,
    macro_recall: macro,
    coverage: nWith / parsed.nObs,
    gtIdx, labels: parsed.groundTruth,
  };
}

// ---- top orchestration ----
async function annotate(file) {
  showStage("processing");
  try {
    await loadReference(State.selectedRef);
    const parsed = await parseH5ad(file);
    const aligned = alignToReference(parsed);
    const kind = detectInputKind(aligned.X, aligned.n_var);
    setProc("Normalising…", `input kind: ${kind}`, 60);
    normaliseInPlace(aligned.X, aligned.n_obs, aligned.n_var, kind);
    const cosines = await runInference(aligned.X, aligned.n_obs, aligned.n_var);
    const { pred, alt, conf } = predictionsFromCosines(cosines, aligned.n_obs, State.classes.length, State.arcfaceScale);
    const audit = runAudit(aligned.X, aligned.n_obs, aligned.n_var, pred);
    const gt = buildGroundTruth(parsed, pred);
    setStep("render", "active");
    setProc("Rendering…", "", 95);

    State.result = {
      summary: {
        n_cells: aligned.n_obs,
        reference: State.selectedRef,
        alignment_pct: aligned.alignment.fraction_found * 100,
        alignment_source: aligned.alignment.source_column,
        input_kind: kind,
      },
      cells: buildCellRows(parsed, pred, alt, conf, audit, gt),
      class_summary: buildClassSummary(pred),
      has_ground_truth: !!gt,
      ground_truth: gt ? {
        column: gt.column, n_with_gt: gt.n_with_gt, n_correct: gt.n_correct,
        top1_accuracy: gt.top1_accuracy, macro_recall: gt.macro_recall, coverage: gt.coverage,
      } : null,
    };
    setStep("render", "done");
    setProc("Done.", "", 100);
    setTimeout(() => onResult(), 200);
  } catch (e) {
    console.error(e);
    setProc("Error", e.message || String(e), 0);
    setTimeout(() => showStage("upload"), 4000);
  }
}

function buildCellRows(parsed, pred, alt, conf, audit, gt) {
  const out = [];
  const cls = State.classes;
  const limit = Math.min(parsed.nObs, 5000);
  for (let i = 0; i < limit; i++) {
    const row = {
      id: parsed.obsNames[i],
      predicted: cls[pred[i]],
      confidence: conf[i],
      alternative: cls[alt[i]],
      marker_evidence: audit.evidence[i],
      audit_specificity: audit.specificity[i],
      low_confidence: conf[i] < 0.15 ? 1 : 0,
    };
    if (gt) {
      row.ground_truth = gt.labels[i];
      row.correct = gt.gtIdx[i] >= 0 ? (pred[i] === gt.gtIdx[i] ? 1 : 0) : -1;
    }
    out.push(row);
  }
  return out;
}
function buildClassSummary(pred) {
  const counts = new Map();
  for (let i = 0; i < pred.length; i++) {
    const c = pred[i];
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const cls = State.classes;
  const arr = Array.from(counts.entries()).map(([c, n]) => ({ class: cls[c], count: n }));
  arr.sort((a, b) => b.count - a.count);
  return arr;
}

// ---- result rendering (shared with server-side UI) ----
function onResult() {
  showStage("results");
  document.body.classList.toggle("has-gt", !!State.result.has_ground_truth);
  renderSummary();
  renderClassRail();
  renderCellsList();
  // Build a CSV download blob
  const csv = buildCsv(State.result.cells);
  const csvUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  $("#download-csv").href = csvUrl;
  $("#download-csv").setAttribute("download", "audit.csv");
}
function buildCsv(cells) {
  const header = ["cell_id","ct_predicted","ct_confidence","ct_alternative",
                  "ct_marker_evidence","ct_audit_specificity","ct_low_confidence"];
  if (cells[0] && "ground_truth" in cells[0]) {
    header.push("ct_ground_truth", "ct_correct");
  }
  const rows = [header.join(",")];
  for (const c of cells) {
    const row = [c.id, c.predicted, c.confidence.toFixed(4), c.alternative,
                 c.marker_evidence, c.audit_specificity.toFixed(4), c.low_confidence];
    if ("ground_truth" in c) {
      row.push(c.ground_truth, c.correct);
    }
    rows.push(row.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : v).join(","));
  }
  return rows.join("\n");
}

function renderSummary() {
  const s = State.result.summary;
  $("#summary-n").textContent = s.n_cells.toLocaleString();
  $("#summary-classes").textContent = State.result.class_summary.length;
  const lowN = State.result.cells.filter(c => c.low_confidence).length;
  $("#summary-low").textContent = `${lowN.toLocaleString()} (${(100*lowN/s.n_cells).toFixed(1)}%)`;
  $("#summary-align").textContent = `${s.alignment_pct.toFixed(1)}%`;
  const wrap = $("#summary-gt-wrap");
  if (State.result.has_ground_truth && State.result.ground_truth) {
    const gt = State.result.ground_truth;
    const acc = gt.top1_accuracy;
    const cls = acc > 0.85 ? "gt-good" : (acc > 0.65 ? "gt-mid" : "gt-bad");
    const num = $("#summary-gt");
    num.textContent = `${(acc * 100).toFixed(1)}%`;
    num.className = `summary-num ${cls}`;
    wrap.title = `${gt.n_correct}/${gt.n_with_gt} correct · macro recall ${(gt.macro_recall*100).toFixed(1)}%`;
    wrap.style.display = "";
  } else {
    wrap.style.display = "none";
  }
}

function renderClassRail() {
  const list = $("#class-list"); list.innerHTML = "";
  const all = document.createElement("div");
  all.className = "class-row" + (State.classFilter === null ? " active" : "");
  all.innerHTML = `<span class="class-name">all classes</span><span class="class-count">${State.result.summary.n_cells.toLocaleString()}</span>`;
  all.addEventListener("click", () => { State.classFilter = null; renderClassRail(); renderCellsList(); });
  list.appendChild(all);
  State.result.class_summary.forEach((c) => {
    const row = document.createElement("div");
    row.className = "class-row" + (State.classFilter === c.class ? " active" : "");
    row.innerHTML = `<span class="class-name" title="${escapeHtml(c.class)}">${escapeHtml(c.class)}</span><span class="class-count">${c.count}</span>`;
    row.addEventListener("click", () => { State.classFilter = c.class; renderClassRail(); renderCellsList(); });
    list.appendChild(row);
  });
}

function renderCellsList() {
  const cells = filterAndSort(State.result.cells);
  const list = $("#cells-list"); list.innerHTML = "";
  const visible = cells.slice(0, 500);
  visible.forEach((cell) => {
    const row = document.createElement("div");
    row.className = "cell-row" + (State.selectedCellId === cell.id ? " selected" : "");
    const conf = cell.confidence;
    const confCls = conf < 0.15 ? "low" : (conf > 0.4 ? "high" : "");
    let correctMark = "", truthCell = "";
    if ("correct" in cell) {
      if (cell.correct === 1) {
        correctMark = `<span class="cell-correct yes" title="prediction matches ground truth">✓ OK</span>`;
        truthCell = `<div class="cell-truth" title="${escapeHtml(cell.ground_truth)}">${escapeHtml(cell.ground_truth)}</div>`;
      } else if (cell.correct === 0) {
        correctMark = `<span class="cell-correct no" title="predicted does not match ground truth">✗ MISS</span>`;
        truthCell = `<div class="cell-truth miss" title="${escapeHtml(cell.ground_truth)}">${escapeHtml(cell.ground_truth)}</div>`;
      } else {
        correctMark = `<span class="cell-correct na" title="ground truth not in reference vocabulary">— N/A</span>`;
        truthCell = `<div class="cell-truth" title="${escapeHtml(cell.ground_truth)}">${escapeHtml(cell.ground_truth)}</div>`;
      }
    }
    row.innerHTML = `${correctMark}
      <div class="cell-id" title="${escapeHtml(cell.id)}">${escapeHtml(cell.id)}</div>
      <div class="cell-class" title="${escapeHtml(cell.predicted)}">${escapeHtml(cell.predicted)}</div>
      <div class="cell-conf ${confCls}">${(conf * 100).toFixed(1)}%</div>
      ${truthCell}`;
    row.addEventListener("click", () => selectCell(cell));
    list.appendChild(row);
  });
  $("#cells-status").textContent =
    `showing ${visible.length} of ${cells.length} matching cells` +
    (cells.length > 500 ? ` (filter or pick a class to narrow)` : "");
}
function filterAndSort(cells) {
  let out = cells;
  if (State.classFilter) out = out.filter(c => c.predicted === State.classFilter);
  if (State.textFilter) {
    const q = State.textFilter.toLowerCase();
    out = out.filter(c => c.id.toLowerCase().includes(q) || c.predicted.toLowerCase().includes(q) || (c.marker_evidence || "").toLowerCase().includes(q));
  }
  const sort = State.sort;
  if (sort === "conf-desc") out = [...out].sort((a, b) => b.confidence - a.confidence);
  else if (sort === "conf-asc") out = [...out].sort((a, b) => a.confidence - b.confidence);
  else if (sort === "class") out = [...out].sort((a, b) => a.predicted.localeCompare(b.predicted));
  else if (sort === "id") out = [...out].sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
function selectCell(cell) {
  State.selectedCellId = cell.id;
  renderCellsList();
  renderDetail(cell);
}
function renderDetail(cell) {
  const pane = $("#detail-pane");
  const conf = cell.confidence;
  const confLabel = conf < 0.15 ? "low" : (conf > 0.4 ? "high" : "mid");
  const tuple = (cell.marker_evidence || "").split("|").filter(Boolean);
  const tupleHtml = tuple.length === 4
    ? tuple.map(g => `<span class="gene-chip">${escapeHtml(g)}</span>`).join("")
    : `<em class="muted small">no marker tuple fired — encoder-only call. Manual review recommended.</em>`;
  const explanation = tuple.length === 4
    ? `These four marker genes co-fired in this cell, and that 4-tuple is associated with <strong>${escapeHtml(cell.predicted)}</strong> in the reference catalog. Specificity ${cell.audit_specificity.toFixed(2)} — closer to 1.0 means the tuple maps to fewer alternative classes (more specific).`
    : `The encoder embedding placed this cell closest to <strong>${escapeHtml(cell.predicted)}</strong>, but no specific 4-tuple of marker genes drove it. The call is based on the holistic gene-expression pattern.`;
  pane.innerHTML = `
    <div class="detail-cell-id">${escapeHtml(cell.id)}</div>
    <div class="detail-section">
      <div class="detail-class">${escapeHtml(cell.predicted)}</div>
      <span class="detail-conf-badge ${confLabel}">${confLabel.toUpperCase()} CONFIDENCE · ${(conf * 100).toFixed(1)}%</span>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Marker evidence</div>
      <div class="detail-evidence-tuple">${tupleHtml}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Why</div>
      <div class="detail-explainer">${explanation}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Runner-up class</div>
      <div class="detail-alt">If not <em>${escapeHtml(cell.predicted)}</em>, this cell would have been called <strong>${escapeHtml(cell.alternative)}</strong>.</div>
    </div>
    ${gtBlock(cell)}`;
}
function gtBlock(cell) {
  if (!("correct" in cell)) return "";
  if (cell.correct === 1) return `<div class="detail-gt match"><div class="detail-gt-label">ground truth (debug)</div><div>✓ matches predicted: <strong>${escapeHtml(cell.ground_truth)}</strong></div></div>`;
  if (cell.correct === 0) return `<div class="detail-gt miss"><div class="detail-gt-label">ground truth (debug)</div><div>✗ predicted <strong>${escapeHtml(cell.predicted)}</strong>, true label is <strong>${escapeHtml(cell.ground_truth)}</strong></div></div>`;
  return `<div class="detail-gt"><div class="detail-gt-label">ground truth (debug)</div><div>label "<em>${escapeHtml(cell.ground_truth)}</em>" is not in this reference's class vocabulary</div></div>`;
}

// ---- wiring ----
function setupUpload() {
  const dz = $("#dropzone");
  const fi = $("#file-input");
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", (e) => {
    if (e.target.files.length > 0) annotate(e.target.files[0]);
  });
  ["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length > 0) annotate(e.dataTransfer.files[0]); });
  $("#reference-select").addEventListener("change", (e) => { State.selectedRef = e.target.value; });
}
function setupResultsToolbar() {
  $("#cell-filter").addEventListener("input", (e) => { State.textFilter = e.target.value; renderCellsList(); });
  $("#cell-sort").addEventListener("change", (e) => { State.sort = e.target.value; renderCellsList(); });
  $("#reset-btn").addEventListener("click", navigateHome);
}

function setupNavigation() {
  // Brand → home
  const brand = $("#nav-home");
  if (brand) {
    brand.addEventListener("click", navigateHome);
    brand.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigateHome(); }
    });
  }
  // Top-bar "new file" button
  const navNewFile = $("#nav-new-file");
  if (navNewFile) navNewFile.addEventListener("click", navigateHome);
  // Esc key — only when not typing in an input/select
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    if (document.body.dataset.stage !== "upload") {
      e.preventDefault();
      navigateHome();
    }
  });
}
function setupDebugToggle() {
  const cb = $("#debug-toggle");
  cb.checked = State.debug;
  document.body.classList.toggle("debug", State.debug);
  cb.addEventListener("change", () => {
    State.debug = cb.checked;
    localStorage.setItem("ct.debug", State.debug ? "1" : "0");
    document.body.classList.toggle("debug", State.debug);
  });
}

function setupThemeToggle() {
  const stored = localStorage.getItem("ct.theme");
  if (stored === "light") document.documentElement.setAttribute("data-theme", "light");
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? null : "light";
    if (next) document.documentElement.setAttribute("data-theme", next);
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("ct.theme", next || "dark");
  });
}

setupUpload();
setupResultsToolbar();
setupDebugToggle();
setupThemeToggle();
setupNavigation();
// Initial stage from URL hash (e.g. user lands on /#/results without a result -> falls back to upload)
const initialStage = (location.hash.replace(/^#\/?/, "") || "upload");
showStage(initialStage === "results" ? "upload" : initialStage);
populateReferenceDropdown();
populateSampleGrid();

// pre-warm the model load so first upload is fast
loadReference(State.selectedRef).catch((e) => {
  console.error("model preload failed", e);
  $("#ref-meta").textContent = "(model preload failed: " + e.message + ")";
});

async function populateReferenceDropdown() {
  try {
    const r = await fetch("references.json");
    const data = await r.json();
    const refs = data.references || [];
    const sel = $("#reference-select");
    sel.innerHTML = "";
    refs.forEach((ref) => {
      const opt = document.createElement("option");
      opt.value = ref.id;
      const tissue = ref.description?.split("—")[0]?.trim() || ref.id;
      opt.textContent = `${ref.id} — ${tissue} (${ref.n_classes} classes)`;
      sel.appendChild(opt);
    });
    // Keep the currently selected value if still valid
    if (refs.some(r => r.id === State.selectedRef)) {
      sel.value = State.selectedRef;
    } else if (refs.length) {
      State.selectedRef = refs[0].id;
      sel.value = State.selectedRef;
    }
  } catch (e) {
    console.error("references fetch failed", e);
  }
}

async function populateSampleGrid() {
  try {
    const r = await fetch("samples/manifest.json");
    if (!r.ok) throw new Error("no manifest");
    const samples = await r.json();
    const grid = $("#samples-grid");
    grid.innerHTML = "";
    samples.forEach((s) => {
      const card = document.createElement("div");
      card.className = "sample-card";
      card.innerHTML = `
        <div class="sample-card-label">${escapeHtml(s.label)}</div>
        <div class="sample-card-sub">${escapeHtml(s.subtitle || "")}</div>
        <div class="sample-card-meta">${s.n_cells} cells · ref: ${escapeHtml(s.recommended_reference)}</div>
      `;
      card.addEventListener("click", () => loadSample(s));
      grid.appendChild(card);
    });
  } catch (e) {
    console.error("samples fetch failed", e);
    $("#samples-grid").innerHTML = `<span class="muted small">no sample manifest available</span>`;
  }
}

async function loadSample(sample) {
  // Use the sample's recommended reference unless the user explicitly picked another.
  if (sample.recommended_reference && sample.recommended_reference !== State.selectedRef) {
    State.selectedRef = sample.recommended_reference;
    $("#reference-select").value = sample.recommended_reference;
  }
  // Fetch the .h5ad as a Blob and pass it to annotate() as if uploaded.
  showStage("processing");
  setProc("Loading sample…", sample.label, 3);
  try {
    const r = await fetch(`samples/${sample.file}`);
    if (!r.ok) throw new Error(`fetch ${sample.file} failed (${r.status})`);
    const blob = await r.blob();
    // Pretend it's a File so the rest of the pipeline doesn't care.
    const file = new File([blob], sample.file, { type: "application/octet-stream" });
    annotate(file);
  } catch (e) {
    console.error("sample load failed", e);
    setProc("Error loading sample", e.message || String(e), 0);
    setTimeout(() => showStage("upload"), 3000);
  }
}
