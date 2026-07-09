package com.dutriec.apiretenciones;

public class Factura {

    private Long factura;
    private String facturaFisica;
    private String fecha;
    private String razonSocial;
    private String ruc;
    private Double montoGravado;
    private Double montoImpuesto;
    private Double montoGravado5;
    private Double montoImpuesto5;
    private Double montoExento;
    private String moneda;
    private Double factorCambio;
    private String timbrado;
    private String estado;
    private Long compra;
    private String formaPago; // C=Contado, E=Crédito

    // Getters y Setters
    public Long getFactura() { return factura; }
    public void setFactura(Long factura) { this.factura = factura; }

    public Long getCompra() { return compra; }
    public void setCompra(Long compra) { this.compra = compra; }

    public String getFormaPago() { return formaPago; }
    public void setFormaPago(String formaPago) { this.formaPago = formaPago; }

    public String getFacturaFisica() { return facturaFisica; }
    public void setFacturaFisica(String facturaFisica) { this.facturaFisica = facturaFisica; }

    public String getFecha() { return fecha; }
    public void setFecha(String fecha) { this.fecha = fecha; }

    public String getRazonSocial() { return razonSocial; }
    public void setRazonSocial(String razonSocial) { this.razonSocial = razonSocial; }

    public String getRuc() { return ruc; }
    public void setRuc(String ruc) { this.ruc = ruc; }

    public Double getMontoGravado() { return montoGravado; }
    public void setMontoGravado(Double montoGravado) { this.montoGravado = montoGravado; }

    public Double getMontoImpuesto() { return montoImpuesto; }
    public void setMontoImpuesto(Double montoImpuesto) { this.montoImpuesto = montoImpuesto; }

    public Double getMontoGravado5() { return montoGravado5; }
    public void setMontoGravado5(Double montoGravado5) { this.montoGravado5 = montoGravado5; }

    public Double getMontoImpuesto5() { return montoImpuesto5; }
    public void setMontoImpuesto5(Double montoImpuesto5) { this.montoImpuesto5 = montoImpuesto5; }

    public Double getMontoExento() { return montoExento; }
    public void setMontoExento(Double montoExento) { this.montoExento = montoExento; }

    public String getMoneda() { return moneda; }
    public void setMoneda(String moneda) { this.moneda = moneda; }

    public Double getFactorCambio() { return factorCambio; }
    public void setFactorCambio(Double factorCambio) { this.factorCambio = factorCambio; }

    public String getTimbrado() { return timbrado; }
    public void setTimbrado(String timbrado) { this.timbrado = timbrado; }

    public String getEstado() { return estado; }
    public void setEstado(String estado) { this.estado = estado; }
}
