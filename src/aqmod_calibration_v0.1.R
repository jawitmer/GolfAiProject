# =============================================================================
# aqmod_calibration_v0.1.R
# In-sample calibration of the v0.5 regulation-reach predictor.
# Randomized PIT per round: u = P(X < y) + V * P(X = y), V ~ U(0,1)
# (exactly uniform under a correct model for integer outcomes).
# Requires aqmod_predict_round_v0.3.R (config + prep_round) in the same folder.
# =============================================================================

source("aqmod_predict_round_v0.3.R")      # libs, fit_rds, csv paths, prep_round()

N_EXPECTED <- 105                          # must match the fit's round count
round_files <- list.files(".", pattern = "^aqmod_2026-.*\\.csv$", full.names = TRUE)
stopifnot(length(round_files) == N_EXPECTED)

fit    <- readRDS(fit_rds)
types  <- read_csv(types_csv,  col_types = cols(hole = "i", sector = "c", sector_type = "c"))
rubric <- read_csv(rubric_csv, col_types = cols(hole = "i", sector = "c", pin = "i", rubric_score = "d"))
lp_mean <- attr(fit, "lp_mean"); stopifnot(is.numeric(lp_mean), length(lp_mean) == 1)

set.seed(1)
res <- do.call(rbind, lapply(round_files, function(f) {
  d   <- prep_round(f, types, rubric, lp_mean)
  reg <- d$par - 2
  pp  <- posterior_predict(fit, newdata = d, allow_new_levels = TRUE, re_formula = NULL)
  stopifnot(all(pp %in% 1:4))
  s   <- rowSums(sweep(pp, 2, reg, "+"))
  y   <- sum(reg + d$strokes_from_sector)
  data.frame(round = basename(f), holes = nrow(d), actual = y,
             median = median(s), sd = sd(s),
             u = mean(s < y) + runif(1) * mean(s == y),
             in50 = y >= quantile(s, .25) & y <= quantile(s, .75),
             in90 = y >= quantile(s, .05) & y <= quantile(s, .95))
}))

u <- res$u; n <- length(u)
sim_var <- replicate(10000, var(runif(n)))
v_lo <- quantile(sim_var, .025); v_hi <- quantile(sim_var, .975)
chi  <- chisq.test(table(cut(u, seq(0, 1, .1), include.lowest = TRUE)))
ks   <- ks.test(u, "punif")

r1 <- mean(u) >= .445 && mean(u) <= .555
r2 <- var(u) >= v_lo && var(u) <= v_hi
r3 <- chi$p.value >= .05
r4 <- ks$p.value  >= .05

cat(sprintf("\nRounds %d   holes %d\n", n, sum(res$holes)))
cat(sprintf("R1 mean(u)  %.3f  [.445,.555]           %s\n", mean(u), if (r1) "PASS" else "FAIL"))
cat(sprintf("R2 var(u)   %.4f [%.4f,%.4f] (1/12=.0833) %s\n", var(u), v_lo, v_hi, if (r2) "PASS" else "FAIL"))
cat(sprintf("R3 chi2 p   %.3f                         %s\n", chi$p.value, if (r3) "PASS" else "FAIL"))
cat(sprintf("R4 KS p     %.3f                         %s\n", ks$p.value,  if (r4) "PASS" else "FAIL"))
cat("PIT bins (10 x 0.1):", as.vector(chi$observed), "\n")
cat(sprintf("Coverage (descriptive): 50%% PI %.2f   90%% PI %.2f\n", mean(res$in50), mean(res$in90)))
cat(sprintf("VERDICT: %s\n", if (r1 && r2 && r3 && r4) "calibrated (in-sample)" else "NOT calibrated - see failing rule(s)"))

write_csv(res, sprintf("aqmod_calibration_v0.1_%dr.csv", n))
