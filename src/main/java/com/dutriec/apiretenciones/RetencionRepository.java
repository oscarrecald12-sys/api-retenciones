package com.dutriec.apiretenciones;

import java.util.List;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Repositorio MariaDB para documentos de retención.
 * BD: retenciones_sifen — puerto 3306
 */
@Repository
public class RetencionRepository {

    private final JdbcTemplate mariaDb;

    public RetencionRepository(@Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb) {
        this.mariaDb = mariaDb;
    }

    // Genera el siguiente numDocRet usando el stored procedure de MariaDB
    public String generarNumDocRet(String establecimiento, String puntoExpedicion) {
        String sql = "CALL sp_siguiente_num_doc_ret(?, ?, @numDocRet)";
        mariaDb.update(sql, establecimiento, puntoExpedicion);
        return mariaDb.queryForObject("SELECT @numDocRet", String.class);
    }

    public String generarNumDocRet() {
        return generarNumDocRet("001", "001");
    }

    // Actualiza el estado luego de la respuesta del colega
    public void actualizarEstado(long id, String estadoSifen, String respuestaJson) {
        String sql = "UPDATE retenciones_enviadas SET estado_sifen = ?, respuesta_sifen = ?, fecha_envio = NOW() WHERE id = ?";
        mariaDb.update(sql, estadoSifen, respuestaJson, id);
    }

    // Registra en log_envios
    public void registrarLog(long retencionId, String accion, String detalle, boolean exitoso) {
        String sql = "INSERT INTO log_envios (retencion_id, accion, detalle, exitoso, fecha) VALUES (?, ?, ?, ?, NOW())";
        mariaDb.update(sql, retencionId, accion, detalle, exitoso ? 1 : 0);
    }

    // Lee el timbrado activo desde configuracion de MariaDB
    public String obtenerTimbradoActivo() {
        try {
            return mariaDb.queryForObject(
                "SELECT valor FROM configuracion WHERE clave = 'num_timbrado_retencion' LIMIT 1",
                String.class
            );
        } catch (Exception e) {
            return "PENDIENTE_TIMBRADO";
        }
    }

    /**
     * Actualiza el estado de envío TESAKA después de descargar el TXT
     * Valores posibles:
     * TESAKA_ENVIO_PENDIENTE
     * TESAKA_APROBADO
     * TESAKA_RECHAZADO
     * @param ids Lista de IDs de retenciones
     * @param estado Nuevo estado (ej: "TESAKA_PENDIENTE")
     * @return Cantidad de registros actualizados
     */
    @SuppressWarnings("null")
    public int actualizarEstadoEnvioTesaka(List<Integer> ids, String estado) {
        if (ids == null || ids.isEmpty()) {
            return 0;
        }

        // Construir los placeholders dinámicos: ?,?,?...
        String placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));

        String sql = """
            UPDATE retenciones_enviadas 
            SET estado_envio_tesaka = ?, 
                fecha_actualizacion = NOW() 
            WHERE id IN (%s)
            """.formatted(placeholders);

        // Preparar parámetros: primero el estado, luego los IDs
        Object[] params = new Object[ids.size() + 1];
        params[0] = estado;
        for (int i = 0; i < ids.size(); i++) {
            params[i + 1] = ids.get(i);
        }

        return mariaDb.update(sql, params);
    }

    /**
     * Guarda la respuesta/aprobación de la retención usando el nro_comprobante.
     * @param nroComprobante Identificador/PK principal
     * @param estado El nuevo estado (APROBADO, RECHAZADO, etc.)
     * @param nroControl Número de control interno
     * @param comentario Observaciones o motivos
     * @return Cantidad de filas afectadas
     */
    public int guardarRespuestaAprobacion(String nroComprobante, String estado, String nroControl, String comentario) {
        String sql = """
            UPDATE  retenciones_enviadas 
            SET     aprobacion_estado = ?, 
                    aprobacion_nro_control = ?, 
                    aprobacion_comentario = ?, 
                    fecha_actualizacion = NOW() 
            WHERE   nro_comprobante = ?
            """;
        return mariaDb.update(sql, estado, nroControl, comentario, nroComprobante);
    }

}
