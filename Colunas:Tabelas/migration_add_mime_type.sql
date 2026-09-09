-- Migration: Adicionar coluna mime_type na tabela messages
-- Necessário para armazenar o MIME type real das mídias recebidas via webhook
-- (image/jpeg, audio/ogg; codecs=opus, video/mp4, etc.)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type TEXT;
