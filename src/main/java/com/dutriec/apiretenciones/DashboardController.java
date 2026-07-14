package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class DashboardController {

    private final JdbcTemplate mariaDb;
    private final JdbcTemplate sqlAnywhere;
    private final RetencionRepository retencionRepository;

    public DashboardController(@Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb,
            @Qualifier("sqlAnywhereJdbcTemplate") JdbcTemplate sqlAnywhere,
            RetencionRepository retencionRepository) {
                this.mariaDb = mariaDb;
                this.sqlAnywhere = sqlAnywhere;
                this.retencionRepository = retencionRepository;
    }

    // =========================================================================
    // GET /retenciones/migrar-timbrados
    // One-time: lee el timbrado del proveedor desde SQL Anywhere para los
    // registros existentes en MariaDB que no lo tienen, y lo actualiza.
    // No modifica nada en SQL Anywhere — solo LEE de ahí y ESCRIBE en MariaDB.
    // =========================================================================
    @GetMapping("/migrar-timbrados")
    public ResponseEntity<?> migrarTimbrados() {
        List<Map<String, Object>> sinTimbrado = mariaDb.queryForList(
            "SELECT id, id_factura_orig FROM retenciones_enviadas " +
            "WHERE timbrado_proveedor IS NULL " +
            "   OR timbrado_proveedor = '' " +
            "   OR timbrado_proveedor NOT REGEXP '^[0-9]{8}$'"
        );

        int actualizados = 0;
        List<String> errores = new ArrayList<>();

        for (Map<String, Object> reg : sinTimbrado) {
            Long idFactura = ((Number) reg.get("id_factura_orig")).longValue();
            Long idRet = ((Number) reg.get("id")).longValue();
            try {
                List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                    "SELECT fr.timbrado FROM facturas_recibidas fr WHERE fr.factura = ?",
                    idFactura
                );
                if (!resultado.isEmpty() && resultado.get(0).get("timbrado") != null) {
                    String timbrado = String.valueOf(resultado.get(0).get("timbrado")).trim();
                    if (!timbrado.isEmpty()) {
                        mariaDb.update(
                            "UPDATE retenciones_enviadas SET timbrado_proveedor = ? WHERE id = ?",
                            timbrado, idRet
                        );
                        actualizados++;
                    }
                }
            } catch (Exception e) {
                errores.add("Factura " + idFactura + ": " + e.getMessage());
            }
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total_sin_timbrado", sinTimbrado.size());
        resp.put("actualizados", actualizados);
        if (!errores.isEmpty()) resp.put("errores", errores);
        return ResponseEntity.ok(resp);
    }

    // =========================================================================
    // GET /retenciones/migrar-conceptos
    // One-time: completa los datos faltantes de los registros existentes en
    // MariaDB leyéndolos desde SQL Anywhere en una sola pasada:
    //   - concepto (comentarios de la factura)
    //   - factor_cambio (cotización, si falta)
    //   - fecha_factura (si falta)
    //   - razon_social (con fallback a primer_nombre si está vacía)
    // No modifica nada en SQL Anywhere — solo LEE de ahí y ESCRIBE en MariaDB.
    // =========================================================================
    @GetMapping("/migrar-conceptos")
    public ResponseEntity<?> migrarConceptos() {
        List<Map<String, Object>> pendientes = mariaDb.queryForList(
            "SELECT id, id_factura_orig FROM retenciones_enviadas " +
            "WHERE concepto IS NULL OR concepto = '' " +
            "   OR fecha_factura IS NULL " +
            "   OR factor_cambio IS NULL " +
            "   OR razon_social IS NULL OR razon_social = '' " +
            "   OR razon_social IN ('—', '-', '---', 'Sin nombre', 'null')"
        );

        int actualizados = 0;
        List<String> errores = new ArrayList<>();

        for (Map<String, Object> reg : pendientes) {
            Long idFactura = ((Number) reg.get("id_factura_orig")).longValue();
            Long idRet = ((Number) reg.get("id")).longValue();
            try {
                List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                    "SELECT fr.comentarios, fr.factor_cambio, fr.fecha, " +
                    "p.razon_social, p.primer_nombre " +
                    "FROM facturas_recibidas fr " +
                    "JOIN personas p ON p.persona = fr.proveedor " +
                    "WHERE fr.factura = ?",
                    idFactura
                );
                if (resultado.isEmpty()) {
                    errores.add("Factura " + idFactura + ": no encontrada en SQL Anywhere");
                    continue;
                }
                Map<String, Object> f = resultado.get(0);

                String concepto = f.get("comentarios") != null
                        ? String.valueOf(f.get("comentarios")).trim() : null;
                if (concepto != null && concepto.length() > 300) {
                    concepto = concepto.substring(0, 300);
                }

                Double factorCambio = null;
                if (f.get("factor_cambio") != null) {
                    double fc = Double.parseDouble(f.get("factor_cambio").toString());
                    if (fc > 0) factorCambio = fc;
                }

                String fechaFactura = null;
                if (f.get("fecha") != null) {
                    String s = String.valueOf(f.get("fecha"));
                    if (s.length() >= 10) fechaFactura = s.substring(0, 10);
                }

                // Razón social con fallback a primer_nombre (igual que en enviarLote)
                String razonSocial = null;
                Object rs = f.get("razon_social");
                Object pn = f.get("primer_nombre");
                if (rs != null && !rs.toString().trim().isEmpty()) {
                    razonSocial = rs.toString().trim();
                } else if (pn != null && !pn.toString().trim().isEmpty()) {
                    razonSocial = pn.toString().trim();
                }

                // COALESCE/CASE: solo completa lo que falta, no pisa datos cargados.
                // Para razon_social también reemplaza placeholders ('—', 'Sin nombre').
                mariaDb.update(
                    "UPDATE retenciones_enviadas SET " +
                    "concepto = COALESCE(NULLIF(concepto, ''), ?), " +
                    "factor_cambio = COALESCE(factor_cambio, ?), " +
                    "fecha_factura = COALESCE(fecha_factura, ?), " +
                    "razon_social = CASE " +
                    "  WHEN razon_social IS NULL OR razon_social = '' " +
                    "       OR razon_social IN ('—', '-', '---', 'Sin nombre', 'null') " +
                    "  THEN COALESCE(?, razon_social) ELSE razon_social END " +
                    "WHERE id = ?",
                    concepto, factorCambio, fechaFactura, razonSocial, idRet
                );
                actualizados++;

            } catch (Exception e) {
                errores.add("Factura " + idFactura + ": " + e.getMessage());
            }
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total_pendientes", pendientes.size());
        resp.put("actualizados", actualizados);
        if (!errores.isEmpty()) resp.put("errores", errores);
        return ResponseEntity.ok(resp);
    }

    // =========================================================================
    // GET /retenciones/migrar-redondeo
    // Redondea factor_cambio a entero en todos los registros de MariaDB.
    // Tesaka exige tipoCambio como entero. También corrige factores de cambio
    // sospechosos (> 100.000 o = 0) consultando la orden de pago en SQL Anywhere.
    // =========================================================================
    @GetMapping("/migrar-redondeo")
    public ResponseEntity<?> migrarRedondeo() {
        // Paso 1: redondear los que tienen decimales
        int redondeados = mariaDb.update(
            "UPDATE retenciones_enviadas " +
            "SET factor_cambio = ROUND(factor_cambio) " +
            "WHERE factor_cambio IS NOT NULL AND factor_cambio != ROUND(factor_cambio)"
        );

        // Paso 2: buscar los sospechosos (> 10.000 o = 0 en moneda DL/USD)
        // y corregirlos desde la FACTURA ORIGINAL (fr.factor_cambio), NO de la orden
        List<Map<String, Object>> sospechosos = mariaDb.queryForList(
            "SELECT id, id_factura_orig, factor_cambio FROM retenciones_enviadas " +
            "WHERE moneda IN ('DL', 'USD') " +
            "  AND (factor_cambio IS NULL OR factor_cambio = 0 OR factor_cambio > 10000)"
        );

        int corregidos = 0;
        List<String> errores = new ArrayList<>();
        for (Map<String, Object> reg : sospechosos) {
            Long idFactura = ((Number) reg.get("id_factura_orig")).longValue();
            Long idRet = ((Number) reg.get("id")).longValue();
            try {
                // TC de la factura original en SQL Anywhere
                List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                    "SELECT fr.factor_cambio FROM facturas_recibidas fr WHERE fr.factura = ?",
                    idFactura
                );
                if (!resultado.isEmpty() && resultado.get(0).get("factor_cambio") != null) {
                    double tc = Double.parseDouble(resultado.get(0).get("factor_cambio").toString());
                    // Corrección: si > 10.000, SQL Anywhere lo guardó sin decimales
                    if (tc > 10000) tc = tc / 100.0;
                    long tcRedondeado = Math.round(tc);
                    if (tcRedondeado > 0 && tcRedondeado < 10000) {
                        mariaDb.update(
                            "UPDATE retenciones_enviadas SET factor_cambio = ? WHERE id = ?",
                            tcRedondeado, idRet
                        );
                        corregidos++;
                    }
                }
            } catch (Exception e) {
                errores.add("Factura " + idFactura + ": " + e.getMessage());
            }
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("redondeados", redondeados);
        resp.put("sospechosos_encontrados", sospechosos.size());
        resp.put("corregidos_desde_ordenes", corregidos);
        if (!errores.isEmpty()) resp.put("errores", errores);
        return ResponseEntity.ok(resp);
    }

    // =========================================================================
    // GET /retenciones/migrar-tc
    // Fuerza la re-lectura del tipo de cambio de la FACTURA ORIGINAL
    // (facturas_recibidas.factor_cambio) para TODOS los registros en USD/DL.
    // Aplica la corrección: si > 10.000, divide por 100. Redondea a entero.
    // =========================================================================
    @GetMapping("/migrar-tc")
    public ResponseEntity<?> migrarTipoCambio() {
        List<Map<String, Object>> registrosUSD = mariaDb.queryForList(
            "SELECT id, id_factura_orig, factor_cambio FROM retenciones_enviadas " +
            "WHERE moneda IN ('DL', 'USD')"
        );
        int actualizados = 0;
        List<String> detalle = new ArrayList<>();
        for (Map<String, Object> reg : registrosUSD) {
            Long idFactura = ((Number) reg.get("id_factura_orig")).longValue();
            Long idRet = ((Number) reg.get("id")).longValue();
            Object tcActual = reg.get("factor_cambio");
            try {
                List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                    "SELECT fr.factor_cambio FROM facturas_recibidas fr WHERE fr.factura = ?",
                    idFactura
                );
                if (!resultado.isEmpty() && resultado.get(0).get("factor_cambio") != null) {
                    double tcOriginal = Double.parseDouble(resultado.get(0).get("factor_cambio").toString());
                    double tcCorregido = tcOriginal > 10000 ? tcOriginal / 100.0 : tcOriginal;
                    long tcFinal = Math.round(tcCorregido);
                    mariaDb.update(
                        "UPDATE retenciones_enviadas SET factor_cambio = ? WHERE id = ?",
                        tcFinal, idRet
                    );
                    detalle.add("Factura " + idFactura + ": " + tcActual + " → " + tcFinal +
                        " (original: " + tcOriginal + ")");
                    actualizados++;
                }
            } catch (Exception e) {
                detalle.add("Factura " + idFactura + ": ERROR " + e.getMessage());
            }
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total_usd", registrosUSD.size());
        resp.put("actualizados", actualizados);
        resp.put("detalle", detalle);
        return ResponseEntity.ok(resp);
    }

    // =========================================================================
    // GET /retenciones/migrar-ordenes
    // Completa la columna orden_pago de los registros existentes en MariaDB
    // buscando en ordenes_detalle de SQL Anywhere.
    // =========================================================================
    @GetMapping("/migrar-ordenes")
    public ResponseEntity<?> migrarOrdenes() {
        List<Map<String, Object>> sinOrden = mariaDb.queryForList(
            "SELECT id, id_factura_orig FROM retenciones_enviadas WHERE orden_pago IS NULL"
        );
        int actualizados = 0;
        List<String> errores = new ArrayList<>();
        for (Map<String, Object> reg : sinOrden) {
            Long idFactura = ((Number) reg.get("id_factura_orig")).longValue();
            Long idRet = ((Number) reg.get("id")).longValue();
            try {
                List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                    "SELECT od.orden FROM ordenes_detalle od WHERE od.factura = ?", idFactura
                );
                if (!resultado.isEmpty() && resultado.get(0).get("orden") != null) {
                    Long orden = ((Number) resultado.get(0).get("orden")).longValue();
                    mariaDb.update("UPDATE retenciones_enviadas SET orden_pago = ? WHERE id = ?", orden, idRet);
                    actualizados++;
                }
            } catch (Exception e) {
                errores.add("Factura " + idFactura + ": " + e.getMessage());
            }
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total_sin_orden", sinOrden.size());
        resp.put("actualizados", actualizados);
        if (!errores.isEmpty()) resp.put("errores", errores);
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/dashboard")
    public Map<String, Object> getDashboard() {
        Map<String, Object> respuesta = new HashMap<>();

        Map<String, Object> resumen = new HashMap<>();
        resumen.put("enviadas",   contarPorEstado("ENVIADO"));
        resumen.put("pendientes", contarPorEstado("PENDIENTE"));
        resumen.put("errores",    contarPorEstado("ERROR"));
        resumen.put("fisicas",    contarPorEstado("FISICA_MANUAL"));
        resumen.put("montoTotal", obtenerMontoTotal());
        respuesta.put("resumen", resumen);
        respuesta.put("retenciones", obtenerRetenciones());
        respuesta.put("logs", obtenerLogs());
        return respuesta;
    }

    @PostMapping("/reenviar/{id}")
    public Map<String, Object> reenviar(@PathVariable Long id) {
        Map<String, Object> resp = new HashMap<>();
        try {
            int rows = mariaDb.update(
                "UPDATE retenciones_enviadas SET estado = 'PENDIENTE', motivo_rechazo = NULL WHERE id = ?", id
            );
            resp.put("ok", rows > 0);
            resp.put("mensaje", rows > 0 ? "Marcado para reenvio" : "No encontrado");
        } catch (Exception e) {
            resp.put("ok", false);
            resp.put("mensaje", e.getMessage());
        }
        return resp;
    }

    @PostMapping("/guardar-respuesta/{id}")
    public Map<String, Object> guardarRespuesta(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        Map<String, Object> resp = new HashMap<>();
        try {
            String respuesta = body.getOrDefault("respuesta", "");
            int rows = mariaDb.update(
                "UPDATE retenciones_enviadas SET motivo_rechazo = ?, fecha_envio = COALESCE(fecha_envio, NOW()) WHERE id = ?",
                respuesta, id
            );
            resp.put("ok", rows > 0);
            resp.put("mensaje", rows > 0 ? "Respuesta guardada" : "Registro no encontrado");
        } catch (Exception e) {
            resp.put("ok", false);
            resp.put("mensaje", e.getMessage());
        }
        return resp;
    }

    private long contarPorEstado(String estado) {
        try {
            Long n = mariaDb.queryForObject(
                "SELECT COUNT(*) FROM retenciones_enviadas WHERE estado = ?", Long.class, estado
            );
            return n != null ? n : 0L;
        } catch (Exception e) { return 0L; }
    }

    private long obtenerMontoTotal() {
        try {
            Long n = mariaDb.queryForObject(
                "SELECT COALESCE(SUM(retencion), 0) FROM retenciones_enviadas WHERE estado IN ('ENVIADO','APROBADO')",
                Long.class
            );
            return n != null ? n : 0L;
        } catch (Exception e) { return 0L; }
    }

    private List<Map<String, Object>> obtenerRetenciones() {
        try {
            String sqlQuery = "SELECT " +
                "  id, " +
                "  id_factura_orig   AS idFacturaOrig, " +
                "  orden_pago        AS ordenPago, " +
                "  nro_comprobante   AS numDocRet, " +
                "  ruc_proveedor     AS rucProveedor, " +
                "  razon_social      AS razonSocial, " +
                "  concepto          AS concepto, " +
                "  nro_comprobante   AS nroFactura, " +
                "  num_timbrado      AS numTimbrado, " +
                "  timbrado_proveedor AS timbradoProveedor, " +
                "  fecha_factura     AS fechaFactura, " +
                "  correo_proveedor    AS correoProveedor, " +
                "  telefono_proveedor  AS telefonoProveedor, " +
                "  direccion_proveedor AS direccionProveedor, " +
                "  retencion         AS montoRetencion, " +
                "  monto             AS baseImponible, " +
                "  moneda, " +
                "  factor_cambio     AS tipoCambio, " +
                "  estado            AS estadoSifen, " +
                "  cdc               AS cdcProveedor, " +
                "  motivo_rechazo    AS respuestaSifen, " +
                "  fecha_envio       AS fechaEnvio, " +
                "  fecha_creacion    AS fechaCreacion, " +
                "  estado_envio_tesaka AS estado_envio_tesaka, " +
                // === CAMPOS DE RESPUESTA TESAKA ===
                "  aprobacion_estado       AS aprobacion_estado, " +
                "  aprobacion_nro_control  AS aprobacion_nro_control, " +
                "  aprobacion_comentario   AS aprobacion_comentario" +
                "  FROM retenciones_enviadas " +
                "  ORDER BY fecha_creacion DESC LIMIT 200";
            //*debug
            //System.out.println("obtenerRetenciones - mariaDb.queryForList:");
            //System.out.println(sqlQuery);
            //*debug-end

            return mariaDb.queryForList(sqlQuery);
        } catch (Exception e) { return new ArrayList<>(); }
    }

    private List<Map<String, Object>> obtenerLogs() {
        try {
            return mariaDb.queryForList(
                "SELECT " +
                "  CONCAT('Retencion ', nro_comprobante, ' — ', razon_social) AS accion, " +
                "  CASE " +
                "    WHEN estado = 'ERROR'         THEN COALESCE(motivo_rechazo, 'Error al enviar') " +
                "    WHEN estado = 'FISICA_MANUAL' THEN 'Factura fisica — retencion manual requerida' " +
                "    WHEN estado = 'PENDIENTE'     THEN 'Pendiente de envio' " +
                "    WHEN estado = 'ENVIADO'       THEN 'Enviado correctamente al colega' " +
                "    WHEN estado = 'APROBADO'      THEN 'Aprobado por SIFEN' " +
                "    ELSE estado " +
                "  END AS detalle, " +
                "  CASE WHEN estado = 'ERROR' THEN 0 ELSE 1 END AS exitoso, " +
                "  COALESCE(fecha_envio, fecha_creacion) AS fecha " +
                "FROM retenciones_enviadas " +
                "ORDER BY COALESCE(fecha_envio, fecha_creacion) DESC LIMIT 20"
            );
        } catch (Exception e) { return new ArrayList<>(); }
    }

    // Actualiza el estado de facturas enviadas o a enviar a Tesaká
    /** Estados válidos que puede recibir el endpoint actualizar-estado */
    private static final java.util.Set<String> ESTADOS_VALIDOS = java.util.Set.of(
        "PENDIENTE", "ENVIADO", "APROBADO", "RECHAZADO", "ERROR", "TESAKA_GENERADO"
    );

    @PostMapping("/actualizar-estado")
    public ResponseEntity<?> actualizarEstadoTesaka(@RequestBody Map<String, Object> request) {
        @SuppressWarnings("unchecked")
        List<Integer> ids = (List<Integer>) request.get("ids");
        String estado = (String) request.get("estado");

        if (ids == null || ids.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No se enviaron IDs"));
        }
        // Validación: límite de lote para evitar queries desproporcionadas
        if (ids.size() > 500) {
            return ResponseEntity.badRequest().body(Map.of("error", "Máximo 500 IDs por solicitud"));
        }
        // Validación: whitelist de estados — evita que se escriba cualquier
        // string arbitrario en la columna estado
        if (estado == null || !ESTADOS_VALIDOS.contains(estado.toUpperCase())) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Estado inválido: '" + estado + "'. Válidos: " + ESTADOS_VALIDOS
            ));
        }

        int actualizados = retencionRepository.actualizarEstadoEnvioTesaka(ids, estado.toUpperCase());

        return ResponseEntity.ok(Map.of(
            "mensaje", "Se actualizaron " + actualizados + " retenciones a " + estado,
            "registros_afectados", actualizados
        ));
    }

    // Endpoint para guardar la respuesta de la retención (que viene de TESAKA)
    @PostMapping("/guardar-respuesta")  
    public ResponseEntity<?> guardarRespuestaRetencion(@RequestBody Map<String, Object> request) {
        String nroComprobante = (String) request.get("nro_comprobante");
        String estado = (String) request.get("estado");
        String aprobacionNroControl = (String) request.get("aprobacion_nro_control"); //TODO. decidir si se deja este campo: 
        String aprobacionComentario = (String) request.get("aprobacion_comentario");

        if (nroComprobante == null || nroComprobante.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "El campo nro_comprobante es requerido."));
        }
        // Validación: solo APROBADO o RECHAZADO son respuestas válidas de Tesaka
        if (estado == null || !java.util.Set.of("APROBADO", "RECHAZADO").contains(estado.toUpperCase())) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Estado inválido: '" + estado + "'. Válidos: APROBADO, RECHAZADO"
            ));
        }
        estado = estado.toUpperCase();
        // Sanitizar longitud del comentario (evita payloads gigantes)
        if (aprobacionComentario != null && aprobacionComentario.length() > 1000) {
            aprobacionComentario = aprobacionComentario.substring(0, 1000);
        }

        try {
            int filasAfectadas = retencionRepository.guardarRespuestaAprobacion(
                nroComprobante, 
                estado, 
                aprobacionNroControl, 
                aprobacionComentario
            );

            if (filasAfectadas == 0) {
                return ResponseEntity.status(404).body(Map.of("error", "No se encontró ninguna retención con el nro_comprobante provisto."));
            }

            return ResponseEntity.ok(Map.of("mensaje", "Respuesta de retención guardada correctamente."));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Error interno al guardar la respuesta: " + e.getMessage()));
        }
    }

    // Nuevo endpoint: Obtener datos completos de la respuesta TESAKA
    @GetMapping("/respuesta/{nroComprobante}")
    public ResponseEntity<?> obtenerRespuestaTesaka(@PathVariable String nroComprobante) {
        try {
            Map<String, Object> respuesta = retencionRepository.obtenerRespuestaPorComprobante(nroComprobante);
            
            if (respuesta == null || respuesta.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            
            return ResponseEntity.ok(respuesta);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(
                "error", "Error al obtener respuesta: " + e.getMessage()
            ));
        }
    }

}