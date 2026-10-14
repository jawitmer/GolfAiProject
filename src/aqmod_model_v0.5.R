# =============================================================================
# aqmod_model_v0.5.R
# AQ valuation model — brms skeleton.
#
# Outcome:  strokes_from_sector as ordered categories 1 / 2 / 3 / 4+
#           (cumulative logit). v0.4.2's negbinomial was severely overdispersed
#           vs the data (obs var .41 vs PP var 2.43).
# Rubric:   enters as covariate lp_c with a free slope. NO offset.
# Goal:     per-cell posterior E[strokes] + 95% CI; flag cells whose RE-inclusive
#           E moved off the fixed-effect-only E (re_formula = NA).
#
# Inputs (place alongside this script, or edit the paths in SECTION 0):
#   aqmod_2026-*.csv          AQmod round exports (one file per round)
#   AQ_sector_types_v0.2.csv  217-row hole,sector,sector_type lookup
#   rubric_scores_v0.2.csv    long-form hole,sector,pin,rubric_score prior
#                             REGENERATED FROM MASTER all_holes_data_v3_64.py.
#                             v0.1 of this file was a snapshot of the rubric at
#                             master v3.59.9; 29 scores changed across 10 holes
#                             between then and v3.64, so reusing it would fit new
#                             data against the old rubric. 20 of those 29 cells
#                             carry observations (38 of 602 rows, 6.3%).
#
# Data state: the script fits whatever aqmod_*.csv rounds are in the folder
# (currently 105 rounds / 1606 played rows as of 2026-10-12). Cell coverage is
# 651/1085 (60%), sector_id:pin singleton rate 39% — improving but the model
# is still intentionally prior-dominated at this stage.
# =============================================================================

library(brms)
library(dplyr)
library(tidyr)
library(readr)
library(stringr)
library(purrr)

# ---- SECTION 0: paths --------------------------------------------------------
data_dir   <- "."                                  # dir holding the AQmod CSVs
types_csv  <- "AQ_sector_types_v0.2.csv"
rubric_csv <- "rubric_scores_v0.2.csv"

# ---- SECTION 1: load + stack the AQmod rounds --------------------------------
round_files <- list.files(data_dir, pattern = "^aqmod_2026-.*\\.csv$",
                          full.names = TRUE)
stopifnot(length(round_files) > 0)

raw <- map_dfr(round_files, ~ read_csv(.x, col_types = cols(.default = "c")))

# ---- SECTION 2: clean + key prep --------------------------------------------
# Drop unplayed holes (no sector recorded => hole not played).
# Strip the leading 'S' so codes match the bare lookup / rubric keys.
dat <- raw %>%
  filter(!is.na(sector), str_trim(sector) != "") %>%
  mutate(
    hole   = as.integer(hole),
    pin    = as.integer(pin),
    sector = str_remove(sector, "^S"),
    strokes_from_sector = as.integer(strokes_from_sector)
  ) %>%
  filter(!is.na(strokes_from_sector))

# ---- SECTION 3: joins --------------------------------------------------------
types  <- read_csv(types_csv,  col_types = cols(hole = "i", sector = "c",
                                                sector_type = "c"))
rubric <- read_csv(rubric_csv, col_types = cols(hole = "i", sector = "c",
                                                pin = "i", rubric_score = "d"))

dat <- dat %>%
  left_join(types,  by = c("hole", "sector")) %>%
  left_join(rubric, by = c("hole", "sector", "pin"))

# Fail loudly if any played cell lacks a type or a prior — should be zero.
miss_type   <- sum(is.na(dat$sector_type))
miss_rubric <- sum(is.na(dat$rubric_score))
if (miss_type > 0 || miss_rubric > 0)
  stop(sprintf("Unmatched rows: %d missing sector_type, %d missing rubric.",
               miss_type, miss_rubric))

# ---- SECTION 4: rubric -> prior expected strokes (the offset) ----------------
# Anchor points; half-points interpolate linearly. Curve is OPEN for revision —
# change here, nowhere else.
rubric_curve <- function(s) {
  anchors_x <- c(1,   2,   3,   4,   5)
  anchors_y <- c(3.8, 3.2, 2.6, 2.1, 1.8)
  approx(anchors_x, anchors_y, xout = s, rule = 2)$y
}

stopifnot(all(dat$strokes_from_sector >= 1))
cat(sprintf("Rows collapsed to 4+ (strokes >= 5): %d\n",
            sum(dat$strokes_from_sector >= 5)))

dat <- dat %>%
  mutate(
    sfs_ord = factor(pmin(strokes_from_sector, 4L), levels = 1:4, ordered = TRUE),
    prior_strokes_cell = rubric_curve(rubric_score),
    lp_c = log(prior_strokes_cell) - mean(log(prior_strokes_cell)),
    # Factors for the hierarchy. Pin is NOMINAL (5-level), not ordinal.
    hole        = factor(hole),
    sector_id   = factor(paste(hole, sector, sep = ":")),
    sector_type = factor(sector_type),
    pin         = factor(pin)
  )

# ---- SECTION 5: model --------------------------------------------------------
# Cross-classified random effects (locked). Rubric enters via lp_c (no offset).
# cumulative logit: outcome is underdispersed vs Poisson; negbinomial cannot fit.
#
# SWITCH: the deepest term (1 | sector_id:pin) is ~1 obs/level (1.48) across
# 40 rounds (269 of 406 levels are singletons), so it can only echo its prior and may
# add divergences. Set FALSE to drop it from BOTH the formula and the priors
# until cells fill in; the rest of the locked hierarchy is unchanged. Flip
# back to TRUE once data accumulate. (Formula and prior must move together —
# a prior on an absent group errors in brms.)
include_sector_id_pin <- TRUE

re_terms <- c(
  "(1 | hole)",
  "(1 | sector_type)",
  "(1 | sector_id)",
  "(1 | sector_type:pin)"
)
if (include_sector_id_pin) {
  re_terms <- c(re_terms, "(1 | sector_id:pin)")
}

form <- bf(as.formula(paste(
  "sfs_ord ~ 1 + lp_c +",
  paste(re_terms, collapse = " + ")
)))

# Weakly-informative priors on the RE SDs. The deepest term (sector_id:pin)
# still has ~1.5 obs/level, so a tighter prior keeps sampling stable and lets
# it shrink hard toward the prior rather than chase noise.
priors <- c(
  prior(normal(0, 3), class = "Intercept"),      # 3 thresholds (logit scale)
  prior(normal(0, 5), class = "b", coef = "lp_c"),
  prior(student_t(3, 0, 1), class = "sd", group = "hole"),
  prior(student_t(3, 0, 1), class = "sd", group = "sector_type"),
  prior(student_t(3, 0, 1), class = "sd", group = "sector_id"),
  prior(student_t(3, 0, 0.5), class = "sd", group = "sector_type:pin")
)
if (include_sector_id_pin) {
  priors <- priors +
    prior(student_t(3, 0, 0.5), class = "sd", group = "sector_id:pin")
}

fit <- brm(
  formula = form,
  data    = dat,
  family  = cumulative(link = "logit"),
  prior   = priors,
  chains  = 4, iter = 3000, warmup = 1000,
  cores   = 4, seed = 1,
  backend = "rstan",
  control = list(adapt_delta = 0.99, max_treedepth = 12)
)

print(summary(fit))

# Gate (decision rule 1): max Rhat <= 1.01 and 0 divergences; ESS from summary.
np <- nuts_params(fit)
cat(sprintf("Divergences: %d   max Rhat: %.3f\n",
            sum(np$Value[np$Parameter == "divergent__"]),
            max(rhat(fit), na.rm = TRUE)))

# fit$data no longer carries prior_strokes_cell (formula doesn't reference it),
# so store the training lp_c centring for the predictor.
attr(fit, "lp_mean") <- mean(log(dat$prior_strokes_cell))

# Persist the fitted model so prediction utilities can load it without refitting.
saveRDS(fit, sprintf("aqmod_fit_v0.5_%dr.rds", length(round_files)))

# ---- SECTION 6: per-cell posterior in strokes units -------------------------
# Predict expected strokes for every observed cell.
cell_grid <- dat %>%
  distinct(hole, sector, pin, sector_type, sector_id, prior_strokes_cell, lp_c)

# Ordinal epred = category probabilities [draws x cells x 4].
# E[strokes] = sum_k k * P(k)  (exact while no strokes >= 5).
ev <- function(p) Reduce(`+`, lapply(seq_len(dim(p)[3]), function(k) k * p[, , k]))
ep    <- ev(posterior_epred(fit, newdata = cell_grid, re_formula = NULL))
ep_fe <- ev(posterior_epred(fit, newdata = cell_grid, re_formula = NA))

cell_post <- cell_grid %>%
  mutate(
    fe_mean   = apply(ep_fe, 2, mean),
    post_mean = apply(ep, 2, mean),
    post_lo   = apply(ep, 2, quantile, 0.025),
    post_hi   = apply(ep, 2, quantile, 0.975),
    moved     = post_mean - fe_mean
  ) %>%
  arrange(desc(abs(moved)))

# ---- SECTION 7: flag cells that moved materially off the fixed-effect E -----
# "Material" = RE-inclusive mean differs from fixed-effect-only mean by > 0.25
# strokes AND the 95% interval excludes fe_mean.
flagged <- cell_post %>%
  filter(abs(moved) > 0.25,
         fe_mean < post_lo | fe_mean > post_hi)

cat("\n--- Cells moved materially off fixed-effect E (>0.25 strokes, CI excludes it) ---\n")
if (nrow(flagged) == 0) {
  cat("None. Random effects move no cell materially off the fixed-effect E.\n")
} else {
  print(as.data.frame(flagged), row.names = FALSE)
}

# Persist for inspection.
write_csv(cell_post, "aqmod_cell_posterior_v0.5.csv")
cat("\nWrote aqmod_cell_posterior_v0.5.csv (", nrow(cell_post), " cells).\n", sep = "")
