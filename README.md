# cytotype

Auditable cell-type annotation, in your browser.

Drop a single-cell RNA-seq dataset (`.h5ad`) and get back per-cell predicted
cell types with the marker-gene evidence behind every call. Built for
computational biologists who need defensible labels — not "the model said
so" but "these four genes co-fired and that 4-tuple is associated with cell
type X."

Live: <https://msolters.github.io/cytotype/>

## What runs where

Everything runs **locally in your browser**:

- **ONNX Runtime Web** runs the encoder + sub-center anchored ArcFace head as a single fused ONNX graph (~10 MB per reference, downloaded once and cached).
- **h5wasm** parses your `.h5ad` file directly in the browser — your data never touches a network.
- The marker-tuple audit catalog ships as a single JSON (~10–30 MB per reference, cached after first load) and is queried via a JS hash-lookup map.

## References bundled

| ID | Source | Classes |
|---|---|---|
| `ts_blood` | Tabula Sapiens Blood | 27 immune cell types |
| `ts_lung` | Tabula Sapiens Lung | 35 cell types |
| `ts_pan_tissue` | Tabula Sapiens multi-tissue | 41 cell types |
| `abca_olfactory` | Allen Brain Cell Atlas — olfactory bulb | 60 neuronal subtypes |
| `abca_brain` | Allen Brain Cell Atlas — multi-region | 84 neuronal subtypes |

## License

MIT. © 2026 Mark Solters.
