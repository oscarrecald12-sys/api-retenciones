package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;

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
}
