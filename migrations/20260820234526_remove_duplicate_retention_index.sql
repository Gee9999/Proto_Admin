-- The live schema already has security_rate_limits_window_idx on window_start.
-- Remove the equivalent index created by the preceding live migration. Fresh
-- databases never create it because the source migration has been corrected.
drop index if exists public.security_rate_limits_window_start_idx;
