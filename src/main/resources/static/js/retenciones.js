// =============================================
// CONFIGURACION
// =============================================
var URL_API = "http://127.0.0.1:8080";
var MONTO_MINIMO = 1218000;
var seleccionados = [];
var pestanaActual = "todas";
var facturas = [];
var retencionesDB = [];
var vistaActual = "facturas";
var pestanaDashActual = "todas";
var seleccionadosDash = [];

// =============================================
// USUARIOS
// =============================================
var USUARIOS = {
  "admin":    "dutriec2026",
  "vgimenez": "sifen2026",
  "operador": "ret2026"
};

// =============================================
// LOGIN
// =============================================
function doLogin() {
  var usuario = document.getElementById("login-usuario").value.trim().toLowerCase();
  var clave   = document.getElementById("login-clave").value;
  if (!usuario || !clave) { mostrarErrorLogin("Ingresa usuario y contrasena."); return; }
  if (!USUARIOS[usuario] || USUARIOS[usuario] !== clave) {
    mostrarErrorLogin("Usuario o contrasena incorrectos.");
    document.getElementById("login-clave").value = "";
    document.getElementById("login-clave").focus();
    return;
  }
  document.getElementById("login-error").style.display = "none";
  sessionStorage.setItem("usr_retencion", usuario);
  ingresarAlSistema(usuario);
}

function mostrarErrorLogin(texto) {
  var errEl = document.getElementById("login-error");
  errEl.textContent = texto;
  errEl.style.display = "block";
  var card = document.querySelector(".login-card");
  card.style.border = "1px solid #a32d2d";
  setTimeout(function() { card.style.border = ""; }, 1500);
}

function ingresarAlSistema(usuario) {
  document.getElementById("pantalla-login").style.display = "none";
  document.getElementById("pantalla-principal").style.display = "block";
  document.getElementById("label-usuario").textContent = usuario;
  var logSeccion = document.querySelector(".log-seccion");
  if (logSeccion) logSeccion.style.display = "none";
  cargarFacturas();
}

function doLogout() {
  sessionStorage.removeItem("usr_retencion");
  document.getElementById("pantalla-principal").style.display = "none";
  document.getElementById("pantalla-login").style.display = "flex";
  document.getElementById("login-usuario").value = "";
  document.getElementById("login-clave").value = "";
  document.getElementById("login-error").style.display = "none";
  document.querySelector(".login-card").style.border = "";
  facturas = [];
  retencionesDB = [];
}

// =============================================
// INICIALIZACION
// =============================================
document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("login-clave").addEventListener("keydown", function(e) {
    if (e.key === "Enter") doLogin();
  });
  document.getElementById("login-usuario").addEventListener("keydown", function(e) {
    if (e.key === "Enter") document.getElementById("login-clave").focus();
  });
  document.getElementById("btn-enviar").addEventListener("click", enviarAlSifen);
  var usr = sessionStorage.getItem("usr_retencion");
  if (usr && USUARIOS[usr]) { setTimeout(function() { ingresarAlSistema(usr); }, 2000); }
});

// =============================================
// CAMBIO DE VISTA
// =============================================
function cambiarVista(vista, elemento) {
  vistaActual = vista;
  var botones = document.querySelectorAll(".pestana-main");
  for (var i = 0; i < botones.length; i++) botones[i].classList.remove("activa");
  elemento.classList.add("activa");
  document.getElementById("vista-facturas").style.display  = (vista === "facturas")  ? "block" : "none";
  document.getElementById("vista-dashboard").style.display = (vista === "dashboard") ? "block" : "none";
  var logSeccion = document.querySelector(".log-seccion");
  if (logSeccion) logSeccion.style.display = (vista === "dashboard") ? "block" : "none";
  if (vista === "dashboard") cargarDashboard();
}

// =============================================
// CARGA FACTURAS DESDE SQL ANYWHERE
// =============================================
function cargarFacturas() {
  document.getElementById("cuerpo-tabla").innerHTML =
    "<tr><td colspan='10' style='text-align:center;padding:2.5rem'>" +
    "<div class='spinner-carga'></div>" +
    "<div style='margin-top:10px;color:#aaa;font-size:13px'>Cargando facturas...</div>" +
    "</td></tr>";
  fetch(URL_API + "/retenciones/pendientes")
    .then(function(r) { if (!r.ok) throw new Error("Error al conectar con la API"); return r.json(); })
    .then(function(datos) {
      var totalesPorCompra = {};
      datos.forEach(function(f) {
        if (f.compra) {
          var monto = (f.montoGravado || 0) + (f.montoGravado5 || 0) + (f.montoExento || 0);
          var tc = f.factorCambio || 1;
          var montoGS = (f.moneda === "DL" || f.moneda === "USD") ? monto * tc : monto;
          totalesPorCompra[f.compra] = (totalesPorCompra[f.compra] || 0) + montoGS;
        }
      });
      facturas = datos.map(function(f) {
        var esUSD = (f.moneda === "DL" || f.moneda === "USD");
        var tc = f.factorCambio || 1;
        var retUSD = 0, retGS = 0;
        if (esUSD) {
          retUSD = Math.round(((f.montoImpuesto || 0) * 0.30 + (f.montoImpuesto5 || 0) * 0.30) * 100) / 100;
          retGS  = Math.round(retUSD * tc);
        } else {
          retGS = Math.round((f.montoImpuesto || 0) * 0.30 + (f.montoImpuesto5 || 0) * 0.30);
        }
        var totalCompra = f.compra ? (totalesPorCompra[f.compra] || 0) : 0;
        var aplicaRetencion = totalCompra >= MONTO_MINIMO;
        return {
          id: f.factura, nro: f.facturaFisica || "—",
          proveedor: f.razonSocial || "Sin nombre", ruc: f.ruc || "",
          compra: f.compra || null, moneda: f.moneda || "GS", tipoCambio: tc,
          monto: (f.montoGravado || 0) + (f.montoGravado5 || 0) + (f.montoExento || 0),
          tasa: calcularTasa(f), retGS: retGS, retUSD: retUSD, esUSD: esUSD,
          timbrado: f.timbrado || "", fecha: f.fecha || "",
          totalCompra: totalCompra, aplicaRetencion: aplicaRetencion,
          estado: "PENDIENTE", motivo: ""
        };
      });
      renderTabla();
    })
    .catch(function(error) {
      if (facturas.length > 0) {
        mostrarMensaje("Error al cargar facturas: " + error.message, "error");
        document.getElementById("cuerpo-tabla").innerHTML =
          "<tr><td colspan='9' style='text-align:center;padding:2rem;color:#a32d2d'>No se pudo conectar con la API.</td></tr>";
      } else {
        document.getElementById("cuerpo-tabla").innerHTML =
          "<tr><td colspan='9' style='text-align:center;padding:2rem;color:#aaa'>" +
          "<div class='spinner-carga'></div>" +
          "<div style='margin-top:10px;font-size:13px'>Conectando...</div>" +
          "</td></tr>";
        setTimeout(function() { cargarFacturas(); }, 3000);
      }
    });
}

// =============================================
// CARGA DASHBOARD DESDE MARIADB
// =============================================
function cargarDashboard() {
  document.getElementById("cuerpo-dashboard").innerHTML =
    "<tr><td colspan='11' style='text-align:center;padding:2.5rem'>" +
    "<div class='spinner-carga'></div>" +
    "<div style='margin-top:10px;color:#aaa;font-size:13px'>Cargando datos...</div>" +
    "</td></tr>";
  fetch(URL_API + "/retenciones/dashboard")
    .then(function(r) { if (!r.ok) throw new Error("Error al cargar dashboard"); return r.json(); })
    .then(function(data) {
      document.getElementById("dash-enviadas").textContent   = data.resumen.enviadas   || 0;
      document.getElementById("dash-pendientes").textContent = data.resumen.pendientes || 0;
      document.getElementById("dash-errores").textContent    = data.resumen.errores    || 0;
      //TODO. quitar: no hace falta
      //- document.getElementById("dash-fisicas").textContent    = data.resumen.fisicas    || 0;
      //- document.getElementById("dash-monto").textContent      = "Gs. " + formatearNumero(data.resumen.montoTotal || 0);
      retencionesDB = data.retenciones || [];
      //AQUI
      renderDashboard();
      renderLog(data.logs || []);
    })
    .catch(function(error) {
      document.getElementById("cuerpo-dashboard").innerHTML =
        "<tr><td colspan='10' style='text-align:center;padding:2rem;color:#a32d2d'>No se pudo cargar el dashboard: " + error.message + "</td></tr>";
    });
}

function filtrarDashboard() { renderDashboard(); }

function cambiarPestanaDash(nombre, elemento) {
  pestanaDashActual = nombre;
  seleccionadosDash = [];
  actualizarInfoSelDash();
  var pestanas = document.querySelectorAll("#vista-dashboard .pestana");
  for (var i = 0; i < pestanas.length; i++) pestanas[i].classList.remove("activa");
  elemento.classList.add("activa");
  renderDashboard();
}

function toggleSeleccionDash(id, checkbox) {
  if (checkbox.checked) { seleccionadosDash.push(id); }
  else { seleccionadosDash = seleccionadosDash.filter(function(x) { return x !== id; }); }
  actualizarInfoSelDash();
}

function toggleTodosDash(checkbox) {
  seleccionadosDash = [];
  var checks = document.querySelectorAll(".dash-check-item");
  for (var i = 0; i < checks.length; i++) {
    checks[i].checked = checkbox.checked;
    if (checkbox.checked) seleccionadosDash.push(checks[i].dataset.id);
  }
  actualizarInfoSelDash();
}

function limpiarSeleccionDash() {
  seleccionadosDash = [];
  var checks = document.querySelectorAll(".dash-check-item");
  for (var i = 0; i < checks.length; i++) checks[i].checked = false;
  var checkAll = document.getElementById("dash-check-all");
  if (checkAll) checkAll.checked = false;
  actualizarInfoSelDash();
}

function actualizarInfoSelDash() {
  var n = seleccionadosDash.length;
  var el = document.getElementById("dash-info-sel");
  if (el) el.textContent = n + " factura" + (n !== 1 ? "s" : "") + " seleccionada" + (n !== 1 ? "s" : "");
  
  // Habilitar/Deshabilitar el botón "Descargar TXT" dinámicamente
  var btnDescargar = document.getElementById("btn-descargar-txt");
  if (btnDescargar) {
    btnDescargar.disabled = (n === 0);
  }

  var btn = document.getElementById("btn-generar-tesaka");
  if (btn) btn.style.display = n > 0 ? "inline-block" : "none";
}

function generarTesaka() {
  if (seleccionadosDash.length === 0) { mostrarMensaje("Selecciona al menos una factura.", "error"); return; }
  var btn = document.getElementById("btn-generar-tesaka");
  btn.disabled = true; btn.textContent = "Generando...";

  fetch(URL_API + "/retenciones/generar-tesaka", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: seleccionadosDash.map(Number) })
  })
  .then(function(r) {
    if (!r.ok) throw new Error("Error al generar");
    return r.blob();
  })
  .then(function(blob) {
    // Descargar archivo automáticamente
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "tesaka_" + new Date().toISOString().substring(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    mostrarMensaje(seleccionadosDash.length + " factura/s generadas para TESAKA ✓", "ok");
    seleccionadosDash = [];
    actualizarInfoSelDash();
    cargarDashboard();
  })
  .catch(function(e) { mostrarMensaje("Error: " + e.message, "error"); })
  .finally(function() { btn.disabled = false; btn.textContent = "✓ Generar TESAKA"; });
}

// === MODIFICADO: renderDashboard() ===
function renderDashboard() {
  var buscar = document.getElementById("dash-filtro-ruc").value.toLowerCase();
  var tbody  = document.getElementById("cuerpo-dashboard");
  var filtrados = retencionesDB.filter(function(r) {
    var matchEstado = pestanaDashActual === "todas" || r.estadoSifen === pestanaDashActual;
    var matchBuscar = !buscar ||
      (r.rucProveedor && r.rucProveedor.toLowerCase().indexOf(buscar) !== -1) ||
      (r.numDocRet    && r.numDocRet.toLowerCase().indexOf(buscar)    !== -1) ||
      (r.razonSocial  && r.razonSocial.toLowerCase().indexOf(buscar)  !== -1);
    return matchEstado && matchBuscar;
  });
  if (!filtrados.length) {
    tbody.innerHTML = "<tr><td colspan='10' style='text-align:center;padding:2rem;color:#aaa'>Sin resultados</td></tr>";
    return;
  }

  var mostrarCheckbox = mostrarCheckboxesEnDash();
  // Actualizar header dinámicamente
  var headerCheckbox = document.querySelector("#vista-dashboard thead th:first-child");
  if (headerCheckbox) {
    headerCheckbox.style.display = mostrarCheckbox ? "" : "none";
  }

  var html = "";
  filtrados.forEach(function(r) {
    var esFE = r.cdcProveedor && r.cdcProveedor.trim() !== "";
    var tipoHtml = esFE
      ? "<span class='badge badge-procesado'>Electronica</span>"
      : "<span class='badge badge-sinauth'>Fisica</span>";

    // -- Bloque de Acciones Modificado --
    var accion = "<div style='display:flex;gap:4px;flex-wrap:wrap'>";
    
    // Botones para cada línea
    accion += "<button class='btn-reenviar' onclick='abrirRegistrarRespuesta(\"" + r.id + "\")' style='color:#2d7a0e;border-color:#b5e8b5;background:#f4fbf4'>Registrar Respuesta</button>";
    accion += "<button class='btn-reenviar' onclick='verDetallesLinea(\"" + r.id + "\")' style='color:#666;border-color:#ccc'>Ver Detalles</button>";
    
    if (r.estadoSifen === "ERROR") {
      accion = "<button class='btn-rechazo' onclick='verRechazo(\"" + r.numDocRet + "\")'>Ver rechazo</button>";
               //+ "<button class='btn-reenviar' onclick='reenviarRetencion(\"" + r.id + "\")' style='margin-left:4px'>Reenviar</button>";
    } else if (r.estadoSifen === "ENVIADO" && r.respuestaSifen) {
      accion = "<button class='btn-reenviar' onclick='verRespuesta(\"" + r.numDocRet + "\")' style='color:#0c447c;border-color:#b5d4f4'>Ver XML</button>";
    }
    var checked = seleccionadosDash.indexOf(String(r.id)) !== -1 ? "checked" : "";

    html += "<tr>";
    
    if (mostrarCheckbox) {
      html += "<td><input type='checkbox' class='dash-check-item' data-id='" + r.id + "' " + 
              checked + " onchange='toggleSeleccionDash(this.dataset.id, this)'></td>";
    }

    var esUSD = (r.moneda === "DL" || r.moneda === "USD");
    var simbolo = esUSD ? "USD " : "Gs. ";
    var formatMonto = esUSD ? formatearUSD : formatearNumero;

    html +=
      "<td style='font-family:monospace;font-size:11px'>" + (r.numDocRet || "—") + "</td>" +
      "<td style='font-size:11px'>" + (r.rucProveedor || "—") + "</td>" +
      "<td><strong style='font-size:12px'>" + (r.razonSocial || "—") + "</strong></td>" +
      "<td style='font-family:monospace;font-size:11px'>" + (r.timbradoProveedor || r.numTimbrado || "—") + "</td>" +
      "<td style='font-family:monospace;font-size:11px'>" + (r.nroFactura || "—") + "</td>" +
      "<td class='der'>" + simbolo + formatMonto(r.baseImponible) + "</td>" +
      "<td class='der'><strong>" + simbolo + formatMonto(r.montoRetencion) + "</strong></td>" +
      "<td>" + tipoHtml + "</td>" +
      "<td>" + badgeDashboard(r.estadoSifen) + "</td>" +
      "<td style='font-size:11px'>" + formatearFecha(r.fechaEnvio) + "</td>" +
      "<td style='font-size:11px;color:#a32d2d'>" + (r.correoProveedor || "—") + "</td>" +
      "<td style='font-size:11px;color:#a32d2d'>" + (r.telefonoProveedor || "—") + "</td>" +
      "<td style='font-size:11px;color:#a32d2d'>" + (r.direccionProveedor || "—") + "</td>" +
      "<td>" + accion + "</td>" +
      "</tr>";
  });
  tbody.innerHTML = html;
}

function badgeDashboard(estado) {
  var map    = { "ENVIADO":"badge-procesado", "PENDIENTE":"badge-pendiente", "ERROR":"badge-rechazado", "FISICA_MANUAL":"badge-sinauth", "SIMULADO":"badge-anulado", "APROBADO":"badge-procesado" };
  var labels = { "ENVIADO":"Enviado", "PENDIENTE":"Pendiente de envio", "ERROR":"Error", "FISICA_MANUAL":"Fisica manual", "SIMULADO":"Simulado", "APROBADO":"Aprobado" };
  return "<span class='badge " + (map[estado] || "") + "'>" + (labels[estado] || estado) + "</span>";
}

function renderLog(logs) {
  var cont = document.getElementById("log-contenedor");
  if (!cont) return;
  if (!logs.length) {
    cont.innerHTML = "<div style='padding:16px;color:#aaa;font-size:12px;text-align:center'>Sin registros</div>";
    return;
  }
  var html = "<table style='width:100%;border-collapse:collapse;font-size:12px'>" +
    "<thead><tr style='background:#f9f9f9;border-bottom:1px solid #ddd'>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em;width:32px'></th>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em'>Comprobante</th>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em'>Proveedor</th>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em'>Detalle</th>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em'>Estado</th>" +
    "<th style='padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em'>Fecha</th>" +
    "</tr></thead><tbody>";

  logs.forEach(function(l) {
    var exitoso = l.exitoso == 1 || l.exitoso === true;
    var color = exitoso ? "#2d7a0e" : "#a32d2d";
    var icono = exitoso ? "✓" : "✗";
    var bgIcono = exitoso ? "#e8f5e0" : "#fce8e8";

    // Extraer comprobante y proveedor del campo accion "Retencion XXX — PROVEEDOR"
    var accion = l.accion || "";
    var partes = accion.replace("Retencion ", "").split(" — ");
    var comprobante = partes[0] || "—";
    var proveedor   = partes[1] || "—";

    // Badge de estado según detalle
    var detalle = l.detalle || "";
    var estadoBadge = "";
    if (detalle.indexOf("Aprobado") !== -1)       estadoBadge = "<span class='badge badge-procesado'>Aprobado</span>";
    else if (detalle.indexOf("Enviado") !== -1)    estadoBadge = "<span class='badge badge-procesado'>Enviado</span>";
    else if (detalle.indexOf("Error") !== -1 || detalle.indexOf("dCodRes") !== -1) estadoBadge = "<span class='badge badge-rechazado'>Error</span>";
    else if (detalle.indexOf("fisica") !== -1 || detalle.indexOf("Fisica") !== -1) estadoBadge = "<span class='badge badge-sinauth'>Fisica</span>";
    else if (detalle.indexOf("Pendiente") !== -1)  estadoBadge = "<span class='badge badge-pendiente'>Pendiente de envio</span>";
    else estadoBadge = "<span class='badge badge-anulado'>" + detalle.substring(0, 12) + "</span>";

    var fecha = formatearFecha(l.fecha);

    html += "<tr style='border-bottom:1px solid #eee'>" +
      "<td style='padding:8px 10px'><span style='display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:" + bgIcono + ";color:" + color + ";font-size:12px;font-weight:bold'>" + icono + "</span></td>" +
      "<td style='padding:8px 10px;font-family:monospace;font-size:11px;color:#333'>" + comprobante + "</td>" +
      "<td style='padding:8px 10px;font-size:12px;font-weight:bold;color:#333'>" + proveedor + "</td>" +
      "<td style='padding:8px 10px;font-size:11px;color:#666;max-width:300px'>" + detalle + "</td>" +
      "<td style='padding:8px 10px'>" + estadoBadge + "</td>" +
      "<td style='padding:8px 10px;font-size:11px;color:#888;white-space:nowrap'>" + fecha + "</td>" +
      "</tr>";
  });

  html += "</tbody></table>";
  cont.innerHTML = html;
}

function reenviarRetencion(id) {
  if (!confirm("Reenviar esta retencion?")) return;
  fetch(URL_API + "/retenciones/reenviar/" + id, { method: "POST" })
    .then(function(r) { return r.json(); })
    .then(function() { mostrarMensaje("Retencion reenviada", "ok"); cargarDashboard(); })
    .catch(function() { mostrarMensaje("Error al reenviar", "error"); });
}

// =============================================
// VER RECHAZO — modal
// =============================================
function verRechazo(numDocRet) {
  var r = retencionesDB.find(function(x) { return x.numDocRet === numDocRet; });
  if (!r) return;
  var motivo = r.respuestaSifen || "Sin descripcion";
  var codRes = "—";
  var mCod = motivo.match(/dCodRes[:\s]+(\d+)/);
  if (mCod) codRes = mCod[1];
  document.getElementById("rec-numdoc").textContent    = numDocRet;
  document.getElementById("rec-proveedor").textContent = r.razonSocial || "—";
  document.getElementById("rec-ruc").textContent       = r.rucProveedor || "—";
  document.getElementById("rec-factura").textContent   = r.nroFactura || "—";
  document.getElementById("rec-codres").textContent    = codRes;
  document.getElementById("rec-estres").textContent    = "Rechazado";
  document.getElementById("rec-msgres").textContent    = motivo;
  document.getElementById("rec-fecha").textContent     = r.fechaEnvio ? String(r.fechaEnvio).substring(0, 16).replace("T", " ") : "—";
  document.getElementById("overlay-rechazo").dataset.id = r.id;
  document.getElementById("overlay-rechazo").style.display = "flex";
}

function cerrarRechazo() {
  document.getElementById("overlay-rechazo").style.display = "none";
}

function reenviarDesdeModal() {
  var id = document.getElementById("overlay-rechazo").dataset.id;
  cerrarRechazo();
  reenviarRetencion(id);
}

function verRespuesta(numDocRet) {
  var r = retencionesDB.find(function(x) { return x.numDocRet === numDocRet; });
  if (!r || !r.respuestaSifen) return;
  document.getElementById("detalle-nro").textContent       = numDocRet;
  document.getElementById("detalle-proveedor").textContent = r.razonSocial || r.rucProveedor;
  document.getElementById("detalle-motivo").innerHTML =
    "<pre style='font-size:11px;white-space:pre-wrap;color:#0c447c'>" +
    "Se puede mostrar aquí los comentarios que se guardaron en el botón de arriba" + "</pre>";
  /*TODO. aqui se puede colocar los comentarios grabados en la respuesta
    "<pre style='font-size:11px;white-space:pre-wrap;color:#0c447c'>" +
    String(r.respuestaSifen).replace(/</g, "&lt;") + "</pre>";
  */
  document.getElementById("overlay-detalle").style.display = "flex";
}

// =============================================
// CALCULOS
// =============================================
function calcularTasa(f) {
  if (f.montoGravado > 0) return "10";
  if (f.montoGravado5 > 0) return "5";
  return "exenta";
}

function formatearFecha(fecha) {
  if (!fecha) return "—";
  var s = String(fecha);
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}:\d{2})?/);
  if (!m) return s;
  var fechaStr = m[3] + "/" + m[2] + "/" + m[1];
  return m[4] ? (fechaStr + " " + m[4]) : fechaStr;
}

function formatearNumero(n) { return Math.round(n || 0).toLocaleString("es-PY"); }
function formatearUSD(n) { return (n || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// =============================================
// APROBAR Y ENVIAR
// =============================================
function aprobarYEnviar() {
  if (seleccionados.length === 0) { mostrarMensaje("Selecciona al menos una factura.", "error"); return; }
  var sinMinimo = seleccionados.filter(function(id) {
    var f = facturas.find(function(x) { return x.id === id; });
    return f && !f.aplicaRetencion;
  });
  if (sinMinimo.length > 0) { mostrarMensaje(sinMinimo.length + " factura/s no alcanzan el minimo", "error"); return; }

  var cant = seleccionados.length;
  var btn = document.getElementById("btn-aprobar");
  btn.disabled = true; btn.textContent = "Enviando...";

  // FIX: llamar al backend para guardar en MariaDB.
  // Antes solo se simulaba con setTimeout sin hacer ninguna llamada real,
  // por eso las facturas nunca aparecían en "Control de envíos".
  fetch(URL_API + "/retenciones/enviar-lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seleccionados.map(Number))
  })
  .then(function(r) {
    if (!r.ok) throw new Error("Error al enviar al servidor");
    return r.json();
  })
  .then(function(resultados) {
    var exitosos = resultados.filter(function(r) { return r.estado !== "ERROR"; });
    var errores = resultados.filter(function(r) { return r.estado === "ERROR"; });

    // Actualizar estado local de las facturas exitosas
    exitosos.forEach(function(res) {
      var f = facturas.find(function(x) { return x.id === res.idFactura; });
      if (f) f.estado = "PROCESADO";
    });

    seleccionados = [];
    renderTabla();
    actualizarStats();

    if (errores.length > 0) {
      console.warn("Facturas con error:", errores);
      mostrarMensaje(exitosos.length + " enviada/s, " + errores.length + " con error: " + errores[0].motivo, "error");
    } else {
      mostrarMensaje(cant + " retención/es aprobadas y guardadas ✓", "ok");
    }
  })
  .catch(function(e) {
    mostrarMensaje("Error: " + e.message, "error");
  })
  .finally(function() {
    btn.disabled = false; btn.textContent = "✓ Aprobar Facturas";
  });
}

function enviarAlSifen() {
  if (seleccionados.length === 0) { mostrarMensaje("Selecciona al menos una factura.", "error"); return; }
  var cant = seleccionados.length;
  var btn = document.getElementById("btn-enviar");
  btn.disabled = true; btn.textContent = "Enviando...";

  fetch(URL_API + "/retenciones/enviar-lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seleccionados.map(Number))
  })
  .then(function(r) {
    if (!r.ok) throw new Error("Error al enviar al servidor");
    return r.json();
  })
  .then(function(resultados) {
    var exitosos = resultados.filter(function(r) { return r.estado !== "ERROR"; });
    var errores = resultados.filter(function(r) { return r.estado === "ERROR"; });

    exitosos.forEach(function(res) {
      var f = facturas.find(function(x) { return x.id === res.idFactura; });
      if (f) f.estado = "PROCESADO";
    });

    seleccionados = [];
    renderTabla();
    actualizarStats();

    if (errores.length > 0) {
      mostrarMensaje(exitosos.length + " enviada/s, " + errores.length + " con error: " + errores[0].motivo, "error");
    } else {
      mostrarMensaje(cant + " retención/es enviadas ✓", "ok");
    }
  })
  .catch(function(e) { mostrarMensaje("Error: " + e.message, "error"); })
  .finally(function() { btn.disabled = false; btn.textContent = "▶ Enviar al SIFEN"; });
}

function reenviar(id) {
  var f = facturas.find(function(x) { return x.id === id; });
  if (f) { f.estado = "PROCESADO"; f.motivo = ""; }
  mostrarMensaje("Retencion reenviada", "ok");
  renderTabla();
}

// =============================================
// DETALLE MODAL FACTURAS
// =============================================
function verDetalle(id) {
  var f = facturas.find(function(x) { return x.id === id; });
  if (!f) return;
  document.getElementById("detalle-nro").textContent       = f.nro;
  document.getElementById("detalle-proveedor").textContent = f.proveedor;
  document.getElementById("detalle-motivo").textContent    = f.motivo || "Sin descripcion";
  document.getElementById("overlay-detalle").style.display = "flex";
}

function cerrarDetalle() {
  document.getElementById("overlay-detalle").style.display = "none";
}

// =============================================
// RENDER TABLA FACTURAS
// =============================================
function obtenerMesFactura(fecha) {
  if (!fecha) return "";
  var s = String(fecha);
  var m = s.match(/^\d{4}-(\d{2})-\d{2}/);
  if (m) return m[1];
  m = s.match(/^\d{1,2}\/(\d{1,2})\/\d{4}/);
  if (m) return ("0" + m[1]).slice(-2);
  return "";
}

function renderTabla() {
  var buscar = document.getElementById("filtro-buscar").value.toLowerCase();
  var mesFiltro = document.getElementById("filtro-mes").value;
  var tbody = document.getElementById("cuerpo-tabla");
  var html = "", encontrados = 0;
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    if (pestanaActual !== "todas" && f.estado !== pestanaActual) continue;
    if (buscar !== "" && f.proveedor.toLowerCase().indexOf(buscar) === -1 && f.ruc.indexOf(buscar) === -1) continue;
    if (mesFiltro !== "" && obtenerMesFactura(f.fecha) !== mesFiltro) continue;
    encontrados++;
    var puedeSel = (f.estado === "PENDIENTE" || f.estado === "PENDIENTE_AUTH") && f.aplicaRetencion;
    var checked  = seleccionados.indexOf(f.id) !== -1 ? "checked" : "";
    var disabled = !puedeSel ? "disabled" : "";
    var montoHtml = f.esUSD
      ? "USD " + formatearUSD(f.monto) + "<div style='font-size:10px;color:#888'>TC: " + formatearNumero(f.tipoCambio) + "</div>"
      : "Gs. " + formatearNumero(f.monto);
    var retHtml = f.esUSD
      ? "USD " + formatearUSD(f.retUSD) + "<div style='font-size:10px;color:#888'>Gs. " + formatearNumero(f.retGS) + "</div>"
      : "Gs. " + formatearNumero(f.retGS);
    var minimoHtml = "";
    if (f.compra) {
      var color = f.aplicaRetencion ? "#2d7a0e" : "#a32d2d";
      var titulo = f.aplicaRetencion
        ? "Total Orden de Pago: Gs. " + formatearNumero(f.totalCompra) + " Supera el minimo"
        : "Total Orden de Pago: Gs. " + formatearNumero(f.totalCompra) + " No alcanza el minimo";
      minimoHtml = "<span style='display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:" + color + ";color:white;font-size:10px;font-weight:bold;cursor:help;flex-shrink:0' title='" + titulo + "'>i</span>";
    }
    var btnAccion = "";
    if (f.estado === "RECHAZADO") {
      btnAccion = "<button class='btn-reenviar' onclick='reenviar(" + f.id + ")' style='margin-bottom:4px;display:block'>Reenviar</button>" +
        "<button class='btn-reenviar' onclick='verDetalle(" + f.id + ")' style='color:#633806;border-color:#FAC775'>Ver detalle</button>";
    }
    var fechaEmision = new Date().toLocaleDateString("es-PY");
    html += "<tr>" +
      "<td><input type='checkbox' " + checked + " " + disabled + " onchange='toggleSeleccion(" + f.id + ", this)'></td>" +
      "<td style='font-family:monospace;font-size:11px'>" + f.nro + "</td>" +
      "<td><strong>" + f.proveedor + "</strong><div style='font-size:10px;color:#888'>" + f.ruc + "</div></td>" +
      "<td style='font-family:monospace;font-size:11px'>" + (f.compra || "—") + "</td>" +
      "<td>" + f.moneda + "</td>" +
      "<td class='der'>" + montoHtml + "</td>" +
      "<td class='der'><div style='display:flex;align-items:center;justify-content:flex-end;gap:4px'><strong>" + retHtml + "</strong>" + minimoHtml + "</div></td>" +
      "<td style='font-size:11px'>" + fechaEmision + "</td>" +
      "<td>" + generarBadge(f.estado) + "</td>" +
      "<td>" + btnAccion + "</td>" +
      "</tr>";
  }
  if (encontrados === 0) html = "<tr><td colspan='10' style='text-align:center;padding:2rem;color:#aaa'>No hay facturas en este estado</td></tr>";
  tbody.innerHTML = html;
  actualizarStats();
  actualizarInfoSeleccion();
}

function generarBadge(estado) {
  if (estado === "PENDIENTE_AUTH") return "<span class='badge badge-sinauth'>Sin autorizacion</span>";
  if (estado === "PENDIENTE")      return "<span class='badge badge-pendiente'>Pendiente de envio</span>";
  if (estado === "PROCESADO")      return "<span class='badge badge-procesado'>Procesado</span>";
  if (estado === "RECHAZADO")      return "<span class='badge badge-rechazado'>Rechazado</span>";
  if (estado === "ANULADO")        return "<span class='badge badge-anulado'>Anulado</span>";
  return estado;
}

function actualizarStats() {
  var sinauth = 0, pendiente = 0, procesado = 0, rechazado = 0;
  for (var i = 0; i < facturas.length; i++) {
    if (facturas[i].estado === "PENDIENTE_AUTH") sinauth++;
    if (facturas[i].estado === "PENDIENTE")      pendiente++;
    if (facturas[i].estado === "PROCESADO")      procesado++;
    if (facturas[i].estado === "RECHAZADO")      rechazado++;
  }
  var elTotal = document.getElementById("stat-total");
  var elPendiente = document.getElementById("stat-pendiente");
  if (elTotal) elTotal.textContent = facturas.length;
  if (elPendiente) elPendiente.textContent = pendiente;
}

function toggleSeleccion(id, checkbox) {
  if (checkbox.checked) { seleccionados.push(id); }
  else { seleccionados = seleccionados.filter(function(x) { return x !== id; }); }
  actualizarInfoSeleccion();
}
function seleccionarTodas() {
  seleccionados = [];
  var buscar = document.getElementById("filtro-buscar").value.toLowerCase();
  var mesFiltro = document.getElementById("filtro-mes").value;
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    // Respetar filtros activos
    if (pestanaActual !== "todas" && f.estado !== pestanaActual) continue;
    if (buscar !== "" && f.proveedor.toLowerCase().indexOf(buscar) === -1 && f.ruc.indexOf(buscar) === -1) continue;
    if (mesFiltro !== "" && obtenerMesFactura(f.fecha) !== mesFiltro) continue;
    // Seleccionar todas las pendientes visibles
    if (f.estado === "PENDIENTE" || f.estado === "PENDIENTE_AUTH") {
      seleccionados.push(f.id);
    }
  }
  renderTabla();
}
function limpiarSeleccion() { seleccionados = []; renderTabla(); }
function actualizarInfoSeleccion() {
  var n = seleccionados.length;
  document.getElementById("info-seleccion").textContent =
    n + " factura" + (n !== 1 ? "s" : "") + " seleccionada" + (n !== 1 ? "s" : "");
}
function cambiarPestana(nombre, elemento) {
  pestanaActual = nombre; seleccionados = [];
  var pestanas = document.querySelectorAll(".pestana");
  for (var i = 0; i < pestanas.length; i++) pestanas[i].classList.remove("activa");
  elemento.classList.add("activa");
  renderTabla();
}
function mostrarMensaje(texto, tipo) {
  var el = document.getElementById("mensaje");
  el.textContent = texto;
  el.className = "mensaje " + tipo;
  setTimeout(function() { el.className = "mensaje oculto"; }, 4000);
}

/**
 * Devuelve fecha y hora local en formato: AAAA-MM-DD HH:MM:SS
 * (formato exigido por Tesaka — antes generaba DD-MM-AAAA y era rechazado)
 */
function getFechaHoraLocal() {
    const ahora = new Date();

    const dia = String(ahora.getDate()).padStart(2, '0');
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const anio = ahora.getFullYear();

    const horas = String(ahora.getHours()).padStart(2, '0');
    const minutos = String(ahora.getMinutes()).padStart(2, '0');
    const segundos = String(ahora.getSeconds()).padStart(2, '0');

    return `${anio}-${mes}-${dia} ${horas}:${minutos}:${segundos}`;
}

/**
 * Fecha local AAAA-MM-DD. Reemplaza a toISOString().split('T')[0],
 * que usa UTC y en Paraguay (UTC-3/-4) desplaza la fecha de noche.
 */
function getFechaLocal() {
    const ahora = new Date();
    const dia = String(ahora.getDate()).padStart(2, '0');
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Formatea el número de comprobante a XXX-XXX-XXXXXXX (formato exigido por Tesaka).
 * Acepta "0010020012152", "001-002-0012152", "1-2-12152", etc.
 */
function formatearComprobante(numero) {
  if (!numero) return "";
  var s = String(numero).trim();

  // Ya viene con guiones: normalizar padding de cada grupo
  var partes = s.split("-");
  if (partes.length === 3) {
    return partes[0].padStart(3, "0") + "-" +
           partes[1].padStart(3, "0") + "-" +
           partes[2].padStart(7, "0");
  }

  // Solo dígitos: 3 (establecimiento) + 3 (punto exp.) + resto (hasta 7)
  var limpio = s.replace(/\D/g, "");
  if (limpio.length >= 7 && limpio.length <= 13) {
    return limpio.slice(0, 3) + "-" + limpio.slice(3, 6) + "-" +
           limpio.slice(6).padStart(7, "0");
  }
  return s; // formato no reconocido: la validación lo reportará
}

/** Conceptos de renta válidos según la situación del informado (Ley 6380/2019) */
var CONCEPTOS_RENTA = {
  "CONTRIBUYENTE":    "RENTA_EMPRESARIAL_REGISTRADO.1",
  "NO_CONTRIBUYENTE": "RENTA_EMPRESARIAL.1",
  "NO_RESIDENTE":     "RENTA_NO_RESIDENTE.10"
};

/**
 * Calcula el dígito verificador de un RUC paraguayo (algoritmo módulo 11 de la SET).
 * Ej: calcularDvRuc("80009651") → "7"
 * Se usa cuando el RUC viene de la base sin el DV (antes se defaulteaba a "0"
 * y Tesaka lo rechazaba con "El Dígito Verificador del informado no es correcto").
 */
function calcularDvRuc(ruc) {
  var digitos = String(ruc).replace(/\D/g, "");
  if (!digitos) return "";
  var k = 2, total = 0;
  for (var i = digitos.length - 1; i >= 0; i--) {
    total += parseInt(digitos.charAt(i), 10) * k;
    k++;
    if (k > 11) k = 2;
  }
  var resto = total % 11;
  return String(resto > 1 ? 11 - resto : 0);
}

/**
 * Valida un objeto retención con las reglas del validador real de Tesaka.
 * Devuelve un array de errores (vacío = válido).
 */
function validarRetencionTesaka(o, etiqueta) {
  var errores = [];
  var pref = etiqueta + ": ";
  var t = o.transaccion, ret = o.retencion, inf = o.informado;

  if (!/^\d{3}-\d{3}-\d{1,7}$/.test(t.numeroComprobanteVenta)) {
    errores.push(pref + "N° de comprobante inválido \"" + t.numeroComprobanteVenta +
                 "\" (formato 999-999-9999999)");
  }

  if (inf.situacion === "CONTRIBUYENTE" && [1, 5, 11].indexOf(t.tipoComprobante) !== -1) {
    if (!/^\d{8}$/.test(t.numeroTimbrado)) {
      errores.push(pref + "Timbrado inválido \"" + t.numeroTimbrado +
                   "\" (debe tener 8 dígitos — cargar el timbrado del proveedor)");
    }
  }

  if (t.condicionCompra === "CREDITO" && (!t.cuotas || t.cuotas < 1)) {
    errores.push(pref + "cuotas debe ser mayor a 0 con condición CREDITO");
  }

  if (inf.situacion === "CONTRIBUYENTE" && inf.pais !== "") {
    errores.push(pref + "pais debe ir vacío para CONTRIBUYENTE");
  }

  if (ret.retencionRenta && inf.situacion === "CONTRIBUYENTE" &&
      ret.conceptoRenta.indexOf("COMERCIAL_INDUSTRIAL_SERVICIOS.") === 0) {
    errores.push(pref + "conceptoRenta inválido para CONTRIBUYENTE (usar RENTA_EMPRESARIAL_REGISTRADO.1)");
  }

  if (ret.moneda !== "PYG" && (!ret.tipoCambio || ret.tipoCambio <= 1)) {
    errores.push(pref + "tipoCambio sospechoso (" + ret.tipoCambio +
                 ") para moneda " + ret.moneda + " — cargar cotización real");
  }
  if (ret.moneda === "PYG" && typeof ret.tipoCambio !== "undefined") {
    errores.push(pref + "tipoCambio no debe enviarse cuando la moneda es PYG");
  }

  return errores;
}

//descarga txt cuyo contenido es un arreglo de json, cada elemento del arreglo es una factura a enviar a SIFEN por TESAKA
function descargarTxt() {
  // Usar seleccionados si hay, sino todos los visibles
  var datos;
  if (seleccionadosDash.length > 0) {
    datos = retencionesDB.filter(function(r) {
      return seleccionadosDash.indexOf(String(r.id)) !== -1;
    });
  } else {
    mostrarMensaje("Selecciona al menos una factura para descargar.", "error");
    return;
  }

  if (datos.length === 0) {
    mostrarMensaje("No hay datos para descargar.", "error");
    return;
  }

  var arregloJson = [];
  var erroresValidacion = [];  // filas rechazadas por la validación pre-Tesaka
  var idsExportados = [];      // solo estas pasan a estado ENVIADO

  // Recorremos los "IDs" seleccionados y buscamos su información en retencionesDB
  seleccionadosDash.forEach(function(id) {
    var r = retencionesDB.find(function(x) { return String(x.id) === String(id); });
    if (r) {
      
      // Separar el RUC del Dígito Verificador si viene con guión (ej: 80078258-5)
      var rucLimpio = null;
      var dvLimpio = null;
      
      if (r.rucProveedor) {
        var guionIndex = r.rucProveedor.indexOf("-");
        if (guionIndex !== -1) {
          rucLimpio = r.rucProveedor.substring(0, guionIndex).trim();
          dvLimpio = r.rucProveedor.substring(guionIndex + 1).trim();
        } else {
          rucLimpio = r.rucProveedor.trim();
          // FIX: antes se defaulteaba a "0" y Tesaka rechazaba el DV.
          // Se calcula con el algoritmo módulo 11 de la SET.
          dvLimpio = calcularDvRuc(rucLimpio);
        }
      }

      // Determinar la tasa del IVA que aplica al detalle de la retención
      var tasaDetalle = "10"; 
      if (r.ivaPorcentaje5 > 0) {
        tasaDetalle = "5";
      } else if (r.baseImponible === 0 || (!r.ivaPorcentaje10 && !r.ivaPorcentaje5)) {
        tasaDetalle = "0";
      }

      // Situación del informado (por ahora fijo; cuando manejen autofacturas
      // o pagos al exterior, traer este dato desde la BD)
      var situacion = r.situacion || "CONTRIBUYENTE";
      var esContribuyente = (situacion === "CONTRIBUYENTE");

      // Comprobante con guiones XXX-XXX-XXXXXXX (Tesaka rechaza sin guiones)
      var nroComprobante = formatearComprobante(r.nroFactura);

      // Condición y cuotas de la COMPRA original (no de la retención).
      // CREDITO exige cuotas > 0; si no se conoce la condición real, usar CONTADO.
      var condicion = r.condicionCompra === "CREDITO" ? "CREDITO" : "CONTADO";
      var cuotas = condicion === "CREDITO" ? (Number(r.cuotas) || 1) : 0;

      // Estructuramos el objeto respetando el formato de Importación de Tesaka
      var objetoRetencion = {
        "atributos": {
          "fechaCreacion": getFechaLocal(),
          "fechaHoraCreacion": getFechaHoraLocal() // YYYY-MM-DD HH:mm:ss
        },
        "informado": {
          "situacion": situacion,
          "ruc": esContribuyente ? rucLimpio : "",
          "dv": esContribuyente ? dvLimpio : "",
          // Para CONTRIBUYENTE estos campos van VACÍOS: Tesaka rechazó
          // pais="PY" y los datos dummy no aplican. Solo se llenan para
          // NO_CONTRIBUYENTE / NO_RESIDENTE.
          "tipoIdentificacion": esContribuyente ? "" : (r.tipoIdentificacion || "CEDULA"),
          "identificacion":     esContribuyente ? "" : (r.identificacion || ""),
          "nombre": r.razonSocial || "---",
          "domicilio": esContribuyente ? (r.domicilioProveedor || "Domicilio Fiscal") : "",
          "direccion":         esContribuyente ? "" : (r.direccionProveedor || ""),
          "correoElectronico": esContribuyente ? "" : (r.correoProveedor || ""),
          "telefono":          esContribuyente ? "" : (r.telefonoProveedor || ""),
          "pais": situacion === "NO_RESIDENTE" ? (r.pais || "") : "",
          "tieneRepresentante": false,
          "tieneBeneficiario": false
        },
        "transaccion": {
          "condicionCompra": condicion,
          "cuotas": cuotas,
          "tipoComprobante": 1, // 1 = Factura estándar
          "numeroComprobanteVenta": nroComprobante,
          "fecha": r.fechaEnvio ? String(r.fechaEnvio).substring(0, 10) : getFechaLocal(),
          // FIX: el campo correcto es timbradoProveedor (timbrado de la factura
          // del proveedor desde SQL Anywhere). numTimbrado era el timbrado de DUTRIEC
          // que venía como "PENDIENTE_TIMBRADO" y Tesaka rechazaba.
          "numeroTimbrado": String(r.timbradoProveedor || r.numTimbrado || r.timbrado || "")
        },
        "detalle": [
          {
            "cantidad": 1,
            "tasaAplica": tasaDetalle,
            "precioUnitario": Number(r.baseImponible) || 0,
            "descripcion": "Retención correspondiente a Comprobante de Venta Nro: " + (nroComprobante || "—")
          }
        ],
        "retencion": {
          "fecha": getFechaLocal(),
          "moneda": (r.moneda === "USD" || r.moneda === "DL") ? "USD" : "PYG",
          "retencionRenta": true,
          // Concepto según situación: para CONTRIBUYENTE Tesaka rechazó
          // COMERCIAL_INDUSTRIAL_SERVICIOS.1 (ese código es de no contribuyentes)
          "conceptoRenta": CONCEPTOS_RENTA[situacion],
          "retencionIva": true,
          "conceptoIva": "IVA.1",
          "rentaPorcentaje": 10, // TODO: confirmar % con el contador según designación DNIT
          "rentaCabezasBase": 0,
          "rentaCabezasCantidad": 0,
          "rentaToneladasBase": 0,
          "rentaToneladasCantidad": 0,
          "ivaPorcentaje5": r.ivaPorcentaje5 || 0,
          "ivaPorcentaje10": 30 // Valor por defecto para DUTRIEC en retenciones IVA (30%)
        }
      };

      // tipoCambio SOLO cuando la moneda no es PYG:
      // Tesaka rechaza el campo con guaraníes ("No debe especificar un tipo
      // de cambio para la moneda especificada")
      if (objetoRetencion.retencion.moneda !== "PYG") {
        objetoRetencion.retencion.tipoCambio = Math.round(r.tipoCambio || 1);
      }

      // Validar ANTES de agregar: las filas con errores no entran al archivo
      var etiqueta = (r.razonSocial || "Proveedor") + " (" + (r.nroFactura || "s/n") + ")";
      var erroresFila = validarRetencionTesaka(objetoRetencion, etiqueta);
      if (erroresFila.length > 0) {
        erroresValidacion = erroresValidacion.concat(erroresFila);
      } else {
        arregloJson.push(objetoRetencion);
        idsExportados.push(id);
      }
    }
  });

  // Si hubo filas inválidas, informar al usuario con el motivo exacto
  if (erroresValidacion.length > 0) {
    console.warn("Retenciones con errores (excluidas del archivo):");
    erroresValidacion.forEach(function(e) { console.warn("  " + e); });
    mostrarMensaje(erroresValidacion.length + " retención/es con errores (ver consola): " +
                   erroresValidacion[0], "error");
  }

  if (arregloJson.length === 0) {
    mostrarMensaje("Ninguna retención pasó la validación. Corregí los datos e intentá de nuevo.", "error");
    return;
  }

  // Convertimos el arreglo completo a una cadena JSON con indentación limpia de 2 espacios
  var contenidoTxt = JSON.stringify(arregloJson, null, 2);

  // Crear el Blob y forzar la descarga del archivo plano .txt conteniendo el JSON
  var blob = new Blob([contenidoTxt], { type: "text/plain;charset=utf-8;" });
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "retenciones_" + new Date().toISOString().substring(0, 10) + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
  mostrarMensaje("Archivo TXT descargado ✓ (" + arregloJson.length + " retención/es)", "ok");

  // Actualizar a ENVIADO SOLO las que realmente entraron al archivo
  // (antes se marcaban todas las seleccionadas, incluso las inválidas)
  actualizarEstadoEnviado(idsExportados);

  // Deseleccionar todas las filas, desactivar el botón y limpiar contadores
  limpiarSeleccionDash();
}

// Actualiza el estado a ENVIADO después de descargar el TXT
function actualizarEstadoEnviado(ids) {
  if (!ids || ids.length === 0) return;

  fetch(URL_API + "/retenciones/actualizar-estado", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      ids: ids.map(Number),
      estado: "ENVIADO"
    })
  })
  .then(function(r) {
    if (!r.ok) throw new Error("Error en actualización");
    return r.json();
  })
  .then(function() {
    mostrarMensaje("Estado actualizado a ENVIADO", "ok");
    // === REFRESCO AUTOMÁTICO Y CAMBIO DE PESTAÑA ===
    cargarDashboard();                    // recarga los datos
    setTimeout(() => {
      // Cambiar a la pestaña "Envios TESAKA"
      var pestanaTesaka = document.querySelector('#vista-dashboard .pestana[onclick*="ENVIADO"]');
      if (pestanaTesaka) {
        cambiarPestanaDash('ENVIADO', pestanaTesaka);
      } else {
        // fallback: recargar dashboard y forzar render
        renderDashboard();
      }
    }, 800);
    seleccionadosDash = [];
    actualizarInfoSelDash();
  })
  .catch(function(err) {
    console.error(err);
    mostrarMensaje("TXT descargado, pero no se pudo actualizar el estado", "error");
    cargarDashboard(); // igual recargamos
  });
}

function padR(str, len) {
  str = String(str || "");
  return str.length >= len ? str.substring(0, len) : str + " ".repeat(len - str.length);
}
function padL(str, len) {
  str = String(str || "");
  return str.length >= len ? str.substring(0, len) : " ".repeat(len - str.length) + str;
}

// Toggle dropdown Acciones
function toggleDropdown() {
  var menu = document.getElementById("dropdown-menu");
  if (menu) menu.style.display = menu.style.display === "none" ? "block" : "none";
}

// Cerrar dropdown al hacer click fuera
document.addEventListener("click", function(e) {
  var dropdown = document.querySelector(".dropdown-acciones");
  if (dropdown && !dropdown.contains(e.target)) {
    var menu = document.getElementById("dropdown-menu");
    if (menu) menu.style.display = "none";
  }
});

// Funciones pendientes de implementar
function guardarRespuesta() {
  mostrarMensaje("Funcionalidad pendiente de implementar.", "error");
}

function verDetalles() {
  mostrarMensaje("Funcionalidad pendiente de implementar.", "error");
}

// =============================================
// REGISTRAR RESPUESTA Y DETALLES
// =============================================

function abrirRegistrarRespuesta(id) {
  var r = retencionesDB.find(function(x) { return String(x.id) === String(id); });
  if (!r) return;

  document.getElementById("reg-id").value = r.id;
  document.getElementById("reg-numcomprobante").value = r.numDocRet || "";
  
  // Cargar valores ya guardados si existen
  document.getElementById("reg-estado").value = r.estadoSifen || "APROBADO";
  document.getElementById("reg-numcontrol").value = r.aprobacion_nro_control || "";
  document.getElementById("reg-comentario").value = r.aprobacion_comentario || "";

  document.getElementById("overlay-registrar-respuesta").style.display = "flex";
}

function cerrarRegistrarRespuesta() {
  document.getElementById("overlay-registrar-respuesta").style.display = "none";
}

function guardarRespuestaModal() {
  var numComprobante = document.getElementById("reg-numcomprobante").value.trim();
  var estado = document.getElementById("reg-estado").value;
  var numControl = document.getElementById("reg-numcontrol").value.trim();
  var comentario = document.getElementById("reg-comentario").value.trim();

  if (!numComprobante) {
    mostrarMensaje("El número de comprobante es obligatorio.", "error");
    return;
  }

  // Payload para armar el json exactamente como lo espera el backend (DashboardController)
  var payload = {
    nro_comprobante: numComprobante,
    estado: estado,
    aprobacion_nro_control: numControl,
    aprobacion_comentario: comentario
  };

  fetch(URL_API + "/retenciones/guardar-respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  .then(function(r) {
    if (!r.ok) {
      return r.json().then(function(err) {
        throw new Error(err.error || "Error del servidor");
      });
    }
    return r.json();
  })
  .then(function(data) {
    mostrarMensaje("Respuesta registrada exitosamente ✓", "ok");
    cerrarRegistrarRespuesta();
    cargarDashboard(); // Actualiza la tabla del dashboard
  })
  .catch(function(err) {
    console.error(err);
    mostrarMensaje("Error: " + err.message, "error");
  });
}

/*TODO. borrar, duplicado
function guardarRespuestaRetencion() {
  // 1. Capturar los valores del modal
  // NOTA: Asegúrate de guardar el nro_comprobante en un input o recuperarlo correctamente al abrir el modal
  var nroComprobante = document.getElementById("reg-nrocomprobante") ? document.getElementById("reg-nrocomprobante").value : 0;
  var estado = document.getElementById("reg-estado").value;
  var numControl = document.getElementById("reg-numcontrol").value.trim();
  var comentario = document.getElementById("reg-comentario").value.trim();

  if (!nroComprobante) {
    alert("Error: No se ha especificado el Número de Comprobante.");
    return;
  }

  // 2. Estructurar el payload JSON
  var datos = {
    nro_comprobante: nroComprobante,
    estado: estado,
    aprobacion_nro_control: numControl,
    aprobacion_comentario: comentario
  };

  // 3. Ejecutar la llamada utilizando la URL_API configurada (http://localhost:8080)
  fetch(URL_API + "/retenciones/guardar-respuesta", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(datos)
  })
  .then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) {
        throw new Error(data.error || "Error desconocido en el servidor");
      }
      return data;
    });
  })
  .then(function(data) {
    alert("Respuesta procesada: " + data.mensaje);
    cerrarRegistrarRespuesta(); // Cierra tu modal actual
    
    // Si tienes una función para recargar la grilla/dashboard, invócala aquí:
    if (typeof cargarRetenciones === "function") {
        cargarRetenciones();
    } else if (typeof getDashboard === "function") {
        // O la función que uses para refrescar los datos de la vista actual
    }
  })
  .catch(function(err) {
    console.error(err);
    alert("Hubo un problema al guardar la respuesta: " + err.message);
  });
}
}*/

/*v1 muestra todos los datos de la fila en un modal, no muestra los datos de la respuesta TESAKA
// Reutiliza el modal 'overlay-detalle' que ya posees en el HTML para mostrar info estructurada de la línea
function verDetallesLinea(id) {
  var r = retencionesDB.find(function(x) { return String(x.id) === String(id); });
  if (!r) return;

  document.getElementById("detalle-nro").textContent = r.numDocRet || "—";
  document.getElementById("detalle-proveedor").textContent = r.razonSocial || "—";
  
  // Construimos una visualización detallada en formato texto/HTML
  var esUSDdet = (r.moneda === "DL" || r.moneda === "USD");
  var simDet = esUSDdet ? "USD " : "Gs. ";
  var fmtDet = esUSDdet ? formatearUSD : formatearNumero;

  var detalleHtml = "<div style='line-height: 1.5; font-size: 12px; color: #333;'>" +
    "<strong>RUC:</strong> " + (r.rucProveedor || '—') + "<br/>" +
    "<strong>Timbrado:</strong> " + (r.timbradoProveedor || r.numTimbrado || '—') + "<br/>" +
    "<strong>Nº Factura Asociada:</strong> " + (r.nroFactura || '—') + "<br/>" +
    "<strong>Base Imponible:</strong> " + simDet + fmtDet(r.baseImponible) + "<br/>" +
    "<strong>Monto Retención:</strong> " + simDet + fmtDet(r.montoRetencion) + "<br/>" +
    "<strong>Estado actual:</strong> " + r.estadoSifen + "<br/>" +
    "<strong>Número de control (Respuesta):</strong> " + (r.cdcProveedor || '—') + "<br/>" +
    //
    "<pre style='margin:5px 0 0 0; background:#f5f5f5; padding:6px; font-size:11px; overflow-x:auto'>" + (r.aprobacionComentario || 'Sin comentarios') + "</pre>" +
    "</div>";

  document.getElementById("detalle-motivo").innerHTML = detalleHtml;
  document.getElementById("overlay-detalle").style.display = "flex";
}
  */

function verDetallesLinea(id) {
  var r = retencionesDB.find(function(x) { return String(x.id) === String(id); });
  if (!r) return;

  document.getElementById("detalle-nro").textContent = r.numDocRet || "—";
  document.getElementById("detalle-proveedor").textContent = r.razonSocial || "—";

  var detalleHtml = "<div style='line-height: 1.6; font-size: 13px; color: #333;'>";

  //-detalleHtml += "<strong>N° Comprobante:</strong> " + (r.numDocRet || '—') + "<br>";
  //-detalleHtml += "<strong>Estado SIFEN:</strong> " + (r.estadoSifen || '—') + "<br><br>";

  detalleHtml += "<strong>Estado:</strong> " + (r.aprobacion_estado || '—') + "<br>";
  detalleHtml += "<strong>N° Control:</strong> " + (r.aprobacion_nro_control || '—') + "<br>";
  detalleHtml += "<strong>Comentario:</strong> " + (r.aprobacion_comentario || 'Sin comentario registrado') + "<br>";
  detalleHtml += "</div>";

  document.getElementById("detalle-motivo").innerHTML = detalleHtml;
  document.getElementById("overlay-detalle").style.display = "flex";
}

// === NUEVA FUNCIÓN HELPER (agregada) ===
function mostrarCheckboxesEnDash() {
  return pestanaDashActual === "todas" || pestanaDashActual === "PENDIENTE";
}

setInterval(function() { if (vistaActual === "facturas") cargarFacturas(); }, 60000);