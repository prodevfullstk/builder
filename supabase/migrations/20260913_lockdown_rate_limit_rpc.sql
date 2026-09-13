-- Migration: Lock down check_rate_limit_atomic RPC permissions
-- Target Function: public.check_rate_limit_atomic(text, integer, integer)

-- 1. Explicitly revoke execute privileges from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.check_rate_limit_atomic(TEXT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit_atomic(TEXT, INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit_atomic(TEXT, INT, INT) FROM authenticated;

-- 2. Grant execute privilege strictly to service_role and postgres superuser
GRANT EXECUTE ON FUNCTION public.check_rate_limit_atomic(TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_atomic(TEXT, INT, INT) TO postgres;

-- 3. Hardened stored procedure with explicit search_path and boundary bounds
CREATE OR REPLACE FUNCTION public.check_rate_limit_atomic(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_new_reset TIMESTAMPTZ;
  v_count INT;
  v_clamped_max INT;
  v_clamped_window INT;
BEGIN
  -- Validate key format
  IF p_key IS NULL OR length(trim(p_key)) = 0 OR length(p_key) > 256 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Invalid rate limit key',
      'limit', 0,
      'remaining', 0,
      'resetSeconds', 3600
    );
  END IF;

  -- Clamp max and window to sane operational limits to prevent abuse
  v_clamped_max := LEAST(GREATEST(p_max, 1), 10000);
  v_clamped_window := LEAST(GREATEST(p_window_seconds, 1), 86400);

  SELECT * INTO v_record FROM public.rate_limits WHERE key = p_key FOR UPDATE;
  IF NOT FOUND OR v_record.reset_at <= v_now THEN
    v_new_reset := v_now + (v_clamped_window || ' seconds')::interval;
    INSERT INTO public.rate_limits (key, count, reset_at)
    VALUES (p_key, 1, v_new_reset)
    ON CONFLICT (key) DO UPDATE
    SET count = 1, reset_at = v_new_reset;
    
    RETURN jsonb_build_object(
      'allowed', true,
      'limit', v_clamped_max,
      'remaining', v_clamped_max - 1,
      'resetSeconds', v_clamped_window
    );
  END IF;

  IF v_record.count >= v_clamped_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'limit', v_clamped_max,
      'remaining', 0,
      'resetSeconds', GREATEST(1, EXTRACT(EPOCH FROM (v_record.reset_at - v_now))::int)
    );
  END IF;

  v_count := v_record.count + 1;
  UPDATE public.rate_limits SET count = v_count WHERE key = p_key;

  RETURN jsonb_build_object(
    'allowed', true,
    'limit', v_clamped_max,
    'remaining', v_clamped_max - v_count,
    'resetSeconds', GREATEST(1, EXTRACT(EPOCH FROM (v_record.reset_at - v_now))::int)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
