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
 *
 * CORREGIDO según las reglas del validador real de Tesaka (jul/2026):
 *  1. Para CONTRIBUYENTE: tipoIdentificacion, identificacion, direccion,
 *     correoElectronico, telefono y pais van VACIOS ("No se permite valor...")
 *  2. DV calculado con modulo 11 de la SET cuando el RUC viene sin guion
 *     (antes default "0" -> "El Digito Verificador no es correcto")
 *  3. numeroComprobanteVenta formateado a XXX-XXX-XXXXXXX
 *  4. numeroTimbrado debe tener 8 digitos para contribuyente con factura
 *  5. tasaAplica exento es "0" (no "EXENTO")
 *  6. condicionCompra CREDITO exige cuotas > 0 (se agrega el campo cuotas)
 *  7. representante/beneficiario solo aplican a NO_RESIDENTE (se quitan)
 *  8. precioUnitario gravado es IVA INCLUIDO segun especificacion
 *     (antes se enviaba monto_gravado sin IVA y la retencion salia menor)
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
    // Genera JSON TESAKA y lo devuelve como archivo descargable.
    // Si hay facturas con errores de validacion, se excluyen y se informan
    // en el header X-Tesaka-Errores (y por consola).
    // =========================================================================
    @PostMapping("/generar-tesaka")
    public ResponseEntity<?> generarTesaka(@RequestBody Map<String, List<Long>> body) {
        List<Long> ids = body.get("ids");
        if (ids == null || ids.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        List<Map<String, Object>> registros = new ArrayList<>();
        List<String> errores = new ArrayList<>();

        for (Long idFactura : ids) {
            try {
                Map<String, Object> registro = construirRegistroTesaka(idFactura);
                if (registro == null) {
                    errores.add("Factura " + idFactura + ": no encontrada en SQL Anywhere");
                    continue;
                }

                // Validar ANTES de incluir: las invalidas no entran al archivo
                List<String> erroresRegistro = validarRegistro(registro, idFactura);
                if (!erroresRegistro.isEmpty()) {
                    errores.addAll(erroresRegistro);
                    continue;
                }

                registros.add(registro);
                guardarTesakaEnMariaDB(idFactura, registro);

            } catch (Exception e) {
                errores.add("Factura " + idFactura + ": " + e.getMessage());
            }
        }

        if (!errores.isEmpty()) {
            errores.forEach(err -> System.err.println("[TESAKA] " + err));
        }

        // Si ninguna factura paso la validacion, devolver los errores como JSON
        if (registros.isEmpty()) {
            Map<String, Object> respuestaError = new LinkedHashMap<>();
            respuestaError.put("error", "Ninguna factura paso la validacion Tesaka");
            respuestaError.put("detalles", errores);
            return ResponseEntity.unprocessableEntity().body(respuestaError);
        }

        try {
            String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(registros);
            byte[] bytes = json.getBytes("UTF-8");

            // Tesaka importa archivos .txt con contenido JSON
            String nombreArchivo = "tesaka_" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd")) + ".txt";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.TEXT_PLAIN);
            headers.setContentDisposition(ContentDisposition.attachment().filename(nombreArchivo).build());
            // Informar al frontend cuantas quedaron fuera y por que
            headers.add("X-Tesaka-Generadas", String.valueOf(registros.size()));
            headers.add("X-Tesaka-Con-Errores", String.valueOf(errores.size()));

            return new ResponseEntity<>(bytes, headers, HttpStatus.OK);

        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    // =========================================================================
    // Construye un registro TESAKA desde los datos de SQL Anywhere
    // =========================================================================
    private Map<String, Object> construirRegistroTesaka(Long idFactura) {
        List<Map<String, Object>> facturas = sqlAnywhere.queryForList(
            "SELECT fr.factura, fr.fecha, fr.factura_fisica, fr.moneda, " +
            "fr.monto_gravado, fr.monto_gravado_5, fr.monto_exento, " +
            "fr.monto_impuesto, fr.monto_impuesto_5, " +
            "fr.comentarios, fr.timbrado, fr.factor_cambio, fr.condicion_compra, fr.cuotas, " +
            "p.razon_social, p.ruc, p.direccion, p.telefonos, p.mail " +
            "FROM facturas_recibidas fr " +
            "JOIN personas p ON fr.proveedor = p.persona " +
            "WHERE fr.factura = ?", idFactura
        );
        // NOTA: si facturas_recibidas no tiene condicion_compra/cuotas,
        // quitar esas columnas del SELECT (el codigo usa CONTADO por defecto).

        if (facturas.isEmpty()) return null;
        Map<String, Object> f = facturas.get(0);

        // ---- Separar RUC y DV ----
        String rucCompleto = String.valueOf(f.get("ruc") != null ? f.get("ruc") : "").trim();
        String ruc = rucCompleto;
        String dv;
        if (rucCompleto.contains("-")) {
            String[] partes = rucCompleto.split("-");
            ruc = partes[0].trim();
            dv  = partes.length > 1 ? partes[1].trim() : calcularDvRuc(ruc);
        } else {
            // FIX: antes se defaulteaba a "0" y Tesaka rechazaba el DV.
            dv = calcularDvRuc(ruc);
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

        String descripcionBase = f.get("comentarios") != null
                ? String.valueOf(f.get("comentarios")) : null;

        // ---- DETALLE ----
        // FIX: segun la especificacion, precioUnitario para importes gravados
        // es IVA INCLUIDO (Tesaka calcula la base del IVA como precio/11 o /21).
        // Antes se enviaba solo el gravado sin IVA y la retencion salia menor.
        List<Map<String, Object>> detalle = new ArrayList<>();

        if (montoGravado10 > 0) {
            detalle.add(itemDetalle("10",
                redondear(montoGravado10 + montoImpuesto),
                descripcionBase != null ? descripcionBase : "Servicio/Compra gravado 10%"));
        }
        if (montoGravado5 > 0) {
            detalle.add(itemDetalle("5",
                redondear(montoGravado5 + montoImpuesto5),
                descripcionBase != null ? descripcionBase : "Servicio/Compra gravado 5%"));
        }
        if (montoExento > 0) {
            // FIX: la tasa exenta es "0", no "EXENTO"
            detalle.add(itemDetalle("0",
                redondear(montoExento),
                descripcionBase != null ? descripcionBase : "Servicio/Compra exento"));
        }
        // Sin fallback con monto 0: si no hay montos, la validacion lo rechaza
        // con un mensaje claro en vez de generar un registro invalido.

        // ---- Fechas normalizadas a YYYY-MM-DD ----
        String fechaFactura = normalizarFecha(f.get("fecha"));
        String hoy = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));

        // ---- RETENCION ----
        Map<String, Object> retencion = new LinkedHashMap<>();
        retencion.put("fecha", hoy); // fecha de la retencion (hoy), no la de la factura
        retencion.put("moneda", monedaTesaka);
        // tipoCambio SOLO con moneda extranjera: Tesaka rechaza el campo con PYG
        // ("No debe especificar un tipo de cambio para la moneda especificada")
        if (!"PYG".equals(monedaTesaka)) {
            retencion.put("tipoCambio", (int) factorCambio);
        }
        retencion.put("retencionRenta", false);
        retencion.put("conceptoRenta", "");
        retencion.put("retencionIva", true);
        retencion.put("conceptoIva", "IVA.1");
        retencion.put("rentaPorcentaje", 0);
        retencion.put("rentaCabezasBase", 0);
        retencion.put("rentaCabezasCantidad", 0);
        retencion.put("rentaToneladasBase", 0);
        retencion.put("rentaToneladasCantidad", 0);
        retencion.put("ivaPorcentaje5",  montoGravado5  > 0 ? 30 : 0);
        retencion.put("ivaPorcentaje10", montoGravado10 > 0 ? 30 : 0);

        // ---- INFORMADO (proveedor) ----
        // FIX: para CONTRIBUYENTE, Tesaka rechaza valores en tipoIdentificacion,
        // identificacion, direccion, correoElectronico, telefono y pais
        // ("No se permite valor para campo ..."). Van todos vacios.
        Map<String, Object> informado = new LinkedHashMap<>();
        informado.put("situacion", "CONTRIBUYENTE");
        informado.put("ruc", ruc);
        informado.put("dv", dv);
        informado.put("tipoIdentificacion", "");
        informado.put("identificacion", "");
        informado.put("nombre", f.get("razon_social") != null ? String.valueOf(f.get("razon_social")).trim() : "");
        informado.put("domicilio", f.get("direccion") != null ? String.valueOf(f.get("direccion")).trim() : "Domicilio Fiscal");
        informado.put("direccion", "");
        informado.put("correoElectronico", "");
        informado.put("telefono", "");
        informado.put("pais", "");
        informado.put("tieneRepresentante", false);
        informado.put("tieneBeneficiario", false);
        // FIX: representante y beneficiario eliminados
        // (solo aplican cuando situacion = NO_RESIDENTE)

        // ---- TRANSACCION ----
        // Condicion de compra real de la factura; CONTADO por defecto.
        // Si es CREDITO, cuotas debe ser > 0 (regla de Tesaka).
        String condicion = "CONTADO";
        int cuotas = 0;
        Object condObj = f.get("condicion_compra");
        if (condObj != null && String.valueOf(condObj).toUpperCase().contains("CRED")) {
            condicion = "CREDITO";
            cuotas = Math.max(1, (int) toDouble(f.get("cuotas")));
        }

        Map<String, Object> transaccion = new LinkedHashMap<>();
        transaccion.put("condicionCompra", condicion);
        transaccion.put("cuotas", cuotas);
        transaccion.put("tipoComprobante", 1);
        // FIX: formato XXX-XXX-XXXXXXX exigido por Tesaka
        transaccion.put("numeroComprobanteVenta",
                formatearComprobante(f.get("factura_fisica") != null ? String.valueOf(f.get("factura_fisica")) : ""));
        transaccion.put("fecha", fechaFactura);
        transaccion.put("numeroTimbrado",
                f.get("timbrado") != null ? String.valueOf(f.get("timbrado")).trim() : "");

        // ---- ATRIBUTOS ----
        String ahora = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        Map<String, Object> atributos = new LinkedHashMap<>();
        atributos.put("fechaCreacion", hoy);
        atributos.put("fechaHoraCreacion", ahora);

        // ---- REGISTRO COMPLETO ----
        Map<String, Object> registro = new LinkedHashMap<>();
        registro.put("atributos", atributos);
        registro.put("informado", informado);
        registro.put("transaccion", transaccion);
        registro.put("detalle", detalle);
        registro.put("retencion", retencion);

        return registro;
    }

    // =========================================================================
    // Validacion previa: replica las reglas del validador de Tesaka.
    // Devuelve lista de errores (vacia = valido).
    // =========================================================================
    @SuppressWarnings("unchecked")
    private List<String> validarRegistro(Map<String, Object> registro, Long idFactura) {
        List<String> errores = new ArrayList<>();
        String pref = "Factura " + idFactura + ": ";

        Map<String, Object> inf = (Map<String, Object>) registro.get("informado");
        Map<String, Object> tr  = (Map<String, Object>) registro.get("transaccion");
        Map<String, Object> ret = (Map<String, Object>) registro.get("retencion");
        List<Map<String, Object>> det = (List<Map<String, Object>>) registro.get("detalle");

        String comprobante = String.valueOf(tr.get("numeroComprobanteVenta"));
        if (!comprobante.matches("\\d{3}-\\d{3}-\\d{1,7}")) {
            errores.add(pref + "numeroComprobanteVenta invalido \"" + comprobante + "\" (formato 999-999-9999999)");
        }

        String timbrado = String.valueOf(tr.get("numeroTimbrado"));
        if ("CONTRIBUYENTE".equals(inf.get("situacion")) && !timbrado.matches("\\d{8}")) {
            errores.add(pref + "numeroTimbrado invalido \"" + timbrado + "\" (debe tener 8 digitos - cargar timbrado del proveedor)");
        }

        if ("CREDITO".equals(tr.get("condicionCompra")) && (int) tr.get("cuotas") < 1) {
            errores.add(pref + "cuotas debe ser > 0 con condicion CREDITO");
        }

        String ruc = String.valueOf(inf.get("ruc"));
        String dv  = String.valueOf(inf.get("dv"));
        if (ruc.isEmpty()) {
            errores.add(pref + "RUC del proveedor vacio");
        } else if (!dv.equals(calcularDvRuc(ruc))) {
            errores.add(pref + "DV \"" + dv + "\" no coincide con el calculado (" + calcularDvRuc(ruc) + ") para RUC " + ruc + " - revisar carga del proveedor");
        }

        if (det == null || det.isEmpty()) {
            errores.add(pref + "sin detalle (todos los montos en 0)");
        } else {
            for (Map<String, Object> item : det) {
                if (toDouble(item.get("precioUnitario")) <= 0) {
                    errores.add(pref + "precioUnitario debe ser mayor a 0");
                }
            }
        }

        String monedaVal = String.valueOf(ret.get("moneda"));
        Object tcObj = ret.get("tipoCambio");
        if (!"PYG".equals(monedaVal)) {
            int tc = tcObj != null ? (int) toDouble(tcObj) : 0;
            if (tc <= 1) {
                errores.add(pref + "tipoCambio sospechoso (" + tc + ") para moneda " + monedaVal + " - cargar cotizacion real");
            }
        } else if (tcObj != null) {
            errores.add(pref + "tipoCambio no debe enviarse cuando la moneda es PYG");
        }

        boolean retieneIva   = Boolean.TRUE.equals(ret.get("retencionIva"));
        boolean retieneRenta = Boolean.TRUE.equals(ret.get("retencionRenta"));
        if (!retieneIva && !retieneRenta) {
            errores.add(pref + "debe retener al menos IVA o Renta");
        }

        return errores;
    }

    // =========================================================================
    // Guarda el registro en MariaDB con estado TESAKA_GENERADO
    // =========================================================================
    @SuppressWarnings("unchecked")
    private void guardarTesakaEnMariaDB(Long idFactura, Map<String, Object> registro) {
        try {
            // Guard anti-duplicado: sólo bloquea si YA está en un estado
            // "vivo" del flujo. Una factura REVERTIDA (o PENDIENTE) debe
            // poder re-generar su TXT, así que NO cuenta como duplicado.
            Integer count = mariaDb.queryForObject(
                "SELECT COUNT(*) FROM retenciones_enviadas " +
                "WHERE id_factura_orig = ? " +
                "AND estado IN ('TESAKA_GENERADO','APROBADO')",
                Integer.class, idFactura
            );
            if (count != null && count > 0) return;

            // Si viene de una REVERTIDA, la "revivimos" a TESAKA_GENERADO
            // en lugar de insertar una fila nueva (conserva contadores e
            // historial). Devuelve >0 si actualizó una revertida existente.
            int revividas = mariaDb.update(
                "UPDATE retenciones_enviadas " +
                "SET estado = 'TESAKA_GENERADO', fecha_actualizacion = NOW() " +
                "WHERE id_factura_orig = ? AND estado = 'REVERTIDA'",
                idFactura
            );
            if (revividas > 0) return;

            Map<String, Object> transaccion = (Map<String, Object>) registro.get("transaccion");
            Map<String, Object> informado   = (Map<String, Object>) registro.get("informado");
            Map<String, Object> retencionM  = (Map<String, Object>) registro.get("retencion");
            List<Map<String, Object>> detalle = (List<Map<String, Object>>) registro.get("detalle");

            String monedaTesaka = String.valueOf(retencionM.get("moneda"));

            // FIX: la retencion de IVA se calcula sobre el IMPUESTO, no sobre la base.
            // precioUnitario es IVA incluido: impuesto10 = precio/11, impuesto5 = precio/21.
            double base = 0, montoRetencion = 0;
            int pctIva10 = (int) toDouble(retencionM.get("ivaPorcentaje10"));
            int pctIva5  = (int) toDouble(retencionM.get("ivaPorcentaje5"));

            for (Map<String, Object> item : detalle) {
                double precio = toDouble(item.get("precioUnitario"));
                String tasa = String.valueOf(item.get("tasaAplica"));
                base += precio;
                if ("10".equals(tasa)) {
                    montoRetencion += (precio / 11.0) * pctIva10 / 100.0;
                } else if ("5".equals(tasa)) {
                    montoRetencion += (precio / 21.0) * pctIva5 / 100.0;
                }
                // tasa "0" (exento) no genera retencion de IVA
            }

            mariaDb.update(
                "INSERT INTO retenciones_enviadas " +
                "(id_factura_orig, nro_comprobante, ruc_proveedor, razon_social, " +
                "monto, retencion, moneda, estado, fecha_envio) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'TESAKA_GENERADO', NOW())",
                idFactura,
                transaccion.get("numeroComprobanteVenta"),
                informado.get("ruc") + "-" + informado.get("dv"),
                informado.get("nombre"),
                redondear(base),
                redondear(montoRetencion),
                monedaTesaka // FIX: antes hardcodeado "GS" aunque fuera USD
            );
        } catch (Exception e) {
            System.err.println("Error guardando en MariaDB: " + e.getMessage());
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Calcula el digito verificador de un RUC paraguayo (modulo 11 de la SET).
     * Ej: calcularDvRuc("80009651") -> "7"
     */
    private String calcularDvRuc(String ruc) {
        String digitos = ruc.replaceAll("\\D", "");
        if (digitos.isEmpty()) return "";
        int k = 2, total = 0;
        for (int i = digitos.length() - 1; i >= 0; i--) {
            total += Character.getNumericValue(digitos.charAt(i)) * k;
            k++;
            if (k > 11) k = 2;
        }
        int resto = total % 11;
        return String.valueOf(resto > 1 ? 11 - resto : 0);
    }

    /**
     * Formatea el numero de comprobante a XXX-XXX-XXXXXXX.
     * Acepta "0010020012152", "001-002-0012152", "1-2-12152", etc.
     */
    private String formatearComprobante(String numero) {
        if (numero == null || numero.trim().isEmpty()) return "";
        String s = numero.trim();

        String[] partes = s.split("-");
        if (partes.length == 3) {
            return pad(partes[0], 3) + "-" + pad(partes[1], 3) + "-" + pad(partes[2], 7);
        }

        String limpio = s.replaceAll("\\D", "");
        if (limpio.length() >= 7 && limpio.length() <= 13) {
            return limpio.substring(0, 3) + "-" + limpio.substring(3, 6) + "-" + pad(limpio.substring(6), 7);
        }
        return s; // la validacion lo reportara si no cumple
    }

    private String pad(String s, int largo) {
        StringBuilder sb = new StringBuilder(s.trim());
        while (sb.length() < largo) sb.insert(0, '0');
        return sb.toString();
    }

    /** Normaliza cualquier fecha (java.sql.Date, Timestamp, String) a YYYY-MM-DD */
    private String normalizarFecha(Object fecha) {
        if (fecha == null) return LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
        String s = String.valueOf(fecha);
        return s.length() >= 10 ? s.substring(0, 10) : s;
    }

    private double redondear(double valor) {
        return Math.round(valor * 100.0) / 100.0;
    }

    private Map<String, Object> itemDetalle(String tasa, double precio, String descripcion) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("cantidad", 1);
        item.put("tasaAplica", tasa);
        item.put("precioUnitario", precio);
        item.put("descripcion", descripcion.length() > 300 ? descripcion.substring(0, 300) : descripcion);
        return item;
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        try { return Double.parseDouble(val.toString()); }
        catch (Exception e) { return 0.0; }
    }
}