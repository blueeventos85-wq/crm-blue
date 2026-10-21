-- Migration: leads.quantidade_horas numérico → TEXT no formato "HH:mm"
--
-- O campo "Quantidade de Horas" do lead passou a aceitar duração em
-- horas e minutos (ex.: "02:25", "04:30"), igual ao formato já usado
-- em leads.hora_inicio / leads.hora_final (TEXT).
--
-- Conversão dos valores legados:
--   2    → "02:00"   (horas inteiras)
--   2.5  → "02:30"   (horas decimais)
--   0    → NULL      (nunca preenchido — o form antigo gravava 0)
--   NULL → NULL

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS quantidade_horas TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'leads'
       AND column_name  = 'quantidade_horas'
       AND data_type   <> 'text'
  ) THEN
    -- remove o default numérico antes da troca de tipo (evita erro de cast)
    ALTER TABLE public.leads
      ALTER COLUMN quantidade_horas DROP DEFAULT;

    ALTER TABLE public.leads
      ALTER COLUMN quantidade_horas TYPE TEXT
      USING (
        CASE
          WHEN quantidade_horas IS NULL THEN NULL
          WHEN quantidade_horas::numeric = 0 THEN NULL
          ELSE lpad(floor(round(quantidade_horas::numeric * 60) / 60)::text, 2, '0')
            || ':'
            || lpad((round(quantidade_horas::numeric * 60)::bigint % 60)::text, 2, '0')
        END
      );
  END IF;
END $$;
