package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class FacturaController {

    @Autowired
    private FacturaRepository facturaRepo;

    @Autowired
    private RetencionRepository retencionRepo;

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
                // Simula envío — conectar con colega cuando confirme URL
                r.setNroComprobante(factura.getFacturaFisica());
                r.setEstado("SIMULADO");
                r.setMotivo("Pendiente conexión con colega");
                resultados.add(r);

            } catch (Exception e) {
                r.setEstado("ERROR");
                r.setMotivo(e.getMessage());
                resultados.add(r);
            }
        }
        return resultados;
    }
}
