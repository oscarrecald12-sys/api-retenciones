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
    // NOTA: aqui existian 5 endpoints de migracion de un solo uso
    // (migrar-timbrados, migrar-conceptos, migrar-redondeo, migrar-tc,
    //  migrar-ordenes). Ya cumplieron su funcion de corregir los datos
    // historicos y fueron ELIMINADOS por seguridad: eran accesibles por
    // GET sin autenticacion y ejecutaban updates masivos en la base.
    // Si alguna vez hace falta una correccion masiva, hacerla con un
    // script SQL puntual, no con un endpoint expuesto.
    // =========================================================================

    @GetMapping("/dashboard")
    public Map<String, Object> getDashboard() {
        Map<String, Object> respuesta = new HashMap<>();

        Map<String, Object> resumen = new HashMap<>();
        // Cada tarjeta cuenta con el MISMO criterio que su pestaña, para que el
        // número mostrado sea igual a la cantidad de filas que se ven en ella.
        // PENDIENTES: estado PENDIENTE o REVERTIDA (vuelven al pool).
        resumen.put("pendientes", contarSql(
            "estado IN ('PENDIENTE','REVERTIDA')"));
        // ENVIADOS: enviadas/generadas SIN respuesta de Tesaka todavía.
        resumen.put("enviadas", contarSql(
            "estado IN ('ENVIADO','TESAKA_GENERADO') " +
            "AND (aprobacion_estado IS NULL OR aprobacion_estado NOT IN ('RECHAZADO','APROBADO'))"));
        // APROBADOS: aprobadas por Tesaka, salvo que ya se hayan revertido.
        resumen.put("aprobados", contarSql(
            "estado <> 'REVERTIDA' AND (estado = 'APROBADO' OR aprobacion_estado = 'APROBADO')"));
        // RECHAZADOS: rechazadas por Tesaka, salvo que ya se hayan revertido.
        resumen.put("rechazados", contarSql(
            "estado <> 'REVERTIDA' AND (estado = 'RECHAZADO' OR aprobacion_estado = 'RECHAZADO')"));
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

    // Conteo con una condición WHERE libre. Se usa para que cada tarjeta cuente
    // con el mismo criterio que el filtro de su pestaña en el frontend.
    private long contarSql(String where) {
        try {
            Long n = mariaDb.queryForObject(
                "SELECT COUNT(*) FROM retenciones_enviadas WHERE " + where, Long.class
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
                "  aprobacion_comentario   AS aprobacion_comentario, " +
                "  COALESCE(veces_revertida, 0) AS veces_revertida, " +
                "  COALESCE(veces_rechazada, 0) AS veces_rechazada, " +
                "  motivo_reversion        AS motivo_reversion, " +
                "  id_factura_orig         AS idFacturaOrig" +
                "  FROM retenciones_enviadas " +
                // Prioriza los estados que requieren atención (borrador, rechazado,
                // revertida, pendiente) para que el LIMIT no los deje fuera.
                // Las aprobadas/enviadas (muchas) quedan al final y se recortan.
                "  ORDER BY CASE " +
                "    WHEN estado IN ('BORRADOR','REVERTIDA','PENDIENTE') THEN 0 " +
                "    WHEN estado = 'RECHAZADO' OR aprobacion_estado = 'RECHAZADO' THEN 1 " +
                "    WHEN estado IN ('ENVIADO','TESAKA_GENERADO') THEN 2 " +
                "    ELSE 3 END, " +
                "  fecha_creacion DESC LIMIT 500";
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
        "PENDIENTE", "ENVIADO", "APROBADO", "RECHAZADO", "ERROR", "TESAKA_GENERADO", "REVERTIDA", "BORRADOR"
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
        String nroNormalizado = (String) request.get("nro_comprobante_normalizado");
        String estado = (String) request.get("estado");
        String aprobacionNroControl = (String) request.get("aprobacion_nro_control"); //TODO. decidir si se deja este campo: 
        String aprobacionComentario = (String) request.get("aprobacion_comentario");

        if (nroComprobante == null || nroComprobante.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "El campo nro_comprobante es requerido."));
        }
        // Validación: respuestas válidas de Tesaka (APROBADO, RECHAZADO o BORRADOR)
        if (estado == null || !java.util.Set.of("APROBADO", "RECHAZADO", "BORRADOR").contains(estado.toUpperCase())) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Estado inválido: '" + estado + "'. Válidos: APROBADO, RECHAZADO, BORRADOR"
            ));
        }
        estado = estado.toUpperCase();
        // Sanitizar longitud del comentario (evita payloads gigantes)
        if (aprobacionComentario != null && aprobacionComentario.length() > 1000) {
            aprobacionComentario = aprobacionComentario.substring(0, 1000);
        }

        try {
            // Normalizamos: si el front no mandó la versión sin guiones, la generamos.
            String normal = (nroNormalizado != null && !nroNormalizado.isEmpty())
                    ? nroNormalizado : nroComprobante.replace("-", "");

            // Match flexible: el TXT de Tesaka trae el número con guiones
            // (001-001-0015390) pero la BD puede guardarlo sin guiones.
            // Actualizamos estado real + datos de aprobación en una sola query.
            // Para BORRADOR no seteamos aprobacion_estado (ese campo es solo
            // para la decisión final aprobado/rechazado).
            String aprobEstado = "BORRADOR".equals(estado) ? null : estado;
            int filasAfectadas = mariaDb.update(
                "UPDATE retenciones_enviadas " +
                "SET estado = ?, " +
                "    aprobacion_estado = COALESCE(?, aprobacion_estado), " +
                "    aprobacion_nro_control = ?, " +
                "    aprobacion_comentario = ?, " +
                "    fecha_actualizacion = NOW() " +
                "WHERE nro_comprobante = ? OR REPLACE(nro_comprobante, '-', '') = ?",
                estado, aprobEstado, aprobacionNroControl, aprobacionComentario,
                nroComprobante, normal
            );

            if (filasAfectadas == 0) {
                return ResponseEntity.status(404).body(Map.of("error", "No se encontró ninguna retención con el nro_comprobante provisto."));
            }

            // Contador de rechazos (lo ve SOPORTE en incidencias)
            if ("RECHAZADO".equals(estado)) {
                try {
                    mariaDb.update(
                        "UPDATE retenciones_enviadas SET veces_rechazada = COALESCE(veces_rechazada,0) + 1 " +
                        "WHERE nro_comprobante = ? OR REPLACE(nro_comprobante, '-', '') = ?",
                        nroComprobante, normal);
                } catch (Exception ex) {
                    System.err.println("[guardar-respuesta] no se pudo incrementar veces_rechazada: " + ex.getMessage());
                }
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