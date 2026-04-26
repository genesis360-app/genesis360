-- Migration 068: función SECURITY DEFINER para que cualquier usuario pueda actualizar su propio avatar_url
-- La policy users_update_owner solo permite OWNER/ADMIN → bloqueaba a otros roles silenciosamente
CREATE OR REPLACE FUNCTION update_user_avatar(p_avatar_url TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE users SET avatar_url = p_avatar_url WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
