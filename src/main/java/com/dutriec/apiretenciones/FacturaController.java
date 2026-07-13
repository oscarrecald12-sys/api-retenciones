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
    // FIX: se agregó printStackTrace() en el catch para exponer el error real
    //      en lugar de solo mostrar el mensaje superficial.
    @PostMapping("/enviar-lote")
    public List<Resultado> enviarLote(@RequestBody List<Long> ids) {

        List<Resultado> resultados = new ArrayList<>();

        // Validación de entrada
        if (ids == null || ids.isEmpty()) return resultados;
        if (ids.size() > 500) {
            Resultado err = new Resultado();
            err.setEstado("ERROR");
            err.setMotivo("Máximo 500 facturas por lote. Recibidas: " + ids.size());
            resultados.add(err);
            return resultados;
        }

        String timbrado = retencionRepo.obtenerTimbradoActivo();

        // OPTIMIZACIÓN: chequear duplicados en UNA sola query (antes era 1 por factura)
        String placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        List<Long> yaEnviadas = mariaDb.queryForList(
            "SELECT DISTINCT id_factura_orig FROM retenciones_enviadas " +
            "WHERE id_factura_orig IN (" + placeholders + ") " +
            "AND estado NOT IN ('RECHAZADO','ERROR')",
            Long.class, ids.toArray()
        );
        java.util.Set<Long> setYaEnviadas = new java.util.HashSet<>(yaEnviadas);

        for (Long id : ids) {
            Resultado r = new Resultado();
            r.setIdFactura(id);
            try {
                // Duplicado: detectado con la query batch de arriba
                if (setYaEnviadas.contains(id)) {
                    r.setEstado("ERROR");
                    r.setMotivo("La factura " + id + " ya fue aprobada anteriormente (duplicado evitado)");
                    resultados.add(r);
                    continue;
                }

                Factura factura = facturaRepo.obtenerPorId(id);
                if (factura == null) {
                    r.setEstado("ERROR");
                    r.setMotivo("Factura no encontrada: " + id);
                    resultados.add(r);
                    continue;
                }

                // Guard: si factura_fisica sigue null aquí, loguear y continuar
                if (factura.getFacturaFisica() == null || factura.getFacturaFisica().isBlank()) {
                    System.err.println("[enviar-lote] factura_fisica null para id=" + id
                            + " — revisar campo en SQL Anywhere");
                    r.setEstado("ERROR");
                    r.setMotivo("nroComprobante (factura_fisica) es null para factura " + id
                            + ". Verificar campo factura_fisica en SQL Anywhere.");
                    resultados.add(r);
                    continue;
                }

                // Validación: la factura debe tener orden de pago asignada
                if (factura.getCompra() == null) {
                    r.setEstado("ERROR");
                    r.setMotivo("La factura " + factura.getFacturaFisica()
                            + " no tiene orden de pago asignada. Generá primero la orden de pago.");
                    resultados.add(r);
                    continue;
                }

                // ---- Generar correlativo ----
                String numDocRet = retencionRepo.generarNumDocRet();

                // ---- Calcular retención (30% IVA) ----
                double montoGravado  = factura.getMontoGravado()  != null ? factura.getMontoGravado()  : 0;
                double montoImpuesto = factura.getMontoImpuesto() != null ? factura.getMontoImpuesto() : 0;
                double retencion     = Math.round(montoImpuesto * 0.30);

                // OPTIMIZACIÓN: los datos del proveedor ya vienen en obtenerPorId
                // (antes se hacía una SEGUNDA query idéntica a SQL Anywhere solo para
                // mail/teléfono/dirección — se eliminó obtenerDatosProveedor)
                String ruc         = factura.getRuc();
                String razonSocial = factura.getRazonSocial() != null && !factura.getRazonSocial().trim().isEmpty()
                        ? factura.getRazonSocial().trim() : "Sin nombre";
                String correo      = factura.getCorreo();
                String telefono    = factura.getTelefono();
                String direccion   = factura.getDireccion();

                // ---- Guardar en MariaDB ----
                // NOTA: si las columnas num_timbrado / correo_proveedor / telefono_proveedor /
                //       direccion_proveedor no existen aún en tu BD, ejecuta primero
                //       migration_add_columns.sql incluido en este paquete de corrección.
                mariaDb.update(
                    "INSERT INTO retenciones_enviadas " +
                    "(id_factura_orig, nro_comprobante, ruc_proveedor, razon_social, concepto, " +
                    "monto, retencion, moneda, factor_cambio, estado, num_timbrado, timbrado_proveedor, " +
                    "fecha_factura, correo_proveedor, telefono_proveedor, direccion_proveedor, fecha_envio) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, NOW())",
                    id,
                    factura.getFacturaFisica(),
                    ruc,
                    razonSocial,
                    factura.getComentarios() != null ? factura.getComentarios().trim() : null,
                    montoGravado,
                    retencion,
                    factura.getMoneda() != null ? factura.getMoneda() : "GS",
                    factura.getFactorCambio() != null && factura.getFactorCambio() > 0
                        ? factura.getFactorCambio() : null,
                    timbrado,
                    factura.getTimbrado() != null ? factura.getTimbrado().trim() : "",
                    // FIX Bug fecha: guardar la fecha de la FACTURA del proveedor
                    // para usarla en transaccion.fecha del TXT de Tesaka
                    factura.getFecha() != null && factura.getFecha().length() >= 10
                        ? factura.getFecha().substring(0, 10) : null,
                    correo,
                    telefono,
                    direccion
                );

                r.setNroComprobante(factura.getFacturaFisica());
                r.setEstado("PENDIENTE");
                r.setMotivo("Guardado correctamente — Nº doc: " + numDocRet);
                resultados.add(r);

            } catch (Exception e) {
                // FIX: printStackTrace() para ver el error completo en la consola Spring
                System.err.println("[enviar-lote] ERROR procesando factura " + id + ": " + e.getMessage());
                e.printStackTrace();
                r.setEstado("ERROR");
                r.setMotivo(e.getMessage());
                resultados.add(r);
            }
        }
        return resultados;
    }

}
