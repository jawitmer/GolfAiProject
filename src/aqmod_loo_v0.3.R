# aqmod_loo_v0.3.R — PSIS-LOO: v0.5 (lp_c) vs v0.5.1 (mo(rub)), same y required
library(brms)
f_a <- readRDS("aqmod_fit_v0.5_105r.rds")
f_b <- readRDS("aqmod_fit_v0.5.1_105r.rds")
stopifnot(identical(f_a$data$sfs_ord, f_b$data$sfs_ord))
l <- list(v0.5 = loo(f_a), v0.5.1 = loo(f_b))
print(l$v0.5); print(l$v0.5.1)
print(loo_compare(l))
saveRDS(l, "aqmod_loo_v0.3_105r.rds")
