package com.dutriec.apiretenciones;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Endpoint para generar JSON compatible con TESAKA (sistema DNIT)
 * POST /retenciones/generar-tesaka
 * Recibe lista de IDs de facturas de SQL Anywhere y genera el JSON de TESAKA
 */
@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class TesakaController {

    private final JdbcTemplate sqlAnywhere;
    private final JdbcTemplate mariaDb;
    private final ObjectMapper objectMapper;

    public TesakaController(
            @Qualifier("sqlAnywhereJdbcTemplate") JdbcTemplate sqlAnywhere,
            @Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb,
            ObjectMapper objectMapper) {
        this.sqlAnywhere = sqlAnywhere;
        this.mariaDb     = mariaDb;
        this.objectMapper = objectMapper;
    }

    // =========================================================================
    // POST /retenciones/generar-tesaka
    // Body: { "ids": [3195, 3196, ...] }
    // Genera JSON TESAKA y lo devuelve como archivo descargable
    // =========================================================================
    @PostMapping("/generar-tesaka")
    public ResponseEntity<byte[]> generarTesaka(@RequestBody Map<String, List<Long>> body) {
        List<Long> ids = body.get("ids");
        if (ids == null || ids.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        List<Map<String, Object>> registros = new ArrayList<>();

        for (Long idFactura : ids) {
            try {
                Map<String, Object> registro = construirRegistroTesaka(idFactura);
                if (registro != null) {
                    registros.add(registro);
                    // Guardar en MariaDB como TESAKA_GENERADO
                    guardarTesakaEnMariaDB(idFactura, registro);
                }
            } catch (Exception e) {
                // Continuar con las demás facturas si una falla
                System.err.println("Error procesando factura " + idFactura + ": " + e.getMessage());
            }
        }

        try {
            String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(registros);
            byte[] bytes = json.getBytes("UTF-8");

            String nombreArchivo = "tesaka_" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd")) + ".json";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setContentDisposition(ContentDisposition.attachment().filename(nombreArchivo).build());

            return new ResponseEntity<>(bytes, headers, HttpStatus.OK);

        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    // =========================================================================
    // Construye un registro TESAKA desde los datos de SQL Anywhere
    // =========================================================================
    private Map<String, Object> construirRegistroTesaka(Long idFactura) {
        // Obtener factura de SQL Anywhere
        List<Map<String, Object>> facturas = sqlAnywhere.queryForList(
            "SELECT fr.factura, fr.fecha, fr.factura_fisica, fr.moneda, " +
            "fr.monto_gravado, fr.monto_gravado_5, fr.monto_exento, " +
            "fr.monto_impuesto, fr.monto_impuesto_5, " +
            "fr.comentarios, fr.timbrado, fr.factor_cambio, " +
            "p.razon_social, p.ruc, p.direccion, p.telefonos, p.mail " +
            "FROM facturas_recibidas fr " +
            "JOIN personas p ON fr.proveedor = p.persona " +
            "WHERE fr.factura = ?", idFactura
        );
        System.out.println("facturas");
        System.out.println(facturas);
        
        if (facturas.isEmpty()) return null;
        Map<String, Object> f = facturas.get(0);

        // ---- Separar RUC y DV ----
        String rucCompleto = String.valueOf(f.get("ruc") != null ? f.get("ruc") : "");
        String ruc = rucCompleto;
        String dv  = "0";
        if (rucCompleto.contains("-")) {
            String[] partes = rucCompleto.split("-");
            ruc = partes[0];
            dv  = partes.length > 1 ? partes[1] : "0";
        }

        // ---- Montos ----
        double montoGravado10 = toDouble(f.get("monto_gravado"));
        double montoGravado5  = toDouble(f.get("monto_gravado_5"));
        double montoExento    = toDouble(f.get("monto_exento"));
        double montoImpuesto  = toDouble(f.get("monto_impuesto"));
        double montoImpuesto5 = toDouble(f.get("monto_impuesto_5"));
        double factorCambio   = toDouble(f.get("factor_cambio"));
        if (factorCambio == 0) factorCambio = 1;

        String moneda = String.valueOf(f.get("moneda") != null ? f.get("moneda") : "GS");
        String monedaTesaka = (moneda.equals("DL") || moneda.equals("USD")) ? "USD" : "PYG";

        // ---- DETALLE ----
        List<Map<String, Object>> detalle = new ArrayList<>();

        if (montoGravado10 > 0) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("cantidad", 1);
            item.put("tasaAplica", "10");
            item.put("precioUnitario", montoGravado10);
            item.put("descripcion", f.get("comentarios") != null ? f.get("comentarios") : "Servicio/Compra gravado 10%");
            detalle.add(item);
        }
        if (montoGravado5 > 0) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("cantidad", 1);
            item.put("tasaAplica", "5");
            item.put("precioUnitario", montoGravado5);
            item.put("descripcion", f.get("comentarios") != null ? f.get("comentarios") : "Servicio/Compra gravado 5%");
            detalle.add(item);
        }
        if (montoExento > 0) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("cantidad", 1);
            item.put("tasaAplica", "EXENTO");
            item.put("precioUnitario", montoExento);
            item.put("descripcion", f.get("comentarios") != null ? f.get("comentarios") : "Servicio/Compra exento");
            detalle.add(item);
        }
        if (detalle.isEmpty()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("cantidad", 1);
            item.put("tasaAplica", "10");
            item.put("precioUnitario", montoGravado10);
            item.put("descripcion", f.get("comentarios") != null ? f.get("comentarios") : "Sin descripcion");
            detalle.add(item);
        }

        // ---- RETENCION ----
        Map<String, Object> retencion = new LinkedHashMap<>();
        retencion.put("fecha", String.valueOf(f.get("fecha")));
        retencion.put("moneda", monedaTesaka);
        retencion.put("tipoCambio", (int) factorCambio);
        retencion.put("retencionRenta", false);
        retencion.put("conceptoRenta", "");
        retencion.put("ivaPorcentaje5",  montoGravado5  > 0 ? 30 : 0);
        retencion.put("ivaPorcentaje10", montoGravado10 > 0 ? 30 : 0);
        retencion.put("rentaCabezasBase", 0);
        retencion.put("rentaCabezasCantidad", 0);
        retencion.put("rentaToneladasBase", 0);
        retencion.put("rentaToneladasCantidad", 0);
        retencion.put("rentaPorcentaje", 0);
        retencion.put("retencionIva", true);
        retencion.put("conceptoIva", "IVA.1");

        // ---- INFORMADO (proveedor) ----
        Map<String, Object> informado = new LinkedHashMap<>();
        informado.put("situacion", "CONTRIBUYENTE");
        informado.put("nombre", f.get("razon_social") != null ? f.get("razon_social") : "");
        informado.put("ruc", ruc);
        informado.put("dv", dv);
        informado.put("domicilio", f.get("direccion") != null ? f.get("direccion") : "");
        informado.put("tipoIdentificacion", "RUC");
        informado.put("identificacion", ruc);
        informado.put("direccion", f.get("direccion") != null ? f.get("direccion") : "");
        informado.put("correoElectronico", f.get("mail") != null ? f.get("mail") : "");
        informado.put("pais", "PY");
        informado.put("telefono", f.get("telefonos") != null ? f.get("telefonos") : "");
        informado.put("tieneRepresentante", false);
        informado.put("tieneBeneficiario", false);

        Map<String, Object> representante = new LinkedHashMap<>();
        representante.put("nombre", "");
        representante.put("tipoIdentificacion", "RUC");
        representante.put("identificacion", "");
        informado.put("representante", representante);

        Map<String, Object> beneficiario = new LinkedHashMap<>();
        beneficiario.put("nombre", "");
        beneficiario.put("tipoIdentificacion", "RUC");
        beneficiario.put("identificacion", "");
        informado.put("beneficiario", beneficiario);

        // ---- TRANSACCION ----
        Map<String, Object> transaccion = new LinkedHashMap<>();
        transaccion.put("numeroComprobanteVenta", f.get("factura_fisica") != null ? f.get("factura_fisica") : "");
        transaccion.put("condicionCompra", "CREDITO");
        transaccion.put("tipoComprobante", 1);
        transaccion.put("fecha", String.valueOf(f.get("fecha")));
        transaccion.put("numeroTimbrado", f.get("timbrado") != null ? String.valueOf(f.get("timbrado")) : "");

        // ---- ATRIBUTOS ----
        String ahora = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        String hoy   = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
        Map<String, Object> atributos = new LinkedHashMap<>();
        atributos.put("fechaCreacion", hoy);
        atributos.put("fechaHoraCreacion", ahora);

        // ---- REGISTRO COMPLETO ----
        Map<String, Object> registro = new LinkedHashMap<>();
        registro.put("detalle", detalle);
        registro.put("retencion", retencion);
        registro.put("informado", informado);
        registro.put("transaccion", transaccion);
        registro.put("atributos", atributos);

        return registro;
    }

    // =========================================================================
    // Guarda el registro en MariaDB con estado TESAKA_GENERADO
    // =========================================================================
    private void guardarTesakaEnMariaDB(Long idFactura, Map<String, Object> registro) {
        try {
            // Verificar si ya existe
            Integer count = mariaDb.queryForObject(
                "SELECT COUNT(*) FROM retenciones_enviadas WHERE id_factura_orig = ? AND estado = 'TESAKA_GENERADO'",
                Integer.class, idFactura
            );
            if (count != null && count > 0) return;

            Map<String, Object> transaccion = (Map<String, Object>) registro.get("transaccion");
            Map<String, Object> informado   = (Map<String, Object>) registro.get("informado");
            Map<String, Object> retencionM  = (Map<String, Object>) registro.get("retencion");
            Map<String, Object> detalle     = ((List<Map<String, Object>>) registro.get("detalle")).get(0);

            double base = toDouble(detalle.get("precioUnitario"));
            int pctIva10 = (int) toDouble(retencionM.get("ivaPorcentaje10"));
            int pctIva5  = (int) toDouble(retencionM.get("ivaPorcentaje5"));
            double retencion = base * Math.max(pctIva10, pctIva5) / 100.0;

            mariaDb.update(
                "INSERT INTO retenciones_enviadas " +
                "(id_factura_orig, nro_comprobante, ruc_proveedor, razon_social, " +
                "monto, retencion, moneda, estado, fecha_envio) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'TESAKA_GENERADO', NOW())",
                idFactura,
                transaccion.get("numeroComprobanteVenta"),
                informado.get("ruc") + "-" + informado.get("dv"),
                informado.get("nombre"),
                base,
                retencion,
                "GS"
            );
        } catch (Exception e) {
            System.err.println("Error guardando en MariaDB: " + e.getMessage());
        }
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        try { return Double.parseDouble(val.toString()); }
        catch (Exception e) { return 0.0; }
    }
}
