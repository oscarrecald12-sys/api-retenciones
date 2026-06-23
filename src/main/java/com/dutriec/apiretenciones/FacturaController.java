package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class FacturaController {

    @Autowired
    private FacturaRepository facturaRepo;

    @Autowired
    private RetencionRepository retencionRepo;

    @Autowired
    @Qualifier("sqlAnywhereJdbcTemplate")
    private JdbcTemplate sqlAnywhere;

    @Autowired
    @Qualifier("mariadbJdbcTemplate")
    private JdbcTemplate mariaDb;

    // GET — trae las facturas pendientes de SQL Anywhere
    @GetMapping("/pendientes")
    public List<Factura> obtenerPendientes() {
        return facturaRepo.obtenerPendientes();
    }

    // POST — recibe IDs y procesa el envío al SIFEN
    @PostMapping("/enviar-lote")
    public List<Resultado> enviarLote(@RequestBody List<Long> ids) {

        List<Resultado> resultados = new ArrayList<>();
        String timbrado = retencionRepo.obtenerTimbradoActivo();

        for (Long id : ids) {
            Resultado r = new Resultado();
            r.setIdFactura(id);
            try {
                Factura factura = facturaRepo.obtenerPorId(id);
                if (factura == null) {
                    r.setEstado("ERROR");
                    r.setMotivo("Factura no encontrada: " + id);
                    resultados.add(r);
                    continue;
                }

                // ---- Traer datos completos del proveedor desde SQL Anywhere ----
                Map<String, Object> proveedor = obtenerDatosProveedor(id);

                // ---- Generar correlativo ----
                String numDocRet = retencionRepo.generarNumDocRet();

                // ---- Calcular retención (30% IVA) ----
                double montoGravado = factura.getMontoGravado() != null ? factura.getMontoGravado() : 0;
                double montoImpuesto = factura.getMontoImpuesto() != null ? factura.getMontoImpuesto() : 0;
                double retencion = Math.round(montoImpuesto * 0.30);

                String ruc = proveedor != null ? String.valueOf(proveedor.get("ruc")) : factura.getRuc();
                String razonSocial = proveedor != null ? String.valueOf(proveedor.get("razon_social")) : "";
                String correo = proveedor != null && proveedor.get("mail") != null ? String.valueOf(proveedor.get("mail")) : null;
                String telefono = proveedor != null && proveedor.get("telefonos") != null ? String.valueOf(proveedor.get("telefonos")) : null;
                String direccion = proveedor != null && proveedor.get("direccion") != null ? String.valueOf(proveedor.get("direccion")) : null;

                // ---- Guardar en MariaDB con datos completos del proveedor ----
                mariaDb.update(
                    "INSERT INTO retenciones_enviadas " +
                    "(id_factura_orig, nro_comprobante, ruc_proveedor, razon_social, " +
                    "monto, retencion, moneda, estado, num_timbrado, " +
                    "correo_proveedor, telefono_proveedor, direccion_proveedor, fecha_envio) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, NOW())",
                    id,
                    factura.getFacturaFisica(),
                    ruc,
                    razonSocial,
                    montoGravado,
                    retencion,
                    factura.getMoneda() != null ? factura.getMoneda() : "GS",
                    timbrado,
                    correo,
                    telefono,
                    direccion
                );

                r.setNroComprobante(factura.getFacturaFisica());
                r.setEstado("PENDIENTE");
                r.setMotivo("Guardado correctamente — Nº doc: " + numDocRet);
                resultados.add(r);

            } catch (Exception e) {
                r.setEstado("ERROR");
                r.setMotivo(e.getMessage());
                resultados.add(r);
            }
        }
        return resultados;
    }

    // =========================================================================
    // Trae los datos completos del proveedor desde SQL Anywhere
    // a partir del ID de la factura
    // =========================================================================
    private Map<String, Object> obtenerDatosProveedor(Long idFactura) {
        try {
            List<Map<String, Object>> resultado = sqlAnywhere.queryForList(
                "SELECT p.razon_social, p.ruc, p.mail, p.telefonos, p.direccion " +
                "FROM facturas_recibidas fr " +
                "JOIN personas p ON fr.proveedor = p.persona " +
                "WHERE fr.factura = ?", idFactura
            );
            return resultado.isEmpty() ? null : resultado.get(0);
        } catch (Exception e) {
            System.err.println("Error obteniendo datos del proveedor: " + e.getMessage());
            return null;
        }
    }
}
