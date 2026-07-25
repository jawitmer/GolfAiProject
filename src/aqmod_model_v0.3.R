# =============================================================================
# aqmod_model_v0.3.R
# AQ valuation model — brms skeleton.
#
# Outcome:  strokes_from_sector (count), modeled on its natural scale.
# Prior:    subjective rubric scores enter via offset(log(prior_strokes_cell)).
# Goal:     per-cell posterior strokes + 95% CI; flag cells that moved off prior.
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
# (currently 40 rounds / 602 played rows as of 2026-07-23). Still sparse at the
# deepest interaction; the model is intentionally prior-dominated at this stage.
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

dat <- dat %>%
  mutate(
    prior_strokes_cell = rubric_curve(rubric_score),
    # Factors for the hierarchy. Pin is NOMINAL (5-level), not ordinal.
    hole        = factor(hole),
    sector_id   = factor(paste(hole, sector, sep = ":")),
    sector_type = factor(sector_type),
    pin         = factor(pin)
  )

# ---- SECTION 5: model --------------------------------------------------------
# Cross-classified random effects (locked). offset() carries the prior.
# negbinomial: chip-and-three-putt blowups overdisperse a Poisson.
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
  "strokes_from_sector ~ 1 + offset(log(prior_strokes_cell)) +",
  paste(re_terms, collapse = " + ")
)))

# Weakly-informative priors on the RE SDs. The deepest term (sector_id:pin)
# still has ~1.5 obs/level, so a tighter prior keeps sampling stable and lets
# it shrink hard toward the prior rather than chase noise.
priors <- c(
  prior(normal(0, 0.5), class = "Intercept"),
  prior(student_t(3, 0, 0.5), class = "sd", group = "hole"),
  prior(student_t(3, 0, 0.5), class = "sd", group = "sector_type"),
  prior(student_t(3, 0, 0.5), class = "sd", group = "sector_id"),
  prior(student_t(3, 0, 0.3), class = "sd", group = "sector_type:pin"),
  prior(gamma(2, 0.5), class = "shape")          # negbinomial dispersion
)
if (include_sector_id_pin) {
  priors <- priors +
    prior(student_t(3, 0, 0.3), class = "sd", group = "sector_id:pin")
}

fit <- brm(
  formula = form,
  data    = dat,
  family  = negbinomial(),
  prior   = priors,
  chains  = 4, iter = 3000, warmup = 1000,
  cores   = 4, seed = 1,
  backend = "rstan",
  control = list(adapt_delta = 0.95, max_treedepth = 12)
)

print(summary(fit))

# Persist the fitted model so prediction utilities can load it without refitting.
saveRDS(fit, "aqmod_fit_v0.3.rds")

# ---- SECTION 6: per-cell posterior in strokes units -------------------------
# Predict expected strokes for every observed cell. The offset is already in
# prior_strokes_cell, so we predict on the same grid the data carry.
cell_grid <- dat %>%
  distinct(hole, sector, pin, sector_type, sector_id, prior_strokes_cell)

# Posterior expected count per cell (includes offset). epred = expectation.
ep <- posterior_epred(fit, newdata = cell_grid, re_formula = NULL)

cell_post <- cell_grid %>%
  mutate(
    post_mean = apply(ep, 2, mean),
    post_lo   = apply(ep, 2, quantile, 0.025),
    post_hi   = apply(ep, 2, quantile, 0.975),
    moved     = post_mean - prior_strokes_cell
  ) %>%
  arrange(desc(abs(moved)))

# ---- SECTION 7: flag cells that moved materially off the prior --------------
# "Material" = posterior mean differs from prior by > 0.25 strokes AND the
# 95% interval excludes the prior value. At v0.1 expect few or none.
flagged <- cell_post %>%
  filter(abs(moved) > 0.25,
         prior_strokes_cell < post_lo | prior_strokes_cell > post_hi)

cat("\n--- Cells moved materially off prior (>0.25 strokes, CI excludes prior) ---\n")
if (nrow(flagged) == 0) {
  cat("None. At current data volume the posterior tracks the prior (expected).\n")
} else {
  print(as.data.frame(flagged), row.names = FALSE)
}

# Persist for inspection.
write_csv(cell_post, "aqmod_cell_posterior_v0.3.csv")
cat("\nWrote aqmod_cell_posterior_v0.3.csv (", nrow(cell_post), " cells).\n", sep = "")
