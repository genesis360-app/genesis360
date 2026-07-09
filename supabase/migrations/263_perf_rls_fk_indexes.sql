-- =============================================================================
-- Migration 263: Performance — RLS auth.uid() re-evaluation + FK missing indexes
-- =============================================================================
-- Origen: Supabase Performance Advisors (linter) detectó dos problemas de
-- performance (NO de seguridad ni de comportamiento) sobre 99 tablas:
--
--   1) "auth_rls_initplan": 116 policies RLS llaman a auth.uid() directamente
--      en su expresión USING/WITH CHECK. Postgres reevalúa esa función por
--      CADA FILA evaluada, en vez de una sola vez por query. Envolviendo la
--      llamada en (select auth.uid()) Postgres la trata como un InitPlan y la
--      resuelve una única vez por statement (mismo resultado, mucho más
--      rápido en tablas grandes). Se usa ALTER POLICY para tocar SOLO la
--      expresión USING/WITH CHECK de cada policy — el resto de la definición
--      (FOR SELECT/INSERT/UPDATE/DELETE/ALL, TO role) queda exactamente
--      igual. La lógica de cada policy es IDÉNTICA a la original, carácter
--      por carácter, salvo el wrap de auth.uid().
--
--   2) "unindexed_foreign_keys": 195 columnas FK sin índice. Sin índice, cada
--      UPDATE/DELETE en la tabla referenciada dispara un seq scan sobre la
--      tabla hija para verificar la FK, y los JOIN por esa columna no pueden
--      usar index scan. Se agrega un índice btree simple por columna.
--
-- Esta migración NO cambia aislamiento multi-tenant, NO cambia qué filas ve
-- cada policy, NO cambia constraints ni datos — es estrictamente performance.
-- Es idempotente: ALTER POLICY siempre sobreescribe la expresión (no falla
-- si se re-corre) y CREATE INDEX IF NOT EXISTS tampoco falla en re-corrida.
-- =============================================================================

-- =============================================================================
-- SECCIÓN 1 — RLS: wrap auth.uid() en (select auth.uid()) — 116 policies
-- =============================================================================

-- actividad_log
ALTER POLICY "actividad_log_insert" ON actividad_log
  WITH CHECK ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) );
ALTER POLICY "actividad_log_select" ON actividad_log
  USING ( is_admin() OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO', 'SUPERVISOR')) );

-- aging_profile_reglas
ALTER POLICY "aging_profile_reglas_tenant" ON aging_profile_reglas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- aging_profiles
ALTER POLICY "aging_profiles_tenant" ON aging_profiles
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- api_keys
ALTER POLICY "api_keys_owner_manage" ON api_keys
  USING ( tenant_id IN ( SELECT tenant_id FROM users WHERE id = (select auth.uid()) AND rol IN ('OWNER', 'ADMIN') ) );
ALTER POLICY "api_keys_tenant" ON api_keys
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- archivos_biblioteca
ALTER POLICY "archivos_biblioteca_tenant" ON archivos_biblioteca
  USING ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) );

-- autorizaciones_cc
ALTER POLICY "autoriz_cc_tenant" ON autorizaciones_cc
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- autorizaciones_gasto
ALTER POLICY "autoriz_gasto_tenant" ON autorizaciones_gasto
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- autorizaciones_inventario
ALTER POLICY "aut_inv_tenant" ON autorizaciones_inventario
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- boveda_arqueos
ALTER POLICY "boveda_arqueos_solo_dueno" ON boveda_arqueos
  USING ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) AND EXISTS ( SELECT 1 FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') ) )
  WITH CHECK ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) AND EXISTS ( SELECT 1 FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') ) );

-- boveda_retiros
ALTER POLICY "boveda_retiros_solo_dueno" ON boveda_retiros
  USING ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) AND EXISTS ( SELECT 1 FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') ) )
  WITH CHECK ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) AND EXISTS ( SELECT 1 FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') ) );

-- caja_traspasos
ALTER POLICY "traspasos_tenant" ON caja_traspasos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- canales_venta
ALTER POLICY "canales_venta_tenant" ON canales_venta
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- categorias
ALTER POLICY "categorias_insert" ON categorias
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- categorias_gasto
ALTER POLICY "categorias_gasto_tenant" ON categorias_gasto
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cheques
ALTER POLICY "cheques_tenant" ON cheques
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cierres_contables
ALTER POLICY "cierres_tenant" ON cierres_contables
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cliente_creditos
ALTER POLICY "cliente_creditos_tenant" ON cliente_creditos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cliente_domicilios
ALTER POLICY "cli_dom_tenant" ON cliente_domicilios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cliente_notas
ALTER POLICY "cli_notas_tenant" ON cliente_notas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- clientes
ALTER POLICY "clientes_tenant" ON clientes
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- codigo_perfiles
ALTER POLICY "codigo_perfiles_tenant" ON codigo_perfiles
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- combo_items
ALTER POLICY "combo_items_tenant" ON combo_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- combos
ALTER POLICY "tenant_isolation" ON combos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- courier_credenciales
ALTER POLICY "courier_credenciales_tenant" ON courier_credenciales
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- courier_factura_lineas
ALTER POLICY "courier_factura_lineas_tenant" ON courier_factura_lineas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- courier_facturas
ALTER POLICY "courier_facturas_tenant" ON courier_facturas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- courier_tarifas
ALTER POLICY "courier_tarifas_tenant" ON courier_tarifas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- cuentas_origen
ALTER POLICY "cuentas_origen_tenant" ON cuentas_origen
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- devolucion_items
ALTER POLICY "devitem_tenant_insert" ON devolucion_items
  WITH CHECK (devolucion_id IN ( SELECT id FROM devoluciones WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) ));
ALTER POLICY "devitem_tenant_select" ON devolucion_items
  USING (devolucion_id IN ( SELECT id FROM devoluciones WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) ));

-- devolucion_proveedor_items
ALTER POLICY "devprov_items_tenant" ON devolucion_proveedor_items
  USING (devolucion_id IN (SELECT id FROM devoluciones_proveedor WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))))
  WITH CHECK (devolucion_id IN (SELECT id FROM devoluciones_proveedor WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))));

-- devoluciones
ALTER POLICY "dev_tenant_insert" ON devoluciones
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- devoluciones_proveedor
ALTER POLICY "devprov_tenant" ON devoluciones_proveedor
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- empleados
ALTER POLICY "empleados_supervisor" ON empleados
  USING (supervisor_id = (select auth.uid()));
ALTER POLICY "empleados_tenant" ON empleados
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- envio_incidencias
ALTER POLICY "envio_incidencias_tenant" ON envio_incidencias
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- envio_otp
ALTER POLICY "envio_otp_tenant" ON envio_otp
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- envio_pod_fotos
ALTER POLICY "envio_pod_fotos_tenant" ON envio_pod_fotos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- estados_inventario
ALTER POLICY "estados_tenant" ON estados_inventario
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- gasto_cuotas
ALTER POLICY "gasto_cuotas_tenant" ON gasto_cuotas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- gastos_fijos
ALTER POLICY "gastos_fijos_tenant" ON gastos_fijos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- grupo_estado_items
ALTER POLICY "grupo_items_tenant" ON grupo_estado_items
  USING (grupo_id IN (SELECT id FROM grupos_estados WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))));

-- grupos_estados
ALTER POLICY "grupos_tenant" ON grupos_estados
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- hoja_ruta_envios
ALTER POLICY "hoja_ruta_envios_tenant" ON hoja_ruta_envios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- hojas_ruta
ALTER POLICY "hojas_ruta_tenant" ON hojas_ruta
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- integration_job_queue
ALTER POLICY "job_queue_tenant" ON integration_job_queue
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- inventario_meli_map
ALTER POLICY "meli_map_tenant" ON inventario_meli_map
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- inventario_tn_map
ALTER POLICY "tn_map_tenant" ON inventario_tn_map
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- kit_recetas
ALTER POLICY "kit_recetas_tenant" ON kit_recetas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- kitting_log
ALTER POLICY "kitting_log_tenant" ON kitting_log
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- meli_credentials
ALTER POLICY "meli_cred_tenant" ON meli_credentials
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- mercadopago_credentials
ALTER POLICY "mp_creds_tenant" ON mercadopago_credentials
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- metodos_pago
ALTER POLICY "metodos_pago_tenant" ON metodos_pago
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- modo_credentials
ALTER POLICY "tenant_isolation" ON modo_credentials
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- motivos_movimiento
ALTER POLICY "motivos_tenant" ON motivos_movimiento
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- notificaciones
ALTER POLICY "notif_delete" ON notificaciones
  USING (user_id = (select auth.uid()));
ALTER POLICY "notif_select" ON notificaciones
  USING (user_id = (select auth.uid()));
ALTER POLICY "notif_update" ON notificaciones
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- producto_estructuras
ALTER POLICY "pe_tenant_delete" ON producto_estructuras
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
ALTER POLICY "pe_tenant_insert" ON producto_estructuras
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
ALTER POLICY "pe_tenant_select" ON producto_estructuras
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
ALTER POLICY "pe_tenant_update" ON producto_estructuras
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- producto_grupos
ALTER POLICY "tenant_isolation" ON producto_grupos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- producto_precios_mayorista
ALTER POLICY "ppm_tenant" ON producto_precios_mayorista
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- producto_stock_minimo_sucursal
ALTER POLICY "psmss_tenant" ON producto_stock_minimo_sucursal
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- producto_ubicacion_sucursal
ALTER POLICY "tenant_isolation" ON producto_ubicacion_sucursal
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- productos
ALTER POLICY "productos_delete_tenant" ON productos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
ALTER POLICY "productos_insert_tenant" ON productos
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
ALTER POLICY "productos_select" ON productos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) OR is_admin());
ALTER POLICY "productos_update_tenant" ON productos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- proveedor_cc_movimientos
ALTER POLICY "pcc_tenant" ON proveedor_cc_movimientos
  USING ( tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) );

-- proveedor_contactos
ALTER POLICY "tenant_isolation" ON proveedor_contactos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- proveedor_cuentas_bancarias
ALTER POLICY "prov_cuentas_tenant" ON proveedor_cuentas_bancarias
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- proveedor_productos
ALTER POLICY "pp_tenant" ON proveedor_productos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- proveedores
ALTER POLICY "proveedores_insert" ON proveedores
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- puntos_venta_afip
ALTER POLICY "pv_tenant" ON puntos_venta_afip
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- repartidores
ALTER POLICY "repartidores_tenant" ON repartidores
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- retenciones_sufridas
ALTER POLICY "ret_tenant" ON retenciones_sufridas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- roles_custom
ALTER POLICY "roles_custom_tenant" ON roles_custom
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_anticipos
ALTER POLICY "rrhh_anticipos_tenant" ON rrhh_anticipos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_asistencia
ALTER POLICY "rrhh_asistencia_tenant" ON rrhh_asistencia
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_capacitaciones
ALTER POLICY "rrhh_capacitaciones_tenant" ON rrhh_capacitaciones
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_conceptos
ALTER POLICY "rrhh_conceptos_tenant" ON rrhh_conceptos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_departamentos
ALTER POLICY "rrhh_departamentos_tenant" ON rrhh_departamentos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_documentos
ALTER POLICY "rrhh_documentos_tenant" ON rrhh_documentos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_documentos_catalogo
ALTER POLICY "rrhh_doc_catalogo_tenant" ON rrhh_documentos_catalogo
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_evaluaciones
ALTER POLICY "rrhh_evaluaciones_tenant" ON rrhh_evaluaciones
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_feriados
ALTER POLICY "feriados_tenant" ON rrhh_feriados
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_fichadas
ALTER POLICY "rrhh_fichadas_tenant" ON rrhh_fichadas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_horas_extra
ALTER POLICY "rrhh_horas_extra_tenant" ON rrhh_horas_extra
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_liquidaciones_finales
ALTER POLICY "rrhh_liq_finales_tenant" ON rrhh_liquidaciones_finales
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_puestos
ALTER POLICY "rrhh_puestos_tenant" ON rrhh_puestos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_salario_items
ALTER POLICY "rrhh_salario_items_tenant" ON rrhh_salario_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_salarios
ALTER POLICY "rrhh_salarios_tenant" ON rrhh_salarios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_tipos_contrato
ALTER POLICY "rrhh_tipos_contrato_tenant" ON rrhh_tipos_contrato
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_vacaciones_saldo
ALTER POLICY "rrhh_vac_sal_tenant" ON rrhh_vacaciones_saldo
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- rrhh_vacaciones_solicitud
ALTER POLICY "rrhh_vac_sol_tenant" ON rrhh_vacaciones_solicitud
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- servicio_items
ALTER POLICY "si_tenant" ON servicio_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- servicio_presupuestos
ALTER POLICY "sp_tenant" ON servicio_presupuestos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- sucursales
ALTER POLICY "tenant_sucursales" ON sucursales
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- support_agents
ALTER POLICY "support_agents_self_read" ON support_agents
  USING (id = (select auth.uid()));

-- tenant_certificates
ALTER POLICY "tenant_certificates_tenant" ON tenant_certificates
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- tenants
ALTER POLICY "tenants_insert_new_user" ON tenants
  WITH CHECK ((select auth.uid()) IS NOT NULL);
ALTER POLICY "tenants_select" ON tenants
  USING (id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) OR is_admin());
ALTER POLICY "tenants_update" ON tenants
  USING ( (id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())) AND EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO','ADMIN'))) OR is_admin() );

-- tiendanube_credentials
ALTER POLICY "tn_creds_tenant" ON tiendanube_credentials
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- traslado_items
ALTER POLICY "traslado_items_tenant" ON traslado_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- traslados
ALTER POLICY "traslados_tenant" ON traslados
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- ubicaciones
ALTER POLICY "ubicaciones_insert" ON ubicaciones
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- unidades_medida
ALTER POLICY "tenant_isolation" ON unidades_medida
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- users
ALTER POLICY "users_delete_self" ON users
  USING (id = (select auth.uid()));
ALTER POLICY "users_insert_self" ON users
  WITH CHECK (id = (select auth.uid()));

-- ventas_externas_logs
ALTER POLICY "ventas_externas_tenant" ON ventas_externas_logs
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- ventas_recurrentes
ALTER POLICY "ventas_rec_tenant" ON ventas_recurrentes
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));

-- =============================================================================
-- SECCIÓN 2 — Índices para columnas FK sin índice — 195 índices
-- =============================================================================

-- actividad_log
CREATE INDEX IF NOT EXISTS idx_actividad_log_usuario_id ON actividad_log(usuario_id);

-- aging_profile_reglas
CREATE INDEX IF NOT EXISTS idx_aging_profile_reglas_estado_id ON aging_profile_reglas(estado_id);
CREATE INDEX IF NOT EXISTS idx_aging_profile_reglas_profile_id ON aging_profile_reglas(profile_id);
CREATE INDEX IF NOT EXISTS idx_aging_profile_reglas_tenant_id ON aging_profile_reglas(tenant_id);

-- aging_profiles
CREATE INDEX IF NOT EXISTS idx_aging_profiles_tenant_id ON aging_profiles(tenant_id);

-- alertas
CREATE INDEX IF NOT EXISTS idx_alertas_producto_id ON alertas(producto_id);

-- archivos_biblioteca
CREATE INDEX IF NOT EXISTS idx_archivos_biblioteca_created_by ON archivos_biblioteca(created_by);

-- autorizaciones_cc
CREATE INDEX IF NOT EXISTS idx_autorizaciones_cc_aprobador_id ON autorizaciones_cc(aprobador_id);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_cc_oc_id ON autorizaciones_cc(oc_id);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_cc_solicitante_id ON autorizaciones_cc(solicitante_id);

-- autorizaciones_gasto
CREATE INDEX IF NOT EXISTS idx_autorizaciones_gasto_aprobador_id ON autorizaciones_gasto(aprobador_id);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_gasto_sucursal_id ON autorizaciones_gasto(sucursal_id);

-- autorizaciones_inventario
CREATE INDEX IF NOT EXISTS idx_autorizaciones_inventario_aprobado_por ON autorizaciones_inventario(aprobado_por);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_inventario_linea_id ON autorizaciones_inventario(linea_id);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_inventario_solicitado_por ON autorizaciones_inventario(solicitado_por);

-- billing_manual_pagos
CREATE INDEX IF NOT EXISTS idx_billing_manual_pagos_registrado_por ON billing_manual_pagos(registrado_por);

-- boveda_arqueos
CREATE INDEX IF NOT EXISTS idx_boveda_arqueos_usuario_id ON boveda_arqueos(usuario_id);

-- boveda_retiros
CREATE INDEX IF NOT EXISTS idx_boveda_retiros_movimiento_id ON boveda_retiros(movimiento_id);

-- caja_arqueos
CREATE INDEX IF NOT EXISTS idx_caja_arqueos_usuario_id ON caja_arqueos(usuario_id);

-- caja_movimientos
CREATE INDEX IF NOT EXISTS idx_caja_movimientos_tenant_id ON caja_movimientos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_caja_movimientos_usuario_id ON caja_movimientos(usuario_id);

-- caja_sesiones
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_cerrado_por_id ON caja_sesiones(cerrado_por_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_usuario_id ON caja_sesiones(usuario_id);

-- caja_traspasos
CREATE INDEX IF NOT EXISTS idx_caja_traspasos_usuario_id ON caja_traspasos(usuario_id);

-- categorias
CREATE INDEX IF NOT EXISTS idx_categorias_tenant_id ON categorias(tenant_id);

-- cheques
CREATE INDEX IF NOT EXISTS idx_cheques_created_by ON cheques(created_by);
CREATE INDEX IF NOT EXISTS idx_cheques_endosado_a_proveedor_id ON cheques(endosado_a_proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cheques_proveedor_id ON cheques(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cheques_sucursal_id ON cheques(sucursal_id);

-- cierres_contables
CREATE INDEX IF NOT EXISTS idx_cierres_contables_cerrado_por ON cierres_contables(cerrado_por);

-- cliente_creditos
CREATE INDEX IF NOT EXISTS idx_cliente_creditos_cliente_id ON cliente_creditos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_creditos_usuario_id ON cliente_creditos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_cliente_creditos_venta_id ON cliente_creditos(venta_id);

-- cliente_notas
CREATE INDEX IF NOT EXISTS idx_cliente_notas_tenant_id ON cliente_notas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cliente_notas_usuario_id ON cliente_notas(usuario_id);

-- clientes
CREATE INDEX IF NOT EXISTS idx_clientes_baja_por ON clientes(baja_por);

-- codigo_perfiles
CREATE INDEX IF NOT EXISTS idx_codigo_perfiles_proveedor_id ON codigo_perfiles(proveedor_id);

-- combo_items
CREATE INDEX IF NOT EXISTS idx_combo_items_producto_id ON combo_items(producto_id);

-- combos
CREATE INDEX IF NOT EXISTS idx_combos_producto_id ON combos(producto_id);
CREATE INDEX IF NOT EXISTS idx_combos_tenant_id ON combos(tenant_id);

-- courier_factura_lineas
CREATE INDEX IF NOT EXISTS idx_courier_factura_lineas_envio_id ON courier_factura_lineas(envio_id);
CREATE INDEX IF NOT EXISTS idx_courier_factura_lineas_tenant_id ON courier_factura_lineas(tenant_id);

-- courier_facturas
CREATE INDEX IF NOT EXISTS idx_courier_facturas_created_by ON courier_facturas(created_by);
CREATE INDEX IF NOT EXISTS idx_courier_facturas_sucursal_id ON courier_facturas(sucursal_id);

-- courier_tarifas
CREATE INDEX IF NOT EXISTS idx_courier_tarifas_sucursal_id ON courier_tarifas(sucursal_id);

-- devolucion_items
CREATE INDEX IF NOT EXISTS idx_devolucion_items_inventario_linea_nueva_id ON devolucion_items(inventario_linea_nueva_id);
CREATE INDEX IF NOT EXISTS idx_devolucion_items_producto_id ON devolucion_items(producto_id);

-- devolucion_proveedor_items
CREATE INDEX IF NOT EXISTS idx_devolucion_proveedor_items_producto_id ON devolucion_proveedor_items(producto_id);

-- devoluciones
CREATE INDEX IF NOT EXISTS idx_devoluciones_created_by ON devoluciones(created_by);

-- devoluciones_proveedor
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_caja_sesion_id ON devoluciones_proveedor(caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_created_by ON devoluciones_proveedor(created_by);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_oc_id ON devoluciones_proveedor(oc_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_oc_reposicion_id ON devoluciones_proveedor(oc_reposicion_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_recepcion_id ON devoluciones_proveedor(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor_sucursal_id ON devoluciones_proveedor(sucursal_id);

-- empleados
CREATE INDEX IF NOT EXISTS idx_empleados_supervisor_id ON empleados(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_empleados_user_id ON empleados(user_id);

-- envio_incidencias
CREATE INDEX IF NOT EXISTS idx_envio_incidencias_tenant_id ON envio_incidencias(tenant_id);

-- envio_items
CREATE INDEX IF NOT EXISTS idx_envio_items_producto_id ON envio_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_envio_items_tenant_id ON envio_items(tenant_id);

-- envio_otp
CREATE INDEX IF NOT EXISTS idx_envio_otp_tenant_id ON envio_otp(tenant_id);

-- envio_pod_fotos
CREATE INDEX IF NOT EXISTS idx_envio_pod_fotos_created_by ON envio_pod_fotos(created_by);

-- envios
CREATE INDEX IF NOT EXISTS idx_envios_created_by ON envios(created_by);
CREATE INDEX IF NOT EXISTS idx_envios_destino_id ON envios(destino_id);
CREATE INDEX IF NOT EXISTS idx_envios_gasto_combustible_id ON envios(gasto_combustible_id);
CREATE INDEX IF NOT EXISTS idx_envios_recurso_id ON envios(recurso_id);
CREATE INDEX IF NOT EXISTS idx_envios_repartidor_id ON envios(repartidor_id);
CREATE INDEX IF NOT EXISTS idx_envios_sucursal_destino_id ON envios(sucursal_destino_id);
CREATE INDEX IF NOT EXISTS idx_envios_sucursal_id ON envios(sucursal_id);

-- estados_inventario
CREATE INDEX IF NOT EXISTS idx_estados_inventario_tenant_id ON estados_inventario(tenant_id);

-- gasto_cuotas
CREATE INDEX IF NOT EXISTS idx_gasto_cuotas_tenant_id ON gasto_cuotas(tenant_id);

-- gastos
CREATE INDEX IF NOT EXISTS idx_gastos_usuario_id ON gastos(usuario_id);

-- gastos_fijos
CREATE INDEX IF NOT EXISTS idx_gastos_fijos_sucursal_id ON gastos_fijos(sucursal_id);

-- grupo_estado_items
CREATE INDEX IF NOT EXISTS idx_grupo_estado_items_estado_id ON grupo_estado_items(estado_id);

-- grupos_estados
CREATE INDEX IF NOT EXISTS idx_grupos_estados_tenant_id ON grupos_estados(tenant_id);

-- hoja_ruta_envios
CREATE INDEX IF NOT EXISTS idx_hoja_ruta_envios_envio_id ON hoja_ruta_envios(envio_id);
CREATE INDEX IF NOT EXISTS idx_hoja_ruta_envios_tenant_id ON hoja_ruta_envios(tenant_id);

-- hojas_ruta
CREATE INDEX IF NOT EXISTS idx_hojas_ruta_created_by ON hojas_ruta(created_by);
CREATE INDEX IF NOT EXISTS idx_hojas_ruta_repartidor_id ON hojas_ruta(repartidor_id);
CREATE INDEX IF NOT EXISTS idx_hojas_ruta_sucursal_id ON hojas_ruta(sucursal_id);

-- integration_job_queue
CREATE INDEX IF NOT EXISTS idx_integration_job_queue_sucursal_id ON integration_job_queue(sucursal_id);

-- inventario_conteo_items
CREATE INDEX IF NOT EXISTS idx_inventario_conteo_items_contado_por ON inventario_conteo_items(contado_por);
CREATE INDEX IF NOT EXISTS idx_inventario_conteo_items_inventario_linea_id ON inventario_conteo_items(inventario_linea_id);
CREATE INDEX IF NOT EXISTS idx_inventario_conteo_items_producto_id ON inventario_conteo_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_inventario_conteo_items_reconteo_por ON inventario_conteo_items(reconteo_por);

-- inventario_conteos
CREATE INDEX IF NOT EXISTS idx_inventario_conteos_created_by ON inventario_conteos(created_by);
CREATE INDEX IF NOT EXISTS idx_inventario_conteos_producto_id ON inventario_conteos(producto_id);
CREATE INDEX IF NOT EXISTS idx_inventario_conteos_sucursal_id ON inventario_conteos(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_inventario_conteos_ubicacion_id ON inventario_conteos(ubicacion_id);

-- inventario_lineas
CREATE INDEX IF NOT EXISTS idx_inventario_lineas_estado_id ON inventario_lineas(estado_id);
CREATE INDEX IF NOT EXISTS idx_inventario_lineas_proveedor_id ON inventario_lineas(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_inventario_lineas_ubicacion_id ON inventario_lineas(ubicacion_id);

-- inventario_series
CREATE INDEX IF NOT EXISTS idx_inventario_series_estado_id ON inventario_series(estado_id);

-- inventario_tn_map
CREATE INDEX IF NOT EXISTS idx_inventario_tn_map_producto_id ON inventario_tn_map(producto_id);
CREATE INDEX IF NOT EXISTS idx_inventario_tn_map_sucursal_id ON inventario_tn_map(sucursal_id);

-- kitting_log
CREATE INDEX IF NOT EXISTS idx_kitting_log_ubicacion_id ON kitting_log(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_kitting_log_usuario_id ON kitting_log(usuario_id);

-- leads
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);

-- meli_credentials
CREATE INDEX IF NOT EXISTS idx_meli_credentials_sucursal_id ON meli_credentials(sucursal_id);

-- mercadopago_credentials
CREATE INDEX IF NOT EXISTS idx_mercadopago_credentials_sucursal_id ON mercadopago_credentials(sucursal_id);

-- motivos_movimiento
CREATE INDEX IF NOT EXISTS idx_motivos_movimiento_tenant_id ON motivos_movimiento(tenant_id);

-- movimientos_stock
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_estado_id ON movimientos_stock(estado_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_linea_id ON movimientos_stock(linea_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_proveedor_id ON movimientos_stock(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_usuario_id ON movimientos_stock(usuario_id);

-- mp_billing_alertas
CREATE INDEX IF NOT EXISTS idx_mp_billing_alertas_tenant_id ON mp_billing_alertas(tenant_id);

-- notificaciones
CREATE INDEX IF NOT EXISTS idx_notificaciones_tenant_id ON notificaciones(tenant_id);

-- orden_compra_items
CREATE INDEX IF NOT EXISTS idx_orden_compra_items_producto_id ON orden_compra_items(producto_id);

-- ordenes_compra
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_aprobada_por ON ordenes_compra(aprobada_por);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_created_by ON ordenes_compra(created_by);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_sucursal_id ON ordenes_compra(sucursal_id);

-- platform_facturas
CREATE INDEX IF NOT EXISTS idx_platform_facturas_tenant_origen_id ON platform_facturas(tenant_origen_id);

-- producto_grupos
CREATE INDEX IF NOT EXISTS idx_producto_grupos_categoria_id ON producto_grupos(categoria_id);

-- producto_precios_mayorista
CREATE INDEX IF NOT EXISTS idx_producto_precios_mayorista_tenant_id ON producto_precios_mayorista(tenant_id);

-- producto_ubicacion_sucursal
CREATE INDEX IF NOT EXISTS idx_producto_ubicacion_sucursal_sucursal_id ON producto_ubicacion_sucursal(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_producto_ubicacion_sucursal_ubicacion_id ON producto_ubicacion_sucursal(ubicacion_id);

-- productos
CREATE INDEX IF NOT EXISTS idx_productos_aging_profile_id ON productos(aging_profile_id);
CREATE INDEX IF NOT EXISTS idx_productos_estado_id ON productos(estado_id);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor_id ON productos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_productos_ubicacion_id ON productos(ubicacion_id);

-- proveedor_cc_movimientos
CREATE INDEX IF NOT EXISTS idx_proveedor_cc_movimientos_caja_sesion_id ON proveedor_cc_movimientos(caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_proveedor_cc_movimientos_created_by ON proveedor_cc_movimientos(created_by);
CREATE INDEX IF NOT EXISTS idx_proveedor_cc_movimientos_proveedor_id ON proveedor_cc_movimientos(proveedor_id);

-- proveedor_contactos
CREATE INDEX IF NOT EXISTS idx_proveedor_contactos_tenant_id ON proveedor_contactos(tenant_id);

-- proveedor_cuentas_bancarias
CREATE INDEX IF NOT EXISTS idx_proveedor_cuentas_bancarias_tenant_id ON proveedor_cuentas_bancarias(tenant_id);

-- proveedor_productos
CREATE INDEX IF NOT EXISTS idx_proveedor_productos_producto_id ON proveedor_productos(producto_id);

-- proveedores
CREATE INDEX IF NOT EXISTS idx_proveedores_sucursal_id ON proveedores(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_tenant_id ON proveedores(tenant_id);

-- puntos_venta_afip
CREATE INDEX IF NOT EXISTS idx_puntos_venta_afip_sucursal_id ON puntos_venta_afip(sucursal_id);

-- recepcion_items
CREATE INDEX IF NOT EXISTS idx_recepcion_items_estado_id ON recepcion_items(estado_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_inventario_linea_id ON recepcion_items(inventario_linea_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_oc_item_id ON recepcion_items(oc_item_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_producto_id ON recepcion_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_ubicacion_id ON recepcion_items(ubicacion_id);

-- recepciones
CREATE INDEX IF NOT EXISTS idx_recepciones_created_by ON recepciones(created_by);
CREATE INDEX IF NOT EXISTS idx_recepciones_proveedor_id ON recepciones(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_sucursal_id ON recepciones(sucursal_id);

-- recursos
CREATE INDEX IF NOT EXISTS idx_recursos_created_by ON recursos(created_by);
CREATE INDEX IF NOT EXISTS idx_recursos_proveedor_id ON recursos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_recursos_sucursal_id ON recursos(sucursal_id);

-- repartidores
CREATE INDEX IF NOT EXISTS idx_repartidores_empleado_id ON repartidores(empleado_id);

-- rrhh_anticipos
CREATE INDEX IF NOT EXISTS idx_rrhh_anticipos_created_by ON rrhh_anticipos(created_by);
CREATE INDEX IF NOT EXISTS idx_rrhh_anticipos_descontado_en_salario_id ON rrhh_anticipos(descontado_en_salario_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_anticipos_empleado_id ON rrhh_anticipos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_anticipos_gasto_id ON rrhh_anticipos(gasto_id);

-- rrhh_capacitaciones
CREATE INDEX IF NOT EXISTS idx_rrhh_capacitaciones_created_by ON rrhh_capacitaciones(created_by);

-- rrhh_documentos
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_catalogo_id ON rrhh_documentos(catalogo_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_created_by ON rrhh_documentos(created_by);

-- rrhh_evaluaciones
CREATE INDEX IF NOT EXISTS idx_rrhh_evaluaciones_empleado_id ON rrhh_evaluaciones(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_evaluaciones_evaluador_id ON rrhh_evaluaciones(evaluador_id);

-- rrhh_feriados
CREATE INDEX IF NOT EXISTS idx_rrhh_feriados_created_by ON rrhh_feriados(created_by);

-- rrhh_fichadas
CREATE INDEX IF NOT EXISTS idx_rrhh_fichadas_empleado_id ON rrhh_fichadas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_fichadas_sucursal_id ON rrhh_fichadas(sucursal_id);

-- rrhh_horas_extra
CREATE INDEX IF NOT EXISTS idx_rrhh_horas_extra_aprobada_por ON rrhh_horas_extra(aprobada_por);
CREATE INDEX IF NOT EXISTS idx_rrhh_horas_extra_empleado_id ON rrhh_horas_extra(empleado_id);

-- rrhh_liquidaciones_finales
CREATE INDEX IF NOT EXISTS idx_rrhh_liquidaciones_finales_created_by ON rrhh_liquidaciones_finales(created_by);
CREATE INDEX IF NOT EXISTS idx_rrhh_liquidaciones_finales_empleado_id ON rrhh_liquidaciones_finales(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_liquidaciones_finales_gasto_id ON rrhh_liquidaciones_finales(gasto_id);

-- rrhh_salario_items
CREATE INDEX IF NOT EXISTS idx_rrhh_salario_items_concepto_id ON rrhh_salario_items(concepto_id);

-- rrhh_salarios
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_caja_movimiento_id ON rrhh_salarios(caja_movimiento_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_gasto_id ON rrhh_salarios(gasto_id);

-- rrhh_vacaciones_solicitud
CREATE INDEX IF NOT EXISTS idx_rrhh_vacaciones_solicitud_aprobado_por ON rrhh_vacaciones_solicitud(aprobado_por);
CREATE INDEX IF NOT EXISTS idx_rrhh_vacaciones_solicitud_preaprobado_por ON rrhh_vacaciones_solicitud(preaprobado_por);

-- servicio_items
CREATE INDEX IF NOT EXISTS idx_servicio_items_tenant_id ON servicio_items(tenant_id);

-- servicio_presupuestos
CREATE INDEX IF NOT EXISTS idx_servicio_presupuestos_gasto_id ON servicio_presupuestos(gasto_id);
CREATE INDEX IF NOT EXISTS idx_servicio_presupuestos_servicio_item_id ON servicio_presupuestos(servicio_item_id);
CREATE INDEX IF NOT EXISTS idx_servicio_presupuestos_tenant_id ON servicio_presupuestos(tenant_id);

-- support_tickets
CREATE INDEX IF NOT EXISTS idx_support_tickets_creado_por ON support_tickets(creado_por);

-- tenants
CREATE INDEX IF NOT EXISTS idx_tenants_plan_id ON tenants(plan_id);

-- tiendanube_credentials
CREATE INDEX IF NOT EXISTS idx_tiendanube_credentials_sucursal_id ON tiendanube_credentials(sucursal_id);

-- traslado_items
CREATE INDEX IF NOT EXISTS idx_traslado_items_estado_id ON traslado_items(estado_id);
CREATE INDEX IF NOT EXISTS idx_traslado_items_linea_destino_id ON traslado_items(linea_destino_id);
CREATE INDEX IF NOT EXISTS idx_traslado_items_linea_origen_id ON traslado_items(linea_origen_id);
CREATE INDEX IF NOT EXISTS idx_traslado_items_tenant_id ON traslado_items(tenant_id);

-- traslados
CREATE INDEX IF NOT EXISTS idx_traslados_despachado_por ON traslados(despachado_por);
CREATE INDEX IF NOT EXISTS idx_traslados_envio_id ON traslados(envio_id);
CREATE INDEX IF NOT EXISTS idx_traslados_recibido_por ON traslados(recibido_por);
CREATE INDEX IF NOT EXISTS idx_traslados_sucursal_origen_id ON traslados(sucursal_origen_id);

-- users
CREATE INDEX IF NOT EXISTS idx_users_caja_preferida_id ON users(caja_preferida_id);
CREATE INDEX IF NOT EXISTS idx_users_rol_custom_id ON users(rol_custom_id);
CREATE INDEX IF NOT EXISTS idx_users_sucursal_id ON users(sucursal_id);

-- venta_auditoria
CREATE INDEX IF NOT EXISTS idx_venta_auditoria_tenant_id ON venta_auditoria(tenant_id);

-- venta_item_despachos
CREATE INDEX IF NOT EXISTS idx_venta_item_despachos_linea_id ON venta_item_despachos(linea_id);
CREATE INDEX IF NOT EXISTS idx_venta_item_despachos_producto_id ON venta_item_despachos(producto_id);

-- venta_items
CREATE INDEX IF NOT EXISTS idx_venta_items_linea_id ON venta_items(linea_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_producto_id ON venta_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_tenant_id ON venta_items(tenant_id);

-- venta_series
CREATE INDEX IF NOT EXISTS idx_venta_series_serie_id ON venta_series(serie_id);
CREATE INDEX IF NOT EXISTS idx_venta_series_tenant_id ON venta_series(tenant_id);
CREATE INDEX IF NOT EXISTS idx_venta_series_venta_item_id ON venta_series(venta_item_id);

-- ventas
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_usuario_id ON ventas(usuario_id);

-- ventas_externas_logs
CREATE INDEX IF NOT EXISTS idx_ventas_externas_logs_venta_id ON ventas_externas_logs(venta_id);

-- ventas_recurrentes
CREATE INDEX IF NOT EXISTS idx_ventas_recurrentes_cliente_id ON ventas_recurrentes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_recurrentes_sucursal_id ON ventas_recurrentes(sucursal_id);

