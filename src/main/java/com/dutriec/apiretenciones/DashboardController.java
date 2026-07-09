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
    public Map<String, Object> reenviar(@PathVariable String id) {
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
                "  nro_comprobante   AS numDocRet, " +
                "  ruc_proveedor     AS rucProveedor, " +
                "  razon_social      AS razonSocial, " +
                "  nro_comprobante   AS nroFactura, " +
                "  num_timbrado      AS numTimbrado, " +
                "  timbrado_proveedor AS timbradoProveedor, " +
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
    @PostMapping("/actualizar-estado")
    public ResponseEntity<?> actualizarEstadoTesaka(@RequestBody Map<String, Object> request) {
        @SuppressWarnings("unchecked")
        List<Integer> ids = (List<Integer>) request.get("ids");
        String estado = (String) request.get("estado");

        if (ids == null || ids.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No se enviaron IDs"));
        }

        int actualizados = retencionRepository.actualizarEstadoEnvioTesaka(ids, estado);

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