ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS service_style text DEFAULT 'dine_in'::text NOT NULL;

ALTER TABLE public.locations
    DROP CONSTRAINT IF EXISTS locations_service_style_valid;

ALTER TABLE public.locations
    ADD CONSTRAINT locations_service_style_valid
    CHECK (service_style = ANY (ARRAY['dine_in'::text, 'takeaway'::text]));
