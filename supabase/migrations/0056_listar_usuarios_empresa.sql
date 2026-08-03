-- 0056_listar_usuarios_empresa.sql — Fase 4, Task 4.2: usuarios identificables
--
-- UsuariosPage.jsx mostraba `usuarioId.slice(0,8)` porque nom_usuarios_empresas
-- (0014) no guarda el email — vive en auth.users, que el cliente no puede leer
-- directo (no hay RLS ahí y el anon key no tiene acceso). Se resuelve con un
-- RPC SECURITY DEFINER que cruza ambas tablas, gateado por el mismo criterio
-- que invitar-usuario (Task 1.4): admin de ESA empresa puntual, o superadmin.
CREATE OR REPLACE FUNCTION listar_usuarios_empresa(p_empresa_id UUID)
RETURNS TABLE (
  id UUID,
  usuario_id UUID,
  empresa_id UUID,
  rol TEXT,
  alcance_tipo TEXT,
  alcance_id UUID,
  email TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ue.id, ue.usuario_id, ue.empresa_id, ue.rol, ue.alcance_tipo, ue.alcance_id, u.email
  FROM nom_usuarios_empresas ue
  LEFT JOIN auth.users u ON u.id = ue.usuario_id
  WHERE ue.empresa_id = p_empresa_id
    AND (is_superadmin() OR auth_empresa_id() = p_empresa_id)
    AND has_rol_nomina(ARRAY['admin'])
  ORDER BY ue.rol;
$$;
GRANT EXECUTE ON FUNCTION listar_usuarios_empresa(UUID) TO authenticated;
