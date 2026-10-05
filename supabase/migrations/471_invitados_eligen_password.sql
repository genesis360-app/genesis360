-- 471 — Invitados por correo que nunca eligieron contraseña (2026-10-05, caso El Tilo con Hotmail)
--
-- El link de invitación (EF invite-user → inviteUserByEmail) inicia sesión UNA vez y nunca le pedía una contraseña al
-- invitado. Con Gmail no se notaba ("Continuar con Google"); con Hotmail, Outlook o un correo de empresa, después del
-- primer ingreso el usuario no tenía cómo volver a entrar (y el login no tenía "¿Olvidaste tu contraseña?").
--
-- Desde ahora invite-user crea al invitado con `debe_cambiar_password = true` y el AuthGuard le pide elegirla al entrar
-- por el link. Esta migración le pone la misma marca a los invitados que YA existen y quedaron en esa situación:
--   · invitados por correo (`auth.users.invited_at` no nulo), no "sin correo" (u.genesis360.pro),
--   · sin identidad de Google (esos entran con Google),
--   · que nunca volvieron a entrar después del link (último ingreso a menos de 2 minutos de confirmar) o que todavía
--     no lo abrieron.
-- Al entrar la próxima vez (por el link pendiente o por "¿Olvidaste tu contraseña?") eligen su contraseña. No cambia
-- ninguna contraseña ni corta ninguna sesión. El guard de la mig 434 solo frena la transición true → false.

UPDATE public.users u
   SET debe_cambiar_password = true
  FROM auth.users a
 WHERE a.id = u.id
   AND a.invited_at IS NOT NULL
   AND a.email NOT LIKE '%@u.genesis360.pro'
   AND COALESCE(u.debe_cambiar_password, false) = false
   AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = a.id AND i.provider = 'google')
   AND (a.last_sign_in_at IS NULL OR a.last_sign_in_at <= COALESCE(a.email_confirmed_at, a.last_sign_in_at) + interval '2 minutes');
