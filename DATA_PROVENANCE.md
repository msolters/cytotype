# Data provenance

This file documents the source, citation, and license of every dataset
shipped under `samples/`. All data are subsamples of publicly-released
single-cell or single-nucleus RNA-seq atlases.

The Cytotype source code is MIT-licensed (see `LICENSE`). The data files
under `samples/` are subject to the per-dataset licenses noted below —
all are **CC BY 4.0** unless explicitly stated otherwise. Per CC BY 4.0,
attribution to the original authors is required when redistributing.

## Held-out-donor samples — Tabula Sapiens (human)

| File | Tissue | License | Citation |
|---|---|---|---|
| `ts_lung_held_out_donor.h5ad` | Lung | CC BY 4.0 | Tabula Sapiens Consortium et al., *The Tabula Sapiens: A multiple-organ, single-cell transcriptomic atlas of humans*, **Science** 376, eabl4896 (2022). https://doi.org/10.1126/science.abl4896 |
| `ts_blood_held_out_donor.h5ad` | Blood | CC BY 4.0 | (same as above) |
| `ts_bladder.h5ad` | Bladder | CC BY 4.0 | (same as above) |
| `ts_bone_marrow.h5ad` | Bone marrow | CC BY 4.0 | (same as above) |
| `ts_liver.h5ad` | Liver | CC BY 4.0 | (same as above) |
| `ts_muscle.h5ad` | Muscle | CC BY 4.0 | (same as above) |

Portal: <https://tabula-sapiens-portal.ds.czbiohub.org/>

## Held-out-donor samples — Allen Brain Cell Atlas (mouse)

| File | Region | License | Citation |
|---|---|---|---|
| `abca_olfactory_held_out_donor.h5ad` | Olfactory bulb | CC BY 4.0 | Yao et al., *A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain*, **Nature** 624, 317–332 (2023). https://doi.org/10.1038/s41586-023-06812-z |
| `abca_wmb-10xv3-cb.h5ad` | Cerebellum | CC BY 4.0 | (same as above) |
| `abca_wmb-10xv3-ctxsp.h5ad` | Cortical subplate | CC BY 4.0 | (same as above) |
| `abca_wmb-10xv3-olf.h5ad` | Olfactory areas | CC BY 4.0 | (same as above) |

Portal: <https://portal.brain-map.org/atlases-and-data/bkp/abc-atlas>

## Held-out-donor sample — 10x Genomics PBMC

| File | Source | License | Citation |
|---|---|---|---|
| `pbmc_4k_8k.h5ad` | 10x Genomics PBMC 4K & 8K | 10x Genomics Public Data Use | Zheng et al., *Massively parallel digital transcriptional profiling of single cells*, **Nat Commun** 8, 14049 (2017). https://doi.org/10.1038/ncomms14049 — processed by Lopez et al., *Deep generative modeling for single-cell transcriptomics*, **Nat Methods** 15, 1053–1058 (2018). https://doi.org/10.1038/s41592-018-0229-2 |

Source: <https://www.10xgenomics.com/datasets>

## External samples — CELLxGENE Discover

These come from independent studies not used for training. They expose
real-world generalisation properties (gene-coverage / label-vocabulary
mismatch with the training reference).

| File | Source | License | Citation |
|---|---|---|---|
| `external_ts_blood_e763ed0d.h5ad` | CELLxGENE Discover | CC BY 4.0 | Su et al., *A web portal and workbench for biological dissection of single cell COVID-19 host responses*, **iScience** 24, 103115 (2021). https://doi.org/10.1016/j.isci.2021.103115 |
| `external_ts_blood_36a22a49.h5ad` | CELLxGENE Discover | CC BY 4.0 | Allen Institute for Immunology, *Human Immune Health Atlas* (CELLxGENE collection). |
| `external_ts_lung_6e00ccf7.h5ad` | CELLxGENE Discover | CC BY 4.0 | Sun et al., *Single cell transcriptomic profiling identifies molecular phenotypes of newborn human lung*, **Genes** 15, 298 (2024). https://doi.org/10.3390/genes15030298 |
| `external_ts_lung_810ac45f.h5ad` | CELLxGENE Discover | CC BY 4.0 | He et al., *A human fetal lung cell atlas uncovers proximal-distal gradients of differentiation*, **Cell** 185, 4858–4878 (2022). https://doi.org/10.1016/j.cell.2022.11.005 |
| `external_ts_pan_tissue_fbd69faa.h5ad` | CELLxGENE Discover | CC BY 4.0 | Yayon et al., *A spatial human thymus cell atlas mapped to a continuous tissue axis*, **Nature** 635, 942–951 (2024). https://doi.org/10.1038/s41586-024-07944-6 |
| `external_ts_pan_tissue_524e045e.h5ad` | CELLxGENE Discover | CC BY 4.0 | Andrews et al., *Single-cell, single-nucleus, and spatial RNA sequencing of the human liver identifies hepatic stellate cell and cholangiocyte heterogeneity*, **Hepatol Commun** 6, 821–840 (2022). https://doi.org/10.1002/hep4.1854 |
| `external_abca_brain_4ec57620.h5ad` | CELLxGENE Discover | CC BY 4.0 | Bakken et al., *Comparative cellular analysis of motor cortex in human, marmoset and mouse*, **Nature** 598, 111–119 (2021). https://doi.org/10.1038/s41586-021-03465-8 |

Portal: <https://cellxgene.cziscience.com/>

## CC BY 4.0 in plain English

You may share, copy, redistribute, transform, and build upon the data files
in any medium or format, for any purpose (including commercial), provided
you give appropriate credit to the original authors (citations above), link
to the license, and indicate if changes were made. License text:
<https://creativecommons.org/licenses/by/4.0/>

## What "subsample" means here

Each sample file is a small subset of the original publication's data —
typically 500–4000 cells drawn from the held-out-donor split or from the
full released dataset. We did not modify gene-expression values; we only
selected a subset of cells and (for some files) the variable-gene set.
Reproducing the same subsamples requires the original release plus the
seed/index used here, both of which are referenced in `manifest.json`.
