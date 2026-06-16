package com.dutriec.apiretenciones;

public class Resultado {

    private Long idFactura;
    private String nroComprobante;
    private String estado;
    private String cdc;
    private String motivo;

    // Getters y Setters
    public Long getIdFactura() { return idFactura; }
    public void setIdFactura(Long idFactura) { this.idFactura = idFactura; }

    public String getNroComprobante() { return nroComprobante; }
    public void setNroComprobante(String nroComprobante) { this.nroComprobante = nroComprobante; }

    public String getEstado() { return estado; }
    public void setEstado(String estado) { this.estado = estado; }

    public String getCdc() { return cdc; }
    public void setCdc(String cdc) { this.cdc = cdc; }

    public String getMotivo() { return motivo; }
    public void setMotivo(String motivo) { this.motivo = motivo; }
}