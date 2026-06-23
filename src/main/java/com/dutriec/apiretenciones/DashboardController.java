package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class DashboardController {

    private final JdbcTemplate mariaDb;

    public DashboardController(@Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb) {
        this.mariaDb = mariaDb;
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
            return mariaDb.queryForList(
                "SELECT " +
                "  id, " +
                "  id_factura_orig   AS idFacturaOrig, " +
                "  nro_comprobante   AS numDocRet, " +
                "  ruc_proveedor     AS rucProveedor, " +
                "  razon_social      AS razonSocial, " +
                "  nro_comprobante   AS nroFactura, " +
                "  num_timbrado      AS numTimbrado, " +
                "  correo_proveedor    AS correoProveedor, " +
                "  telefono_proveedor  AS telefonoProveedor, " +
                "  direccion_proveedor AS direccionProveedor, " +
                "  retencion         AS montoRetencion, " +
                "  monto             AS baseImponible, " +
                "  moneda, " +
                "  estado            AS estadoSifen, " +
                "  cdc               AS cdcProveedor, " +
                "  motivo_rechazo    AS respuestaSifen, " +
                "  fecha_envio       AS fechaEnvio, " +
                "  fecha_creacion    AS fechaCreacion " +
                "FROM retenciones_enviadas " +
                "ORDER BY fecha_creacion DESC LIMIT 200"
            );
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
}
