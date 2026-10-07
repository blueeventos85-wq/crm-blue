-- ============================================
-- MIGRAÇÃO: miniatura da mídia (media_preview)
-- Base64 JPEG puro (~320px) vindo do jpegThumbnail do WhatsApp (mensagens
-- recebidas) ou gerado no navegador antes do envio (mensagens enviadas).
-- Serve só para pintar a conversa na hora; a mídia original continua no
-- proxy/Storage e a coluna nunca guarda URL ou token.
-- ============================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_preview TEXT;

COMMENT ON COLUMN messages.media_preview IS 'Miniatura JPEG em base64 puro (sem prefixo data:) para render imediato da mídia';

-- Nada de policy nova: media_preview é lido/escrito junto com a linha da
-- mensagem, já coberta pelas policies existentes de SELECT/INSERT/UPDATE.
