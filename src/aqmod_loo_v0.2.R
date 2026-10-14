# aqmod_loo_v0.2.R — PSIS-LOO: v0.4.2 (negbinomial slope) vs v0.5 (cumulative logit)
# Cross-family LOO is valid only if both models scored the SAME discrete y.
library(brms)
f_nb  <- readRDS("aqmod_fit_v0.4.2_105r.rds")
f_ord <- readRDS("aqmod_fit_v0.5_105r.rds")
y_nb  <- f_nb$data$strokes_from_sector
y_ord <- as.integer(as.character(f_ord$data$sfs_ord))
stopifnot(length(y_nb) == length(y_ord), max(y_nb) <= 4, identical(y_nb, y_ord))
l <- list(v0.4.2 = loo(f_nb), v0.5 = loo(f_ord))
print(l$v0.4.2); print(l$v0.5)            # includes Pareto-k tables
print(loo_compare(l))
saveRDS(l, "aqmod_loo_v0.2_105r.rds")
