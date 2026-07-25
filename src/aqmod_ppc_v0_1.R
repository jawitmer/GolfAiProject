# =============================================================================
# aqmod_ppc_v0.1.R
# Posterior-predictive check for aqmod_model_v0.3. Standalone; loads the saved
# fit, does NOT refit, does NOT touch the model.
#
# QUESTION it answers:
#   The v0.3 fit reports a single global level offset (Intercept -0.119) and five
#   near-zero random-effect SDs (shown to be data-driven by the sensitivity run).
#   Those SDs are INTERCEPT deviations — they say each hole/sector/cell needs
#   little CONSTANT adjustment. They cannot see a mismatch in the SHAPE of the
#   rubric_curve, because that mismatch lives in the fixed offset(log(prior_
#   strokes_cell)), not in any random intercept.
#
#   A raw (unpooled) descriptive found observed strokes running ~0.87 BELOW the
#   curve at rubric 1, flattening to ~0 at rubric 5 — the signature of a curve
#   too steep at the low end. That descriptive tangles hole/sector effects
#   together. This script asks the fitted model the same question cleanly:
#
#     Does the residual gradient survive the fit?
#
#   If observed mean strokes fall INSIDE the posterior-predictive interval at
#   every rubric bin -> curve shape is sound, re-anchor only the global level.
#   If observed falls BELOW the interval at low rubric and inside at high rubric
#   -> the gradient survived; the curve needs re-anchoring, not just the level.
#
# SECONDARY cut: same residual by sector_type, to distinguish "the whole curve
# is too steep" from "a couple of low-scoring sector types are miscalibrated"
# (a different fix). Not taken finer than sector_type — per-cell PPC at 66%
# singletons is noise.
#
# Inputs:  aqmod_fit_v0.3.rds   (written by aqmod_model_v0.3.R)
# Outputs: aqmod_ppc_by_rubric_v0.1.csv
#          aqmod_ppc_by_sector_type_v0.1.csv
#          aqmod_ppc_v0.1.pdf   (two panels)
# =============================================================================

library(brms)
library(dplyr)
library(tidyr)
library(readr)
library(ggplot2)

set.seed(1)

fit_path   <- "aqmod_fit_v0.3.rds"
rubric_csv <- "rubric_scores_v0.2.csv"
stopifnot(file.exists(fit_path), file.exists(rubric_csv))
fit <- readRDS(fit_path)
dat <- fit$data

cat(sprintf("Loaded fit: %d observations.\n", nrow(dat)))

# brms stores in fit$data ONLY the columns the formula references:
# strokes_from_sector, prior_strokes_cell, and the grouping factors
# (hole, sector_type, sector_id, pin). rubric_score is NOT among them — it was
# consumed into prior_strokes_cell during prep and dropped. Reconstruct it by
# splitting sector_id (== "hole:sector") and joining the rubric lookup on
# (hole, sector, pin). A missed join would silently drop rows from the bins, so
# assert zero unmatched.
stopifnot(all(c("sector_id", "pin", "sector_type",
                "strokes_from_sector") %in% names(dat)))

rub <- read_csv(rubric_csv, col_types = cols(
         hole = "i", sector = "c", pin = "i", rubric_score = "d")) %>%
       mutate(sector_id = paste(hole, sector, sep = ":"),
              pin = factor(pin)) %>%
       select(sector_id, pin, rubric_score)

dat <- dat %>%
  mutate(.row = row_number()) %>%
  left_join(rub, by = c("sector_id", "pin"))

n_unmatched <- sum(is.na(dat$rubric_score))
if (n_unmatched > 0) {
  bad <- dat %>% filter(is.na(rubric_score)) %>%
           distinct(sector_id, pin) %>% head(20)
  print(as.data.frame(bad))
  stop(sprintf("rubric join left %d rows without a rubric_score (see above).",
               n_unmatched))
}
cat("rubric_score reconstructed for all rows (0 unmatched).\n")

# ---- SECTION 1: posterior-predictive draws ----------------------------------
# Full predictive (re_formula = NULL uses all random effects, matching v0.3's
# per-cell posterior). yrep is [draws x observations]; each column is one
# played row, each row a replicated dataset.
yrep <- posterior_predict(fit, re_formula = NULL)
cat(sprintf("posterior_predict: %d draws x %d obs\n", nrow(yrep), ncol(yrep)))

# ---- SECTION 2: helper — observed vs PP by a grouping column ----------------
# For each group: observed mean strokes, and the PP distribution of the group
# mean (so the interval is around the MEAN, the quantity we compare, not around
# a single new observation). "in_interval" is the pass/fail per bin.
ppc_by <- function(group_col, probs = c(0.05, 0.95)) {
  g <- dat[[group_col]]
  levels_g <- sort(unique(g))

  # PP distribution of each group's mean: for every posterior draw, average the
  # replicated strokes within the group -> one mean per draw -> summarise.
  rows <- lapply(levels_g, function(lv) {
    idx <- which(g == lv)
    draw_means <- rowMeans(yrep[, idx, drop = FALSE])   # length = n_draws
    obs_mean   <- mean(dat$strokes_from_sector[idx])
    lo <- unname(quantile(draw_means, probs[1]))
    hi <- unname(quantile(draw_means, probs[2]))
    tibble(
      group      = as.character(lv),
      n          = length(idx),
      obs_mean   = obs_mean,
      pp_mean    = mean(draw_means),
      pp_lo      = lo,
      pp_hi      = hi,
      resid      = obs_mean - mean(draw_means),   # obs minus model
      in_interval = obs_mean >= lo & obs_mean <= hi
    )
  })
  bind_rows(rows)
}

# ---- SECTION 3: primary — by rubric_score -----------------------------------
by_rubric <- ppc_by("rubric_score") %>%
  mutate(rubric_score = as.numeric(group)) %>%
  arrange(rubric_score)

cat("\n--- PPC by rubric_score (PRIMARY) ---\n")
cat("obs_mean inside [pp_lo, pp_hi] => curve sound at that rubric level.\n\n")
print(as.data.frame(by_rubric %>%
        select(rubric_score, n, obs_mean, pp_mean, pp_lo, pp_hi, resid, in_interval)),
      row.names = FALSE, digits = 3)

n_out <- sum(!by_rubric$in_interval)
cat(sprintf("\nBins where observed falls OUTSIDE the PP interval: %d of %d\n",
            n_out, nrow(by_rubric)))
if (n_out > 0) {
  miss <- by_rubric %>% filter(!in_interval) %>%
    mutate(dir = ifelse(resid < 0, "obs BELOW model (curve too steep here)",
                                    "obs ABOVE model (curve too shallow here)"))
  cat("Direction of each miss (read against re-anchor decision):\n")
  print(as.data.frame(miss %>% select(rubric_score, n, resid, dir)),
        row.names = FALSE, digits = 3)
} else {
  cat("Curve shape is consistent with the data at every rubric level.\n")
  cat("=> Supports re-anchoring the global LEVEL only, not the curve shape.\n")
}

# ---- SECTION 4: secondary — by sector_type ----------------------------------
by_type <- ppc_by("sector_type") %>% arrange(resid)

cat("\n--- PPC by sector_type (SECONDARY) ---\n")
cat("Localises any miss: is the whole curve off, or a few sector types?\n\n")
print(as.data.frame(by_type %>%
        select(group, n, obs_mean, pp_mean, pp_lo, pp_hi, resid, in_interval)),
      row.names = FALSE, digits = 3)

# ---- SECTION 5: plots --------------------------------------------------------
p1 <- ggplot(by_rubric, aes(x = rubric_score)) +
  geom_ribbon(aes(ymin = pp_lo, ymax = pp_hi), alpha = 0.25) +
  geom_line(aes(y = pp_mean)) +
  geom_point(aes(y = obs_mean, colour = in_interval), size = 2.4) +
  scale_colour_manual(values = c(`TRUE` = "black", `FALSE` = "red"),
                      name = "obs in PP interval") +
  scale_x_continuous(breaks = sort(unique(by_rubric$rubric_score))) +
  labs(title = "PPC by rubric score",
       subtitle = "Ribbon = 90% PP interval of the bin mean; points = observed mean",
       x = "rubric score", y = "mean strokes from sector") +
  theme_minimal(base_size = 11)

p2 <- ggplot(by_type, aes(x = reorder(group, resid), y = resid,
                          colour = in_interval)) +
  geom_hline(yintercept = 0, linewidth = 0.3) +
  geom_pointrange(aes(ymin = pp_lo - pp_mean, ymax = pp_hi - pp_mean)) +
  scale_colour_manual(values = c(`TRUE` = "black", `FALSE` = "red"),
                      name = "obs in PP interval") +
  coord_flip() +
  labs(title = "PPC residual by sector type",
       subtitle = "Residual = observed mean - PP mean; range = 90% PP interval",
       x = NULL, y = "observed - model (strokes)") +
  theme_minimal(base_size = 11)

# Two-page PDF, no extra packages: open a pdf device and print each panel.
pdf("aqmod_ppc_v0.1.pdf", width = 8, height = 5)
print(p1)
print(p2)
dev.off()

write_csv(by_rubric %>% select(rubric_score, n, obs_mean, pp_mean, pp_lo, pp_hi,
                               resid, in_interval),
          "aqmod_ppc_by_rubric_v0.1.csv")
write_csv(by_type   %>% select(group, n, obs_mean, pp_mean, pp_lo, pp_hi,
                               resid, in_interval),
          "aqmod_ppc_by_sector_type_v0.1.csv")

cat("\nWrote aqmod_ppc_by_rubric_v0.1.csv, aqmod_ppc_by_sector_type_v0.1.csv, ",
    "aqmod_ppc_v0.1.pdf\n", sep = "")
