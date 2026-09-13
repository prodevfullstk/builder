-- Migration: Distributed Rate Limiting Table and Atomic Function
-- Target Table: public.rate_limits

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '1 hour')
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages rate limits" ON public.rate_limits;
CREATE POLICY "Service role manages rate limits" ON public.rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.check_rate_limit_atomic(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_new_reset TIMESTAMPTZ;
  v_count INT;
BEGIN
  SELECT * INTO v_record FROM public.rate_limits WHERE key = p_key FOR UPDATE;
  IF NOT FOUND OR v_record.reset_at <= v_now THEN
    v_new_reset := v_now + (p_window_seconds || ' seconds')::interval;
    INSERT INTO public.rate_limits (key, count, reset_at)
    VALUES (p_key, 1, v_new_reset)
    ON CONFLICT (key) DO UPDATE
    SET count = 1, reset_at = v_new_reset;
    
    RETURN jsonb_build_object(
      'allowed', true,
      'limit', p_max,
      'remaining', p_max - 1,
      'resetSeconds', p_window_seconds
    );
  END IF;

  IF v_record.count >= p_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'limit', p_max,
      'remaining', 0,
      'resetSeconds', GREATEST(1, EXTRACT(EPOCH FROM (v_record.reset_at - v_now))::int)
    );
  END IF;

  v_count := v_record.count + 1;
  UPDATE public.rate_limits SET count = v_count WHERE key = p_key;

  RETURN jsonb_build_object(
    'allowed', true,
    'limit', p_max,
    'remaining', p_max - v_count,
    'resetSeconds', GREATEST(1, EXTRACT(EPOCH FROM (v_record.reset_at - v_now))::int)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit_atomic TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
