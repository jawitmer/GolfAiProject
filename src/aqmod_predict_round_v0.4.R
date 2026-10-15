# =============================================================================
# aqmod_predict_round_v0.4.R
# Predict a round's "regulation-reach" score from a single AQmod round CSV,
# using the fitted v0.5.1 ordinal (cumulative logit) model. Compares the model's predicted distribution to
# what actually happened that round (same sectors).
#
# "Regulation-reach" score = sum over played holes of
#       (par - 2)  +  strokes_from_sector
# i.e. assume each sector was reached in regulation (GIR baseline), and let the
# model supply the from-sector strokes. This isolates approach + short game; it
# does NOT try to predict the true total, which also depends on tee-to-green
# play the model never sees.
#
# Requires: aqmod_fit_v0.5.1_105r.rds   (written by aqmod_model_v0.5.1.R)
#           AQ_sector_types_v0.2.csv, rubric_scores_v0.2.csv  (same as fitting)
#
# Usage:  source this file, then:  predict_round("aqmod_2026-06-12.csv")
# =============================================================================

library(brms)
library(dplyr)
library(tidyr)
library(readr)
library(stringr)

# ---- config (must match the fitting script) --------------------------------
fit_rds    <- "aqmod_fit_v0.5.1_105r.rds"
types_csv  <- "AQ_sector_types_v0.2.csv"
rubric_csv <- "rubric_scores_v0.2.csv"
PI         <- 0.90          # predictive interval width

# ---- prep one round CSV exactly as the model did ----------------------------
prep_round <- function(csv_path, types, rubric) {
  raw <- read_csv(csv_path, col_types = cols(.default = "c"))
  d <- raw %>%
    filter(!is.na(sector), str_trim(sector) != "") %>%
    mutate(
      hole   = as.integer(hole),
      pin    = as.integer(pin),
      par    = as.integer(par),
      sector = str_remove(sector, "^S"),
      strokes_from_sector = as.integer(strokes_from_sector),
      score  = as.integer(score)
    ) %>%
    filter(!is.na(strokes_from_sector)) %>%
    left_join(types,  by = c("hole", "sector")) %>%
    left_join(rubric, by = c("hole", "sector", "pin"))

  miss_type   <- sum(is.na(d$sector_type))
  miss_rubric <- sum(is.na(d$rubric_score))
  if (miss_type > 0 || miss_rubric > 0)
    stop(sprintf("Unmatched rows: %d missing sector_type, %d missing rubric.",
                 miss_type, miss_rubric))
  if (any(is.na(d$par)))
    stop("Some played holes have no par in the CSV; cannot form regulation reach.")
  if (!all(d$rubric_score %in% seq(1, 5, 0.5)))
    stop("Rubric score off the 0.5 grid.")

  d %>% mutate(
    rub = factor(rubric_score, levels = seq(1, 5, 0.5), ordered = TRUE),
    hole        = factor(hole),
    sector_id   = factor(paste(hole, sector, sep = ":")),
    sector_type = factor(sector_type),
    pin         = factor(pin)
  )
}

# ---- main -------------------------------------------------------------------
predict_round <- function(csv_path) {
  fit    <- readRDS(fit_rds)
  types  <- read_csv(types_csv,  col_types = cols(hole = "i", sector = "c",
                                                  sector_type = "c"))
  rubric <- read_csv(rubric_csv, col_types = cols(hole = "i", sector = "c",
                                                  pin = "i", rubric_score = "d"))
  d <- prep_round(csv_path, types, rubric)
  stopifnot(identical(levels(d$rub), levels(fit$data$rub)))
  nholes <- nrow(d)
  reg    <- d$par - 2                       # regulation reach per hole

  # Posterior predictive draws of strokes_from_sector: [ndraws x nholes].
  # allow_new_levels: a day may include (sector,pin) cells unseen in training;
  # with near-zero RE SDs they collapse to the population mean.
  pp <- posterior_predict(fit, newdata = d, allow_new_levels = TRUE,
                          re_formula = NULL)
  # Ordinal pp = category index; equals strokes only because levels are 1:4.
  stopifnot(all(pp %in% 1:4))

  # Per-draw round score = sum over holes of (par-2) + predicted strokes.
  draw_scores <- rowSums(sweep(pp, 2, reg, "+"))
  lo <- (1 - PI) / 2; hi <- 1 - lo
  q  <- quantile(draw_scores, c(lo, 0.5, hi))

  # Actual regulation-reach (same sectors, your real from-sector strokes).
  actual_reg   <- sum(reg + d$strokes_from_sector)
  actual_total <- sum(d$score)
  pctile       <- mean(draw_scores <= actual_reg) * 100   # where actual reg lands
  reach_excess <- actual_total - actual_reg               # tee-to-green cost

  # ---- report ----
  cat(sprintf("\nRound: %s   (%d holes played, par %d)\n",
              basename(csv_path), nholes, sum(d$par)))
  cat(sprintf("\nPredicted regulation-reach score:\n"))
  cat(sprintf("  median %.0f   %d%% PI [%.0f, %.0f]   (mean %.1f)\n",
              q[2], round(PI*100), q[1], q[3], mean(draw_scores)))
  cat(sprintf("\nActual this round:\n"))
  cat(sprintf("  regulation-reach score  %d   (%.0fth pctile of prediction)\n",
              actual_reg, pctile))
  cat(sprintf("  total score             %d\n", actual_total))
  cat(sprintf("  reach excess (tee->green, not modeled)  %+d  (%.2f / hole)\n",
              reach_excess, reach_excess / nholes))
  cat("\nReading: the PI is what the model expects your from-sector play to\n")
  cat("produce off these sectors, assuming regulation reach. Your actual\n")
  cat("regulation-reach percentile says how your short game that day compared\n")
  cat("to expectation. Reach excess is the part the model does not see.\n\n")

  invisible(list(draw_scores = draw_scores, q = q,
                 actual_reg = actual_reg, actual_total = actual_total,
                 pctile = pctile, reach_excess = reach_excess, holes = d))
}
