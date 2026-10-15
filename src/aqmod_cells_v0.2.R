# aqmod_cells_v0.2.R — cell-level flags for the v0.5.1 ordinal fit. Loads the saved
# fit; does NOT refit. Baseline = fixed effects + hole + sector_type effects, so a
# flag means "this cell differs from its hole and sector type".
# Flag: |post_mean - base_mean| > 0.25 strokes AND 95% CI excludes base_mean.
library(brms)
library(dplyr)
library(readr)

fit <- readRDS("aqmod_fit_v0.5.1_105r.rds")
stopifnot(identical(levels(fit$data$sfs_ord), as.character(1:4)))

cell_grid <- fit$data %>% distinct(hole, sector_type, sector_id, pin, rub)

# E[strokes] = sum_k k * P(k) from the [draws x cells x 4] probability array.
ev <- function(p) Reduce(`+`, lapply(seq_len(dim(p)[3]), function(k) k * p[, , k]))
ep   <- ev(posterior_epred(fit, newdata = cell_grid, re_formula = NULL))
base <- ev(posterior_epred(fit, newdata = cell_grid,
                           re_formula = ~ (1 | hole) + (1 | sector_type)))

cells <- cell_grid %>%
  mutate(base_mean = apply(base, 2, mean),
         post_mean = apply(ep, 2, mean),
         post_lo   = apply(ep, 2, quantile, 0.025),
         post_hi   = apply(ep, 2, quantile, 0.975),
         moved     = post_mean - base_mean,
         flagged   = abs(moved) > 0.25 & (base_mean < post_lo | base_mean > post_hi)) %>%
  arrange(desc(abs(moved)))

cat(sprintf("Cells: %d   flagged: %d   max |moved|: %.3f\n",
            nrow(cells), sum(cells$flagged), max(abs(cells$moved))))
print(as.data.frame(head(cells, 15)), row.names = FALSE, digits = 3)
write_csv(cells, "aqmod_cells_flags_v0.2.csv")
cat("Wrote aqmod_cells_flags_v0.2.csv\n")
