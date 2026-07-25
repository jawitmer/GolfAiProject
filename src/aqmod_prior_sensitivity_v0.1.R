# =============================================================================
# aqmod_prior_sensitivity_v0.1.R
# Companion to aqmod_model_v0.3.R — NOT a replacement.
#
# QUESTION: the v0.1 fit reported all five random-effect SDs near zero, and that
# result is what licenses the conclusion "the rubric's SHAPE is validated; only a
# global level offset exists" — which in turn is what justifies re-anchoring only
# the intercept rather than the curve. But a near-zero SD posterior has two very
# different causes:
#
#   (a) the data say the grouping factor carries no signal          -> real
#   (b) the prior was tight enough to force it there                -> artifact
#
# At ~1.5 obs/level on the deepest term, (b) is a live possibility. This script
# refits the SAME model under wider and tighter prior scales. If the SD posteriors
# barely move, (a) holds and the shape conclusion stands. If they inflate as the
# prior widens, the SDs were prior-driven and the shape conclusion is weaker than
# it looks — re-anchor with that in mind.
#
# The Intercept is tested too, because it is the parameter the re-anchor decision
# actually turns on (v0.1: -0.12, CI excluding 0, ~11% global conservatism).
#
# Inputs:  aqmod_fit_v0.3.rds   (written by aqmod_model_v0.3.R — run that first)
# Outputs: aqmod_prior_sensitivity_v0.1.csv
#
# RUNTIME: four additional fits. Each recompiles Stan because priors are part of
# the model code. Budget accordingly; nothing here is incremental.
# =============================================================================

library(brms)
library(dplyr)
library(readr)
library(posterior)

# ---- SECTION 0: reuse the fitted model's data and formula --------------------
# Deliberately NOT re-running the prep from v0.3. Pulling data and formula off
# the saved fit guarantees the sensitivity runs are identical to the baseline in
# every respect except the priors — which is the whole point of the exercise.
fit_path <- "aqmod_fit_v0.3.rds"
stopifnot(file.exists(fit_path))

fit_base <- readRDS(fit_path)
dat      <- fit_base$data
form     <- formula(fit_base)

# Which RE groups actually exist in the fitted model. Reading them off the fit
# rather than hardcoding means this script follows the include_sector_id_pin
# switch in v0.3 automatically — a prior on an absent group errors in brms.
groups <- setdiff(unique(prior_summary(fit_base)$group), "")
cat("RE groups in fitted model:", paste(groups, collapse = ", "), "\n")

# Baseline prior scales, mirroring aqmod_model_v0.3.R exactly.
BASE_SD  <- c(hole = 0.5, sector_type = 0.5, sector_id = 0.5,
              "sector_type:pin" = 0.3, "sector_id:pin" = 0.3)
BASE_INT <- 0.5

# ---- SECTION 1: prior constructor -------------------------------------------
make_priors <- function(sd_scale = 1, int_sd = BASE_INT) {
  p <- prior_string(sprintf("normal(0, %g)", int_sd), class = "Intercept")
  sds <- BASE_SD[names(BASE_SD) %in% groups]
  for (g in names(sds)) {
    p <- p + prior_string(sprintf("student_t(3, 0, %g)", sds[[g]] * sd_scale),
                          class = "sd", group = g)
  }
  p + prior_string("gamma(2, 0.5)", class = "shape")
}

# The grid. sd_scale multiplies every RE SD prior; int_sd replaces the Intercept
# prior SD. Two-sided on the SDs so we bracket the baseline rather than only
# pushing one way.
grid <- tibble::tribble(
  ~label,            ~sd_scale, ~int_sd,
  "baseline",              1.0,     0.5,   # == v0.3, reused not refit
  "sd_half",               0.5,     0.5,   # tighter: does anything shrink further?
  "sd_double",             2.0,     0.5,
  "sd_quad",               4.0,     0.5,   # if SDs stay ~0 here, they are data-driven
  "intercept_wide",        1.0,     2.0    # is -0.12 the data or the normal(0,0.5)?
)

# ---- SECTION 2: refit under each prior set ----------------------------------
extract_row <- function(f, label) {
  ps <- posterior_summary(f)
  keep <- grepl("^b_Intercept$|^sd_.*__Intercept$", rownames(ps))
  np   <- nuts_params(f)
  tibble(
    prior_set = label,
    parameter = rownames(ps)[keep],
    estimate  = ps[keep, "Estimate"],
    est_error = ps[keep, "Est.Error"],
    q2.5      = ps[keep, "Q2.5"],
    q97.5     = ps[keep, "Q97.5"],
    max_rhat  = max(rhat(f), na.rm = TRUE),
    n_diverge = sum(subset(np, Parameter == "divergent__")$Value)
  )
}

results <- list()

for (i in seq_len(nrow(grid))) {
  lab <- grid$label[i]
  cat("\n=== fitting prior set:", lab, "===\n")

  if (lab == "baseline") {
    f <- fit_base                       # already fitted; do not burn a refit
  } else {
    f <- brm(
      formula = form,
      data    = dat,
      family  = negbinomial(),
      prior   = make_priors(grid$sd_scale[i], grid$int_sd[i]),
      chains  = 4, iter = 3000, warmup = 1000,
      cores   = 4, seed = 1,            # same seed as v0.3: differences are the priors
      backend = "rstan",
      control = list(adapt_delta = 0.95, max_treedepth = 12)
    )
  }
  results[[lab]] <- extract_row(f, lab)
}

sens <- bind_rows(results)

# ---- SECTION 3: report -------------------------------------------------------
cat("\n\n--- Posterior estimates across prior sets ---\n")
print(as.data.frame(sens %>% select(prior_set, parameter, estimate, q2.5, q97.5)),
      row.names = FALSE, digits = 3)

cat("\n--- Sampling diagnostics ---\n")
print(as.data.frame(sens %>% distinct(prior_set, max_rhat, n_diverge)),
      row.names = FALSE, digits = 4)

# Ratio of each estimate to its baseline value: the actual diagnostic.
base_vals <- sens %>% filter(prior_set == "baseline") %>%
  select(parameter, base_est = estimate)

cat("\n--- Movement relative to baseline ---\n")
cat("Rule of thumb: an SD that scales with its prior was prior-driven;\n")
cat("one that holds steady as the prior widens 4x is data-driven.\n\n")
print(as.data.frame(
  sens %>% left_join(base_vals, by = "parameter") %>%
    mutate(ratio = estimate / base_est) %>%
    select(prior_set, parameter, estimate, base_est, ratio)
), row.names = FALSE, digits = 3)

write_csv(sens, "aqmod_prior_sensitivity_v0.1.csv")
cat("\nWrote aqmod_prior_sensitivity_v0.1.csv (", nrow(sens), " rows).\n", sep = "")
