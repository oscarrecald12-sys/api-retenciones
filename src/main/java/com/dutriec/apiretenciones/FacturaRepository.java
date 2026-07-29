package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Repository
public class FacturaRepository {

    @Autowired
    @Qualifier("sqlAnywhereJdbcTemplate")
    private JdbcTemplate jdbc;

    // Trae todas las facturas pendientes
    public List<Factura> obtenerPendientes() {

        // ordenes_detalle tiene UNA fila por factura, así que se hace un JOIN
        // directo y se toman orden, monto y monto_retencion tal cual (sin sumar).
        String sql
                = "SELECT fr.factura, fr.factura_fisica, fr.fecha, "
                + "fr.compra, fr.forma_pago, "
                + "p.razon_social, p.primer_nombre, p.ruc, "
                + "p.mail, p.telefonos, p.direccion, "
                + "fr.monto_gravado, fr.monto_impuesto, "
                + "fr.monto_gravado_5, fr.monto_impuesto_5, "
                + "fr.monto_exento, fr.moneda, "
                + "fr.factor_cambio, fr.timbrado, fr.estado, fr.comentarios, "
                // Número de orden de pago, monto y retención informados en el ERP.
                + "od.orden AS orden_pago, od.monto AS monto_erp, od.monto_retencion "
                + "FROM facturas_recibidas fr "
                + "JOIN personas p ON p.persona = fr.proveedor "
                + "LEFT JOIN ordenes_detalle od ON od.factura = fr.factura "
                + "WHERE fr.estado = 'A' "
                // Ordena por número de orden de pago descendente (las más
                // recientes primero). Las facturas sin orden quedan al final.
                + "ORDER BY CASE WHEN od.orden IS NULL THEN 1 ELSE 0 END, "
                + "od.orden DESC, fr.fecha DESC";

        return jdbc.query(sql, new RowMapper<Factura>() {
            @Override
            public Factura mapRow(ResultSet rs, int rowNum)
                    throws SQLException {
                return mapearFactura(rs);
            }
        });
    }

    // Trae una factura por ID
    public Factura obtenerPorId(Long id) {

        String sql
                = "SELECT fr.factura, fr.factura_fisica, fr.fecha, "
                + "fr.compra, fr.forma_pago, "
                + "p.razon_social, p.primer_nombre, p.ruc, "
                + "p.mail, p.telefonos, p.direccion, "
                + "fr.monto_gravado, fr.monto_impuesto, "
                + "fr.monto_gravado_5, fr.monto_impuesto_5, "
                + "fr.monto_exento, fr.moneda, "
                + "fr.factor_cambio, fr.timbrado, fr.estado, fr.comentarios, "
                + "od.orden AS orden_pago, od.monto AS monto_erp, od.monto_retencion "
                + "FROM facturas_recibidas fr "
                + "JOIN personas p ON p.persona = fr.proveedor "
                + "LEFT JOIN ordenes_detalle od ON od.factura = fr.factura "
                + "WHERE fr.factura = ?";

        List<Factura> lista = jdbc.query(sql,
                new RowMapper<Factura>() {
            @Override
            public Factura mapRow(ResultSet rs, int rowNum)
                    throws SQLException {
                return mapearFactura(rs);
            }
        }, id);

        return lista.isEmpty() ? null : lista.get(0);
    }

    // Mapea los datos del ResultSet a un objeto Factura
    private Factura mapearFactura(ResultSet rs) throws SQLException {
        Factura f = new Factura();
        f.setFactura(rs.getLong("factura"));
        f.setFacturaFisica(rs.getString("factura_fisica"));
        f.setFecha(rs.getString("fecha"));

        long compraVal = rs.getLong("compra");
        f.setCompra(rs.wasNull() ? null : compraVal);

        long ordenVal = rs.getLong("orden_pago");
        f.setOrdenPago(rs.wasNull() ? null : ordenVal);

        double retErpVal = rs.getDouble("monto_retencion");
        f.setMontoRetencionErp(rs.wasNull() ? null : retErpVal);

        double montoErpVal = rs.getDouble("monto_erp");
        f.setMontoErp(rs.wasNull() ? null : montoErpVal);

        f.setFormaPago(rs.getString("forma_pago"));

        String razonSocial = rs.getString("razon_social");
        String primerNombre = rs.getString("primer_nombre");
        if (razonSocial != null && !razonSocial.trim().isEmpty()) {
            f.setRazonSocial(razonSocial);
        } else if (primerNombre != null && !primerNombre.trim().isEmpty()) {
            f.setRazonSocial(primerNombre);
        } else {
            f.setRazonSocial("Sin nombre");
        }

        f.setRuc(rs.getString("ruc"));
        f.setMontoGravado(rs.getDouble("monto_gravado"));
        f.setMontoImpuesto(rs.getDouble("monto_impuesto"));
        f.setMontoGravado5(rs.getDouble("monto_gravado_5"));
        f.setMontoImpuesto5(rs.getDouble("monto_impuesto_5"));
        f.setMontoExento(rs.getDouble("monto_exento"));
        f.setMoneda(rs.getString("moneda"));
        f.setFactorCambio(rs.getDouble("factor_cambio"));
        f.setTimbrado(rs.getString("timbrado"));
        f.setEstado(rs.getString("estado"));
        f.setComentarios(rs.getString("comentarios"));
        f.setCorreo(rs.getString("mail"));
        f.setTelefono(rs.getString("telefonos"));
        f.setDireccion(rs.getString("direccion"));
        return f;
    }
}