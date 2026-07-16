// =============================================
// CONFIGURACION
// =============================================
var URL_API = "http://127.0.0.1:8080";
// Todas las facturas aplican para retención — no hay filtro de monto mínimo,
// ya que hay pagos que se retienen sin importar el monto (excepciones fiscales).
// Si en el futuro se necesita reactivar, cambiar aplicaRetencion en cargarFacturas().
var MONTO_MINIMO = 0;
var seleccionados = [];
var pestanaActual = "todas";
var facturas = [];
var retencionesDB = [];
var vistaActual = "facturas";
var pestanaDashActual = "PENDIENTE";
var seleccionadosDash = [];

// =============================================
// SESION / ROL (se llenan en el login contra el backend)
// =============================================
var USUARIO_ROL = null;
var USUARIO_ID  = null;
var USUARIO_NOMBRE = null;

// Headers con el token de sesion para acciones protegidas.
function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Auth-Token": (sessionStorage.getItem("authToken") || "")
  };
}

// =============================================
// LOGIN (contra el backend, con BCrypt)
// =============================================
function doLogin() {
  var usuario = document.getElementById("login-usuario").value.trim().toLowerCase();
  var clave   = document.getElementById("login-clave").value;
  if (!usuario || !clave) { mostrarErrorLogin("Ingresa usuario y contrasena."); return; }

  fetch(URL_API + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: usuario, password: clave })
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) {
      mostrarErrorLogin(r.j.error || "Usuario o contrasena incorrectos.");
      document.getElementById("login-clave").value = "";
      document.getElementById("login-clave").focus();
      return;
    }
    // Guardar sesion
    sessionStorage.setItem("authToken", r.j.token);
    sessionStorage.setItem("usr_retencion", r.j.username);
    USUARIO_ROL    = r.j.rol;
    USUARIO_ID     = r.j.id;
    USUARIO_NOMBRE = r.j.nombre;
    document.getElementById("login-error").style.display = "none";
    ingresarAlSistema(r.j.username);
  })
  .catch(function(e){
    mostrarErrorLogin("No se pudo conectar con el servidor: " + e.message);
  });
}

// Restaura la sesion si el token sigue vigente (llamar al cargar la pagina).
function restaurarSesion() {
  var t = sessionStorage.getItem("authToken");
  if (!t) return;
  fetch(URL_API + "/auth/me", { headers: { "X-Auth-Token": t } })
    .then(function(res){ if (!res.ok) throw new Error("expirada"); return res.json(); })
    .then(function(s){
      USUARIO_ROL    = s.rol;
      USUARIO_ID     = s.id;
      USUARIO_NOMBRE = s.nombre;
      ingresarAlSistema(s.username);
    })
    .catch(function(){
      sessionStorage.removeItem("authToken");
      sessionStorage.removeItem("usr_retencion");
    });
}

// Cierra sesion en el backend y limpia el estado local.
function cerrarSesion() {
  var t = sessionStorage.getItem("authToken");
  fetch(URL_API + "/auth/logout", { method: "POST", headers: { "X-Auth-Token": t } })
    .finally(function(){
      sessionStorage.removeItem("authToken");
      sessionStorage.removeItem("usr_retencion");
      USUARIO_ROL = null; USUARIO_ID = null; USUARIO_NOMBRE = null;
      location.reload();
    });
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
  // La pestaña de Administración solo la ve SOPORTE
  var pAdmin = document.getElementById("pestana-admin");
  if (pAdmin) pAdmin.style.display = (USUARIO_ROL === "SOPORTE") ? "inline-block" : "none";
  // Reset de vista al ingresar: siempre arrancar en "Facturas en proceso".
  // Evita que quede la vista del usuario anterior (ej: Administración de soporte).
  vistaActual = "facturas";
  document.getElementById("vista-facturas").style.display  = "block";
  document.getElementById("vista-dashboard").style.display = "none";
  var vAdmin = document.getElementById("vista-admin");
  if (vAdmin) vAdmin.style.display = "none";
  var pestanasMain = document.querySelectorAll(".pestana-main");
  for (var i = 0; i < pestanasMain.length; i++) pestanasMain[i].classList.remove("activa");
  if (pestanasMain[0]) pestanasMain[0].classList.add("activa");
  cargarFacturas();
}

function doLogout() {
  // Cerrar sesión en el backend (invalida el token) y limpiar estado local
  var t = sessionStorage.getItem("authToken");
  if (t) {
    fetch(URL_API + "/auth/logout", { method: "POST", headers: { "X-Auth-Token": t } }).catch(function(){});
  }
  sessionStorage.removeItem("authToken");
  sessionStorage.removeItem("usr_retencion");
  USUARIO_ROL = null; USUARIO_ID = null; USUARIO_NOMBRE = null;
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
  // Restaurar sesion validando el token contra el backend
  restaurarSesion();
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
  var vAdmin = document.getElementById("vista-admin");
  if (vAdmin) vAdmin.style.display = (vista === "admin") ? "block" : "none";
  if (vista === "admin") cargarAdmin();
  var logSeccion = document.querySelector(".log-seccion");
  if (logSeccion) logSeccion.style.display = (vista === "dashboard") ? "block" : "none";
  if (vista === "dashboard") cargarDashboard();
}

// =============================================
// CARGA FACTURAS DESDE SQL ANYWHERE
// =============================================
// Refresh silencioso: actualiza datos en background sin spinner ni parpadeo.
// Solo muestra spinner la primera vez (cuando no hay datos).
var primeraVezFacturas = true;
var primeraVezDash = true;

function cargarFacturas() {
  // Si aún no tenemos los datos de MariaDB (para saber qué facturas ya
  // fueron procesadas), los cargamos primero y luego seguimos.
  if (!retencionesDB || retencionesDB.length === 0) {
    fetch(URL_API + "/retenciones/dashboard")
      .then(function(r){ return r.ok ? r.json() : { retenciones: [] }; })
      .then(function(data){ retencionesDB = data.retenciones || []; })
      .catch(function(){})
      .finally(function(){ cargarFacturasInterno(); });
    return;
  }
  cargarFacturasInterno();
}

function cargarFacturasInterno() {
  if (primeraVezFacturas) {
    document.getElementById("cuerpo-tabla").innerHTML =
      "<tr><td colspan='10' style='text-align:center;padding:2.5rem'>" +
      "<div class='spinner-carga'></div>" +
      "<div style='margin-top:10px;color:#aaa;font-size:13px'>Cargando facturas...</div>" +
      "</td></tr>";
  }
  fetch(URL_API + "/retenciones/pendientes")
    .then(function(r) { if (!r.ok) throw new Error("Error al conectar con la API"); return r.json(); })
    .then(function(datos) {
      primeraVezFacturas = false;
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
        if (esUSD) {
          // Corrección: algunos registros en SQL Anywhere guardan el TC
          // con decimales implícitos (ej: 613098 en vez de 6130.98).
          // Si el TC supera 10.000, se asume que está multiplicado por 100.
          if (tc > 10000) tc = tc / 100;
          tc = Math.round(tc);
        }
        var retUSD = 0, retGS = 0;
        if (esUSD) {
          retUSD = Math.round(((f.montoImpuesto || 0) * 0.30 + (f.montoImpuesto5 || 0) * 0.30) * 100) / 100;
          retGS  = Math.round(retUSD * tc);
        } else {
          retGS = Math.round((f.montoImpuesto || 0) * 0.30 + (f.montoImpuesto5 || 0) * 0.30);
        }
        var totalCompra = f.compra ? (totalesPorCompra[f.compra] || 0) : 0;
        // Todas las facturas aplican para retención (validación de mínimo desactivada)
        var aplicaRetencion = true;
        // Preservar estado local si ya fue procesado en esta sesión
        var existente = facturas.find(function(x) { return x.id === f.factura; });
        return {
          id: f.factura, nro: f.facturaFisica || "—",
          proveedor: f.razonSocial || "Sin nombre", ruc: f.ruc || "",
          // Orden de pago: viene SOLO de ordenes_detalle (JOIN).
          // fr.compra NO es confiable para esto — puede tener valores
          // que no corresponden a una orden real en la tabla ordenes.
          compra: f.ordenPago || null,
          moneda: f.moneda || "GS", tipoCambio: tc,
          monto: (f.montoGravado || 0) + (f.montoGravado5 || 0) + (f.montoExento || 0),
          montoImpuesto: f.montoImpuesto || 0,
          montoImpuesto5: f.montoImpuesto5 || 0,
          tasa: calcularTasa(f), retGS: retGS, retUSD: retUSD, esUSD: esUSD,
          timbrado: f.timbrado || "", fecha: f.fecha || "",
          totalCompra: totalCompra, aplicaRetencion: aplicaRetencion,
          estado: (existente && existente.estado === "PROCESADO") ? "PROCESADO" : "PENDIENTE",
          motivo: ""
        };
      });
      // Filtrar las facturas que YA fueron procesadas en MariaDB.
      // Una factura ya enviada/aprobada no debe seguir en "pendientes de aprobación".
      // Las REVERTIDA se mantienen (vuelven al pool para re-procesarse).
      var idsProcesados = {};
      retencionesDB.forEach(function(r) {
        var estadoR = (r.estadoSifen || "").toUpperCase();
        if (estadoR && estadoR !== "REVERTIDA" && r.idFacturaOrig != null) {
          idsProcesados[String(r.idFacturaOrig)] = true;
        }
      });
      facturas = facturas.filter(function(f) {
        return !idsProcesados[String(f.id)];
      });
      renderTabla();
    })
    .catch(function(error) {
      if (primeraVezFacturas) {
        document.getElementById("cuerpo-tabla").innerHTML =
          "<tr><td colspan='9' style='text-align:center;padding:2rem;color:#aaa'>" +
          "<div class='spinner-carga'></div>" +
          "<div style='margin-top:10px;font-size:13px'>Conectando...</div>" +
          "</td></tr>";
        setTimeout(function() { cargarFacturas(); }, 3000);
      } else {
        mostrarMensaje("No se pudo actualizar las facturas. Se muestra la última versión.", "warning");
      }
    });
}

// =============================================
// CARGA DASHBOARD DESDE MARIADB
// =============================================
function cargarDashboard() {
  if (primeraVezDash) {
    document.getElementById("cuerpo-dashboard").innerHTML =
      "<tr><td colspan='11' style='text-align:center;padding:2.5rem'>" +
      "<div class='spinner-carga'></div>" +
      "<div style='margin-top:10px;color:#aaa;font-size:13px'>Cargando datos...</div>" +
      "</td></tr>";
  }
  fetch(URL_API + "/retenciones/dashboard")
    .then(function(r) { if (!r.ok) throw new Error("Error al cargar dashboard"); return r.json(); })
    .then(function(data) {
      primeraVezDash = false;
      // KPIs del flujo: Pendientes, Enviados, Aprobados, Rechazados
      document.getElementById("dash-pendientes").textContent = data.resumen.pendientes || 0;
      document.getElementById("dash-enviadas").textContent   = data.resumen.enviadas   || 0;
      document.getElementById("dash-aprobados").textContent  = data.resumen.aprobados  || 0;
      document.getElementById("dash-rechazados").textContent = data.resumen.rechazados || 0;
      retencionesDB = data.retenciones || [];
      renderDashboard();
      renderLog(data.logs || []);
    })
    .catch(function(error) {
      if (!primeraVezDash) {
        mostrarMensaje("No se pudo actualizar el dashboard.", "warning");
      } else {
        document.getElementById("cuerpo-dashboard").innerHTML =
          "<tr><td colspan='10' style='text-align:center;padding:2rem;color:#a32d2d'>No se pudo cargar el dashboard: " + error.message + "</td></tr>";
      }
    });
}

function filtrarDashboard() { renderDashboard(); }

function cambiarPestanaDash(nombre, elemento) {
  pestanaDashActual = nombre;
  seleccionadosDash = [];
  actualizarInfoSelDash();
  // Reset visual de TODAS las pestañas del dashboard
  var pestanas = document.querySelectorAll("#vista-dashboard .pestana");
  for (var i = 0; i < pestanas.length; i++) {
    pestanas[i].classList.remove("activa");
    pestanas[i].style.cssText = "border-bottom:3px solid transparent !important;color:#888 !important;font-weight:normal !important;background:transparent !important;";
  }
  // Marcar la activa
  elemento.classList.add("activa");
  elemento.style.cssText = "border-bottom:3px solid #0e347a !important;color:#0e347a !important;font-weight:bold !important;background:transparent !important;";

  // Ocultar/mostrar checkbox y botones según la pestaña
  var mostrarCheckbox = (nombre === "PENDIENTE" || nombre === "RECHAZADO" || nombre === "REVERTIDA");
  var btnDescargar = document.getElementById("btn-descargar-txt");
  var infoSel = document.querySelector("#vista-dashboard .info-seleccion");
  var btnLimpiar = document.querySelector("#vista-dashboard .btn-secundario");
  var checkAll = document.getElementById("dash-check-all");
  if (btnDescargar) btnDescargar.style.display = mostrarCheckbox ? "" : "none";
  if (infoSel) infoSel.style.display = mostrarCheckbox ? "" : "none";
  if (btnLimpiar) btnLimpiar.style.display = mostrarCheckbox ? "" : "none";
  if (checkAll) checkAll.parentElement.style.display = mostrarCheckbox ? "" : "none";

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
  // El botón "Cargar respuestas" solo se ve en la pestaña ENVIADO.
  // Se recalcula en cada render (entrar por primera vez, filtrar, cambiar pestaña).
  var btnCargarResp = document.getElementById("btn-cargar-respuestas");
  if (btnCargarResp) btnCargarResp.style.display = (pestanaDashActual === "ENVIADO") ? "inline-block" : "none";
  var filtrados = retencionesDB.filter(function(r) {
    // Filtrar por pestaña actual.
    // Una REVERTIDA vuelve al pool: se muestra tanto en su pestaña propia
    // como junto a las PENDIENTE (para poder re-descargar el TXT).
    var matchEstado;
    if (pestanaDashActual === "PENDIENTE") {
      matchEstado = (r.estadoSifen === "PENDIENTE" || r.estadoSifen === "REVERTIDA");
    } else {
      matchEstado = r.estadoSifen === pestanaDashActual;
    }
    var matchBuscar = !buscar ||
      (r.ordenPago    && String(r.ordenPago).toLowerCase().indexOf(buscar) !== -1) ||
      (r.rucProveedor && r.rucProveedor.toLowerCase().indexOf(buscar) !== -1) ||
      (r.numDocRet    && r.numDocRet.toLowerCase().indexOf(buscar)    !== -1) ||
      (r.razonSocial  && r.razonSocial.toLowerCase().indexOf(buscar)  !== -1);
    return matchEstado && matchBuscar;
  });
  if (!filtrados.length) {
    tbody.innerHTML = "<tr><td colspan='12' style='text-align:center;padding:2rem;color:#aaa'>Sin resultados</td></tr>";
    return;
  }

  // Checkbox solo en PENDIENTE y RECHAZADO (para descargar TXT)
  var mostrarCheckbox = (pestanaDashActual === "PENDIENTE" || pestanaDashActual === "RECHAZADO" || pestanaDashActual === "REVERTIDA");
  var headerCheckbox = document.querySelector("#vista-dashboard thead th:first-child");
  if (headerCheckbox) headerCheckbox.style.display = mostrarCheckbox ? "" : "none";

  // Botón descargar TXT solo visible en PENDIENTE y RECHAZADO
  var btnDescargar = document.getElementById("btn-descargar-txt");
  if (btnDescargar) btnDescargar.style.display = mostrarCheckbox ? "" : "none";

  var html = "";
  filtrados.forEach(function(r) {
    var esFE = r.cdcProveedor && r.cdcProveedor.trim() !== "";
    var tipoHtml = esFE
      ? "<span class='badge badge-procesado'>Electronica</span>"
      : "<span class='badge badge-sinauth'>Fisica</span>";

    // Indicador visual de rechazo previo
    var fueRechazado = r.aprobacion_estado === "RECHAZADO" || (r.aprobacion_comentario && r.estadoSifen === "ENVIADO");
    var indicadorRechazo = fueRechazado
      ? "<div style='font-size:10px;color:#a32d2d;font-weight:600;margin-top:2px'>⚠ Reenvío</div>" : "";

    // === ACCIONES SEGÚN PESTAÑA ===
    var accion = "";
    if (pestanaDashActual === "PENDIENTE") {
      // Pendiente: sin acciones, solo checkbox para descargar
      accion = "<span style='font-size:11px;color:#888'>Descargar TXT ↑</span>";
    } else if (pestanaDashActual === "ENVIADO") {
      // Enviados a Tesaka: Aprobar o Rechazar
      accion = "<div style='display:flex;flex-direction:column;gap:4px'>" +
        "<button class='btn-reenviar' onclick='abrirAprobarTesaka(" + r.id + ",\"" + (r.numDocRet || "") + "\",\"" + (r.razonSocial || "").replace(/"/g, "&quot;") + "\")' " +
        "style='color:#2d7a0e;border-color:#90c060;background:#f4fbf4'>✓ Aprobar</button>" +
        "<button class='btn-rechazo' onclick='abrirRechazarTesaka(" + r.id + ",\"" + (r.numDocRet || "") + "\",\"" + (r.razonSocial || "").replace(/"/g, "&quot;") + "\")'>" +
        "✕ Rechazar</button></div>";
    } else if (pestanaDashActual === "APROBADO") {
      // Aprobadas: ver detalles. El JEFE ademas puede revertir.
      accion = "<button class='btn-reenviar' onclick='verDetallesLinea(\"" + r.id + "\")' style='color:#666;border-color:#ccc'>Ver Detalles</button>";
      if (USUARIO_ROL === "JEFE") {
        accion += "<button class='btn-rechazo' style='margin-top:4px' onclick='revertirAprobado(" + r.id + ")'>↩ Revertir</button>";
      }
    } else if (pestanaDashActual === "RECHAZADO") {
      // Rechazado: checkbox para re-descargar + ver motivo
      accion = "<button class='btn-rechazo' onclick='verDetallesLinea(\"" + r.id + "\")'>Ver motivo</button>";
    } else if (pestanaDashActual === "REVERTIDA") {
      // Revertida: vuelve al pool, checkbox para re-descargar TXT
      accion = "<span style='font-size:11px;color:#888'>Re-descargar TXT ↑</span>";
    }

    var checked = seleccionadosDash.indexOf(String(r.id)) !== -1 ? "checked" : "";

    // Fila con fondo especial si fue rechazada previamente o revertida
    var esRevertida = (r.estadoSifen === "REVERTIDA" || r.estado === "REVERTIDA");
    var estiloFila = (fueRechazado || esRevertida) ? "background:#fff8f0;border-left:3px solid #f59e0b;" : "";
    html += "<tr style='" + estiloFila + "'>";

    if (mostrarCheckbox) {
      html += "<td><input type='checkbox' class='dash-check-item' data-id='" + r.id + "' " +
              checked + " onchange='toggleSeleccionDash(this.dataset.id, this)'></td>";
    }

    var esUSD = (r.moneda === "DL" || r.moneda === "USD");
    var simbolo = esUSD ? "USD " : "Gs. ";
    var formatMonto = esUSD ? formatearUSD : formatearNumero;

    var base = Number(r.baseImponible) || 0;
    var ret  = Number(r.montoRetencion) || 0;
    var iva  = 0;
    if (ret > 0 && base > 0) {
      iva = ret / (30 / 100);
    }
    var total = base + iva;

    html +=
      "<td style='font-family:monospace;font-size:11px'>" + (r.numDocRet || "—") + indicadorRechazo + "</td>" +
      "<td style='font-family:monospace;font-size:11px'>" + (r.ordenPago || "—") + "</td>" +
      "<td style='font-size:11px'>" + (r.rucProveedor || "—") + "</td>" +
      "<td><strong style='font-size:12px'>" + (r.razonSocial && r.razonSocial.trim() !== "" && ["—","-","---","null","Sin nombre"].indexOf(r.razonSocial.trim()) === -1 ? r.razonSocial : "RUC " + (r.rucProveedor || "s/d")) + "</strong></td>" +
      "<td style='font-family:monospace;font-size:11px'>" + (r.timbradoProveedor || r.numTimbrado || "—") + "</td>" +
      "<td class='der'>" + simbolo + formatMonto(total) + "</td>" +
      "<td class='der'>" + simbolo + formatMonto(iva) + "</td>" +
      "<td class='der'><strong>" + simbolo + formatMonto(ret) + "</strong></td>" +
      "<td>" + tipoHtml + "</td>" +
      "<td>" + badgeDashboard(r.estadoSifen) + "</td>" +
      "<td style='font-size:11px'>" + formatearFecha(r.fechaEnvio) + "</td>" +
      "<td>" + accion + "</td>" +
      "</tr>";
  });
  tbody.innerHTML = html;
}

function badgeDashboard(estado) {
  var map    = { "ENVIADO":"badge-procesado", "PENDIENTE":"badge-pendiente", "ERROR":"badge-rechazado", "RECHAZADO":"badge-rechazado", "APROBADO":"badge-procesado", "REVERTIDA":"badge-revertida" };
  var labels = { "ENVIADO":"Enviado", "PENDIENTE":"Pendiente", "ERROR":"Error", "RECHAZADO":"Rechazado", "APROBADO":"Aprobado", "REVERTIDA":"Revertida" };
  return "<span class='badge " + (map[estado] || "") + "'>" + (labels[estado] || estado) + "</span>";
}

// =============================================
// APROBAR / RECHAZAR EN TESAKA
// =============================================

function abrirAprobarTesaka(id, numDoc, proveedor) {
  document.getElementById("aprobar-tesaka-id").value = id;
  document.getElementById("aprobar-tesaka-info").textContent = numDoc + " — " + proveedor;
  document.getElementById("aprobar-tesaka-numero").value = "";
  document.getElementById("aprobar-tesaka-error").style.display = "none";
  document.getElementById("overlay-aprobar-tesaka").style.display = "flex";
  document.getElementById("aprobar-tesaka-numero").focus();
}

function cerrarAprobarTesaka() {
  document.getElementById("overlay-aprobar-tesaka").style.display = "none";
}

function confirmarAprobarTesaka() {
  var id = document.getElementById("aprobar-tesaka-id").value;
  var numero = document.getElementById("aprobar-tesaka-numero").value.trim();
  var errEl = document.getElementById("aprobar-tesaka-error");
  if (!numero) {
    errEl.textContent = "El número de aprobación es obligatorio.";
    errEl.style.display = "block";
    document.getElementById("aprobar-tesaka-numero").focus();
    return;
  }
  // Solo permite números y guiones (formato: 001-005-0000242)
  if (!/^[\d\-]+$/.test(numero)) {
    errEl.textContent = "El número de control solo debe contener números y guiones (ej: 001-005-0000242).";
    errEl.style.display = "block";
    document.getElementById("aprobar-tesaka-numero").focus();
    return;
  }
  // Buscar el comprobante
  var reg = retencionesDB.find(function(r) { return Number(r.id) === Number(id); });
  var nroComp = reg ? reg.numDocRet : "";

  fetch(URL_API + "/retenciones/guardar-respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nro_comprobante: nroComp,
      estado: "APROBADO",
      aprobacion_nro_control: numero,
      aprobacion_comentario: ""
    })
  })
  .then(function(r) { if (!r.ok) throw new Error("Error al aprobar"); return r.json(); })
  .then(function() {
    cerrarAprobarTesaka();
    // Actualizar el estado local a APROBADO
    fetch(URL_API + "/retenciones/actualizar-estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [Number(id)], estado: "APROBADO" })
    }).then(function() {
      mostrarMensaje("Retención aprobada: " + nroComp, "ok");
      cargarDashboard();
    });
  })
  .catch(function(e) { mostrarMensaje("Error al aprobar: " + e.message, "error"); });
}

// Abre el modal de reversión (solo JEFE). Reemplaza el prompt() del navegador.
var revertirIdActual = null;
function revertirAprobado(id) {
  if (USUARIO_ROL !== "JEFE") {
    alert("Solo el jefe puede revertir una factura aprobada.");
    return;
  }
  revertirIdActual = id;
  // Buscar el comprobante para mostrarlo en el modal
  var reg = retencionesDB.filter(function(r){ return String(r.id) === String(id); })[0];
  document.getElementById("rev-comprobante").textContent =
    reg ? (reg.numDocRet || reg.nroComprobante || ("ID " + id)) : ("ID " + id);
  document.getElementById("rev-motivo").value = "";
  document.getElementById("rev-error").style.display = "none";
  document.getElementById("overlay-revertir").style.display = "flex";
}

function cerrarRevertir() {
  document.getElementById("overlay-revertir").style.display = "none";
  revertirIdActual = null;
}

function confirmarRevertir() {
  var motivo = document.getElementById("rev-motivo").value.trim();
  var err = document.getElementById("rev-error");
  if (!motivo) {
    err.textContent = "El motivo es obligatorio.";
    err.style.display = "block";
    return;
  }
  fetch(URL_API + "/retenciones/revertir/" + revertirIdActual, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ motivo: motivo })
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) { err.textContent = r.j.error || "No se pudo revertir."; err.style.display = "block"; return; }
    cerrarRevertir();
    cargarDashboard();
  })
  .catch(function(e){ err.textContent = "Error de red: " + e.message; err.style.display = "block"; });
}

function abrirRechazarTesaka(id, numDoc, proveedor) {
  document.getElementById("rechazar-tesaka-id").value = id;
  document.getElementById("rechazar-tesaka-info").textContent = numDoc + " — " + proveedor;
  document.getElementById("rechazar-tesaka-motivo").value = "";
  document.getElementById("rechazar-tesaka-error").style.display = "none";
  document.getElementById("overlay-rechazar-tesaka").style.display = "flex";
  document.getElementById("rechazar-tesaka-motivo").focus();
}

function cerrarRechazarTesaka() {
  document.getElementById("overlay-rechazar-tesaka").style.display = "none";
}

function confirmarRechazarTesaka() {
  var id = document.getElementById("rechazar-tesaka-id").value;
  var motivo = document.getElementById("rechazar-tesaka-motivo").value.trim();
  if (!motivo) {
    var err = document.getElementById("rechazar-tesaka-error");
    err.textContent = "El motivo del rechazo es obligatorio.";
    err.style.display = "block";
    document.getElementById("rechazar-tesaka-motivo").focus();
    return;
  }
  var reg = retencionesDB.find(function(r) { return Number(r.id) === Number(id); });
  var nroComp = reg ? reg.numDocRet : "";

  fetch(URL_API + "/retenciones/guardar-respuesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nro_comprobante: nroComp,
      estado: "RECHAZADO",
      aprobacion_nro_control: "",
      aprobacion_comentario: motivo
    })
  })
  .then(function(r) { if (!r.ok) throw new Error("Error al rechazar"); return r.json(); })
  .then(function() {
    cerrarRechazarTesaka();
    fetch(URL_API + "/retenciones/actualizar-estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [Number(id)], estado: "RECHAZADO" })
    }).then(function() {
      mostrarMensaje("Retención rechazada: " + nroComp, "warning");
      cargarDashboard();
    });
  })
  .catch(function(e) { mostrarMensaje("Error al rechazar: " + e.message, "error"); });
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
  if (seleccionados.length === 0) { mostrarMensaje("Seleccioná al menos una factura para aprobar.", "warning"); return; }

  // Validación: todas deben tener orden de pago asignada
  var sinOrden = seleccionados.filter(function(id) {
    var f = facturas.find(function(x) { return String
      (x.id) === String (id); });
    return f && !f.compra;
  });
  if (sinOrden.length > 0) {
    var nombres = sinOrden.slice(0, 3).map(function(id) {
      var f = facturas.find(function(x) { return String(x.id) === String(id); });
      return f ? f.nro : "—";
    }).join(", ") + (sinOrden.length > 3 ? " y " + (sinOrden.length - 3) + " más" : "");
    mostrarMensaje(
      sinOrden.length + " factura/s sin orden de pago (" + nombres + "). Generá primero la orden de pago en el sistema.",
      "error"
    );
    return;
  }

  // Validación: tipo de cambio en USD no puede superar 4 dígitos
  var tcInvalido = seleccionados.filter(function(id) {
    var f = facturas.find(function(x) { return x.id === id; });
    return f && f.esUSD && (f.tipoCambio <= 0 || f.tipoCambio >= 10000);
  });
  if (tcInvalido.length > 0) {
    var nros = tcInvalido.slice(0, 3).map(function(id) {
      var f = facturas.find(function(x) { return x.id === id; });
      return f ? f.nro + " (TC: " + f.tipoCambio + ")" : "—";
    }).join(", ");
    mostrarMensaje(
      tcInvalido.length + " factura/s en USD con tipo de cambio inválido: " + nros +
      ". El TC no puede superar los 4 dígitos (máximo 9.999). Verificá la cotización en el sistema.",
      "error"
    );
    return;
  }

  var cant = seleccionados.length;
  var nombres = seleccionados.slice(0, 3).map(function(id) {
    var f = facturas.find(function(x) { return x.id === id; });
    return f ? f.proveedor : "—";
  }).join(", ") + (cant > 3 ? " y " + (cant - 3) + " más" : "");

  confirmar(
    "Aprobar " + cant + " retención" + (cant > 1 ? "es" : ""),
    "Se enviarán al sistema: <strong>" + nombres + "</strong>.<br/>Esta acción no se puede deshacer.",
    "Aprobar " + cant, "Cancelar"
  ).then(function(ok) {
    if (!ok) return;

    var btn = document.getElementById("btn-aprobar");
    btn.disabled = true;
    btn.innerHTML = "<span class='spinner-btn'></span> Procesando...";

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

      if (errores.length > 0 && exitosos.length > 0) {
        mostrarMensaje(exitosos.length + " aprobada/s correctamente. " + errores.length + " con error.", "warning");
        errores.forEach(function(e) { mostrarMensaje(e.motivo, "error"); });
      } else if (errores.length > 0) {
        errores.forEach(function(e) { mostrarMensaje(e.motivo, "error"); });
      } else {
        mostrarMensaje(cant + " retención" + (cant > 1 ? "es" : "") + " aprobada" + (cant > 1 ? "s" : "") + " correctamente", "ok");
      }
    })
    .catch(function(e) {
      mostrarMensaje("Error de conexión: " + e.message, "error");
    })
    .finally(function() {
      btn.disabled = false; btn.innerHTML = "✓ Aprobar Facturas";
    });
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
  var soloConOrden = document.getElementById("filtro-con-orden").checked;
  var tbody = document.getElementById("cuerpo-tabla");
  var html = "", encontrados = 0;
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    if (pestanaActual !== "todas" && f.estado !== pestanaActual) continue;
    if (buscar !== "" && f.proveedor.toLowerCase().indexOf(buscar) === -1 && f.ruc.indexOf(buscar) === -1 && String(f.compra || "").indexOf(buscar) === -1 && (f.nro || "").indexOf(buscar) === -1) continue;
    if (mesFiltro !== "" && obtenerMesFactura(f.fecha) !== mesFiltro) continue;
    if (soloConOrden && !f.compra) continue;
    encontrados++;
    // Bloquear selección si la factura NO tiene orden de pago asignada
    var tieneOrdenPago = !!f.compra;
    // Validar tipo de cambio en USD: no puede superar 4 dígitos (máx 9.999)
    var tcValido = !f.esUSD || (f.tipoCambio > 0 && f.tipoCambio < 10000);
    var puedeSel = (f.estado === "PENDIENTE" || f.estado === "PENDIENTE_AUTH") && tieneOrdenPago && tcValido;
    var checked  = seleccionados.indexOf(f.id) !== -1 ? "checked" : "";
    var disabled = !puedeSel ? "disabled" : "";
    // Celda de orden de pago con aviso visual cuando no tiene
    var ordenPagoHtml = tieneOrdenPago
      ? "<span style='font-family:monospace;font-size:11px'>" + f.compra + "</span>"
      : "<span style='display:inline-flex;align-items:center;gap:4px;color:#a32d2d;font-size:11px;font-weight:600' " +
        "title='Esta factura no tiene orden de pago asignada. No se puede procesar la retención hasta que se genere una.'>" +
        "⚠ Sin orden</span>";
    // Aviso de tipo de cambio inválido en facturas USD
    var tcAviso = "";
    if (f.esUSD && !tcValido) {
      tcAviso = "<div style='font-size:10px;color:#a32d2d;font-weight:600' " +
        "title='El tipo de cambio supera 4 dígitos. Verificar la cotización cargada en el sistema.'>⚠ TC inválido</div>";
    }
    // Mostrar el desglose: monto total (IVA incluido), IVA, retención
    var impuesto = (f.montoImpuesto || 0) + (f.montoImpuesto5 || 0);
    var montoTotal = f.monto + impuesto; // f.monto = base sin IVA
    var montoHtml = f.esUSD
      ? "USD " + formatearUSD(montoTotal) + "<div style='font-size:10px;color:#444;font-weight:600'>TC: " + formatearNumero(f.tipoCambio) + "</div>" + tcAviso
      : "Gs. " + formatearNumero(montoTotal);
    var ivaHtml = f.esUSD
      ? "USD " + formatearUSD(impuesto)
      : "Gs. " + formatearNumero(impuesto);
    var retHtml = f.esUSD
      ? "USD " + formatearUSD(f.retUSD) + "<div style='font-size:10px;color:#444;font-weight:600'>Gs. " + formatearNumero(f.retGS) + "</div>"
      : "Gs. " + formatearNumero(f.retGS);
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
      "<td>" + ordenPagoHtml + "</td>" +
      "<td>" + f.moneda + "</td>" +
      "<td class='der'>" + montoHtml + "</td>" +
      "<td class='der'>" + ivaHtml + "</td>" +
      "<td class='der'><strong>" + retHtml + "</strong></td>" +
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
  var conOrden = 0, sinOrden = 0;
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    if (f.estado === "PENDIENTE_AUTH") sinauth++;
    if (f.estado === "PENDIENTE")      pendiente++;
    if (f.estado === "PROCESADO")      procesado++;
    if (f.estado === "RECHAZADO")      rechazado++;
    // Desglose de pendientes por orden de pago
    if (f.estado === "PENDIENTE" || f.estado === "PENDIENTE_AUTH") {
      if (f.compra) conOrden++;
      else sinOrden++;
    }
  }
  var elTotal = document.getElementById("stat-total");
  var elPendiente = document.getElementById("stat-pendiente");
  var elConOrden = document.getElementById("stat-con-orden");
  var elSinOrden = document.getElementById("stat-sin-orden");
  if (elTotal) elTotal.textContent = facturas.length;
  if (elPendiente) elPendiente.textContent = pendiente;
  if (elConOrden) elConOrden.textContent = conOrden;
  if (elSinOrden) elSinOrden.textContent = sinOrden;
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
  var soloConOrden = document.getElementById("filtro-con-orden").checked;
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    // Respetar filtros activos
    if (pestanaActual !== "todas" && f.estado !== pestanaActual) continue;
    if (buscar !== "" && f.proveedor.toLowerCase().indexOf(buscar) === -1 && f.ruc.indexOf(buscar) === -1 && String(f.compra || "").indexOf(buscar) === -1 && (f.nro || "").indexOf(buscar) === -1) continue;
    if (mesFiltro !== "" && obtenerMesFactura(f.fecha) !== mesFiltro) continue;
    if (soloConOrden && !f.compra) continue;
    // Seleccionar todas las pendientes visibles CON orden de pago y TC válido
    if ((f.estado === "PENDIENTE" || f.estado === "PENDIENTE_AUTH") && f.compra) {
      var esUSD = (f.moneda === "DL" || f.moneda === "USD");
      var tcOk = !esUSD || (f.tipoCambio > 0 && f.tipoCambio < 10000);
      if (tcOk) seleccionados.push(f.id);
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
  var pestanas = document.querySelectorAll("#vista-facturas .pestana");
  for (var i = 0; i < pestanas.length; i++) pestanas[i].classList.remove("activa");
  elemento.classList.add("activa");

  if (nombre === "PROCESADO") {
    // "Facturas aprobadas" = historial real desde MariaDB
    renderHistorialAprobadas();
  } else {
    // Ocultar el contenedor de historial y mostrar la tabla normal
    var hist = document.getElementById("historial-aprobadas");
    if (hist) hist.style.display = "none";
    // Ocultar los filtros propios del historial (quedaban colgados al volver)
    var filtrosHist = document.getElementById("filtros-historial");
    if (filtrosHist) filtrosHist.style.display = "none";
    // Restaurar los encabezados originales de la tabla de facturas
    // (renderHistorialAprobadas los había reemplazado)
    var theadFact = document.getElementById("cuerpo-tabla").closest("table").querySelector("thead tr");
    if (theadFact) {
      theadFact.innerHTML =
        "<th style='width:36px'></th>" +
        "<th>Nº Factura</th><th>Proveedor / RUC</th><th>Orden Pago</th><th>Moneda</th>" +
        "<th class='der'>Monto Total</th><th class='der'>IVA</th><th class='der'>Retención 30%</th>" +
        "<th>Fecha Emisión</th><th>Estado</th>";
    }
    document.getElementById("cuerpo-tabla").parentElement.style.display = "";
    document.querySelector("#vista-facturas .barra-acciones").style.display = "";
    renderTabla();
  }
}

/**
 * Muestra el historial de facturas aprobadas desde MariaDB.
 * Reemplaza la tabla de facturas con una vista de solo lectura.
 */
function renderHistorialAprobadas() {
  // Ocultar barra de acciones (checkboxes, botón aprobar, filtros de factura)
  document.querySelector("#vista-facturas .barra-acciones").style.display = "none";

  // Usar el mismo tbody de la tabla existente
  var tbody = document.getElementById("cuerpo-tabla");
  tbody.innerHTML = "<tr><td colspan='10' style='text-align:center;padding:2rem;color:#aaa'>" +
    "<div class='spinner-carga'></div><div style='margin-top:8px'>Cargando historial...</div></td></tr>";

  // Insertar filtros del historial ANTES de la tabla (si no existen)
  var filtrosHist = document.getElementById("filtros-historial");
  if (!filtrosHist) {
    filtrosHist = document.createElement("div");
    filtrosHist.id = "filtros-historial";
    filtrosHist.style.cssText = "display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap";
    var tablaContenedor = tbody.closest(".tabla-contenedor");
    tablaContenedor.parentElement.insertBefore(filtrosHist, tablaContenedor);
  }
  filtrosHist.style.display = "flex";
  filtrosHist.innerHTML =
    "<input type='text' id='filtro-historial' placeholder='Buscar proveedor, RUC o Nº orden...' " +
    "oninput='filtrarHistorial()' style='padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;width:280px'>" +
    "<select id='filtro-historial-mes' onchange='filtrarHistorial()' style='padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px'>" +
    "<option value=''>Todos los meses</option>" +
    "<option value='01'>Enero</option><option value='02'>Febrero</option>" +
    "<option value='03'>Marzo</option><option value='04'>Abril</option>" +
    "<option value='05'>Mayo</option><option value='06'>Junio</option>" +
    "<option value='07'>Julio</option><option value='08'>Agosto</option>" +
    "<option value='09'>Septiembre</option><option value='10'>Octubre</option>" +
    "<option value='11'>Noviembre</option><option value='12'>Diciembre</option>" +
    "</select>" +
    "<span id='historial-count' style='font-size:12px;color:#888'></span>";

  // Cambiar los encabezados de la tabla
  var thead = tbody.closest("table").querySelector("thead tr");
  thead.innerHTML =
    "<th>Comprobante</th><th>Orden Pago</th><th>Proveedor</th><th>Timbrado</th>" +
    "<th class='der'>Monto Total</th><th class='der'>IVA</th><th class='der'>Retención</th>" +
    "<th>Estado</th><th>Fecha</th>";

  fetch(URL_API + "/retenciones/dashboard")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var retenciones = data.retenciones || [];
      if (!retenciones.length) {
        tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;padding:2rem;color:#aaa'>No hay facturas procesadas aún</td></tr>";
        return;
      }

      var html = "";
      retenciones.forEach(function(r) {
        var esUSD = (r.moneda === "DL" || r.moneda === "USD");
        var sim = esUSD ? "USD " : "Gs. ";
        var fmt = esUSD ? formatearUSD : formatearNumero;
        var base = Number(r.baseImponible) || 0;
        var ret = Number(r.montoRetencion) || 0;
        var iva = ret > 0 ? ret / 0.30 : 0;
        var total = base + iva;
        var fechaStr = r.fechaEnvio ? String(r.fechaEnvio) : "";
        var mes = fechaStr.length >= 7 ? fechaStr.substring(5, 7) : "";

        html += "<tr class='fila-historial' data-buscar='" +
          ((r.razonSocial || "") + (r.rucProveedor || "") + (r.ordenPago || "") + (r.numDocRet || "")).toLowerCase() +
          "' data-mes='" + mes + "'>" +
          "<td style='font-family:monospace;font-size:11px'>" + (r.numDocRet || "—") + "</td>" +
          "<td style='font-family:monospace;font-size:11px'>" + (r.ordenPago || "—") + "</td>" +
          "<td><strong style='font-size:12px'>" + (r.razonSocial || "—") + "</strong><div style='font-size:10px;color:#888'>" + (r.rucProveedor || "") + "</div></td>" +
          "<td style='font-family:monospace;font-size:11px'>" + (r.timbradoProveedor || r.numTimbrado || "—") + "</td>" +
          "<td class='der'>" + sim + fmt(total) + "</td>" +
          "<td class='der'>" + sim + fmt(iva) + "</td>" +
          "<td class='der'><strong>" + sim + fmt(ret) + "</strong></td>" +
          "<td>" + badgeDashboard(r.estadoSifen) + "</td>" +
          "<td style='font-size:11px'>" + formatearFecha(r.fechaEnvio) + "</td></tr>";
      });
      tbody.innerHTML = html;
      filtrarHistorial();
    })
    .catch(function(e) {
      tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;padding:2rem;color:#a32d2d'>Error: " + e.message + "</td></tr>";
    });
}

function filtrarHistorial() {
  var buscar = (document.getElementById("filtro-historial").value || "").toLowerCase();
  var mes = document.getElementById("filtro-historial-mes").value;
  var filas = document.querySelectorAll(".fila-historial");
  var visibles = 0;
  for (var i = 0; i < filas.length; i++) {
    var data = filas[i].getAttribute("data-buscar") || "";
    var mesFila = filas[i].getAttribute("data-mes") || "";
    var mostrar = (!buscar || data.indexOf(buscar) !== -1) && (!mes || mesFila === mes);
    filas[i].style.display = mostrar ? "" : "none";
    if (mostrar) visibles++;
  }
  var countEl = document.getElementById("historial-count");
  if (countEl) countEl.textContent = visibles + " registro" + (visibles !== 1 ? "s" : "");
}
// =============================================
// SISTEMA DE NOTIFICACIONES (TOASTS)
// =============================================
var toastContador = 0;

/**
 * Muestra un toast profesional con icono y auto-dismiss.
 * Tipos: "ok", "error", "info", "warning"
 */
function mostrarMensaje(texto, tipo) {
  tipo = tipo || "info";
  var iconos = { ok: "✓", error: "✕", info: "ℹ", warning: "⚠" };
  var colores = {
    ok:      { bg: "#ecfdf5", border: "#10b981", text: "#065f46", icon: "#10b981" },
    error:   { bg: "#fef2f2", border: "#ef4444", text: "#991b1b", icon: "#ef4444" },
    info:    { bg: "#eff6ff", border: "#3b82f6", text: "#1e40af", icon: "#3b82f6" },
    warning: { bg: "#fffbeb", border: "#f59e0b", text: "#92400e", icon: "#f59e0b" }
  };
  var c = colores[tipo] || colores.info;
  var id = "toast-" + (++toastContador);

  // Crear contenedor si no existe
  var contenedor = document.getElementById("toast-container");
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.id = "toast-container";
    contenedor.style.cssText = "position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;max-width:420px;";
    document.body.appendChild(contenedor);
  }

  var toast = document.createElement("div");
  toast.id = id;
  toast.style.cssText = "display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:8px;" +
    "background:" + c.bg + ";border-left:4px solid " + c.border + ";color:" + c.text + ";" +
    "font-size:13px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,0.15);" +
    "transform:translateX(120%);transition:transform 0.3s ease,opacity 0.3s ease;opacity:0;cursor:pointer;";
  toast.innerHTML =
    "<span style='font-size:18px;color:" + c.icon + ";flex-shrink:0;line-height:1'>" + iconos[tipo] + "</span>" +
    "<span style='flex:1'>" + texto + "</span>" +
    "<span style='color:#999;font-size:16px;margin-left:8px;cursor:pointer' onclick='cerrarToast(\"" + id + "\")'>×</span>";
  toast.onclick = function() { cerrarToast(id); };

  contenedor.appendChild(toast);
  // Animate in
  requestAnimationFrame(function() {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  });

  // Auto-dismiss
  var duracion = tipo === "error" ? 8000 : 4000;
  setTimeout(function() { cerrarToast(id); }, duracion);
}

function cerrarToast(id) {
  var toast = document.getElementById(id);
  if (!toast) return;
  toast.style.transform = "translateX(120%)";
  toast.style.opacity = "0";
  setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
}

/**
 * Muestra un diálogo de confirmación profesional (reemplaza confirm() nativo).
 * Devuelve una Promise que resuelve a true/false.
 */
function confirmar(titulo, mensaje, textoSi, textoNo) {
  textoSi = textoSi || "Confirmar";
  textoNo = textoNo || "Cancelar";
  return new Promise(function(resolve) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);" +
      "display:flex;align-items:center;justify-content:center;z-index:10001;animation:fadeIn .2s ease;";
    overlay.innerHTML =
      "<div style='background:#fff;border-radius:12px;padding:28px 32px;max-width:400px;width:90%;" +
      "box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp .25s ease'>" +
        "<h3 style='margin:0 0 8px;font-size:16px;color:#1a1a1a'>" + titulo + "</h3>" +
        "<p style='margin:0 0 24px;color:#666;font-size:13px;line-height:1.5'>" + mensaje + "</p>" +
        "<div style='display:flex;gap:10px;justify-content:flex-end'>" +
          "<button id='confirm-no' style='padding:8px 20px;border:1px solid #ddd;background:#fff;" +
            "border-radius:6px;cursor:pointer;font-size:13px;color:#555'>" + textoNo + "</button>" +
          "<button id='confirm-si' style='padding:8px 20px;border:none;background:#2d7a0e;color:#fff;" +
            "border-radius:6px;cursor:pointer;font-size:13px;font-weight:600'>" + textoSi + "</button>" +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.querySelector("#confirm-si").onclick = function() { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector("#confirm-no").onclick = function() { document.body.removeChild(overlay); resolve(false); };
    overlay.querySelector("#confirm-si").focus();
  });
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
 * CONFIGURACIÓN DE RETENCIÓN — ⚠️ CONFIRMAR CON EL CONTADOR ⚠️
 *
 * El sistema calcula la retención como impuesto × 30% (SOLO IVA).
 * Por coherencia, retenerRenta debe ser false: si fuera true, Tesaka
 * emitiría un comprobante que ADEMÁS retiene renta sobre la base
 * (un monto mucho mayor al registrado en este sistema).
 *
 * Si DUTRIEC también debe retener renta, cambiar retenerRenta a true,
 * ajustar rentaPorcentaje al valor que indique el contador, y actualizar
 * el cálculo en FacturaController.enviarLote() para incluirla.
 */
var RETENCION_CONFIG = {
  retenerIva: true,
  ivaPorcentaje10: 30,
  ivaPorcentaje5: 30,
  retenerRenta: false,
  rentaPorcentaje: 0
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

      // Determinar la tasa del IVA que aplica al detalle de la retención.
      // FIX Bug tasa: r.ivaPorcentaje10 no viene del dashboard, era una comparación
      // que siempre daba false y todo caía en "0" (exento). Ahora se usa montoRetencion:
      // si hay retención calculada, hubo IVA (la retención es SOLO sobre el impuesto).
      // Para distinguir 10% vs 5% se usa el ratio retencion/base ≈ 2.72% para 10%
      // (10/11 * 30%) vs ≈ 1.30% para 5% (5/21 * 30%).
      var tasaDetalle = "0"; // exento por defecto
      var montoRet = Number(r.montoRetencion) || 0;
      var baseImp = Number(r.baseImponible) || 0;
      if (montoRet > 0 && baseImp > 0) {
        var ratio = montoRet / baseImp;
        tasaDetalle = ratio > 0.02 ? "10" : "5"; // 10% da ~2.72%, 5% da ~1.30%
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

      // ⚠ REGLA FISCAL IMPORTANTE (evita multa de Gs. 50.000):
      // Si la condición es CONTADO y la factura tiene MÁS DE 7 DÍAS,
      // la DNIT multa por comunicación tardía de retención. En CRÉDITO
      // la fecha no importa. Por eso, si detectamos que la fecha del
      // comprobante es vieja, forzamos CREDITO automáticamente.
      var fechaComprobante = r.fechaFactura
        ? new Date(String(r.fechaFactura).substring(0, 10))
        : (r.fechaEnvio ? new Date(String(r.fechaEnvio).substring(0, 10)) : null);
      if (condicion === "CONTADO" && fechaComprobante && !isNaN(fechaComprobante)) {
        var hoy = new Date();
        var diasTranscurridos = Math.floor((hoy - fechaComprobante) / (1000 * 60 * 60 * 24));
        if (diasTranscurridos > 7) {
          condicion = "CREDITO";
          console.info("Factura " + nroComprobante + " tiene " + diasTranscurridos +
            " días — forzada a CRÉDITO para evitar multa por comunicación tardía");
        }
      }

      var cuotas = condicion === "CREDITO" ? (Number(r.cuotas) || 1) : 0;

      // FIX Bug precioUnitario: la especificación exige que para importes
      // gravados el precio sea IVA INCLUIDO (Tesaka calcula base = precio/11).
      // baseImponible viene SIN IVA de MariaDB, así que derivamos el impuesto
      // desde el monto de retención: impuesto = retencion / (ivaPct/100).
      var precioIvaIncluido = Number(r.baseImponible) || 0;
      var esUSDtxt = (r.moneda === "USD" || r.moneda === "DL");
      if (tasaDetalle === "10" || tasaDetalle === "5") {
        var pctAplicado = tasaDetalle === "10"
          ? RETENCION_CONFIG.ivaPorcentaje10 : RETENCION_CONFIG.ivaPorcentaje5;
        var impuestoDerivado = pctAplicado > 0
          ? (Number(r.montoRetencion) || 0) / (pctAplicado / 100) : 0;
        precioIvaIncluido = precioIvaIncluido + impuestoDerivado;
      }
      // Redondeo: USD a 2 decimales, PYG a entero (sin decimales)
      precioIvaIncluido = esUSDtxt
        ? Math.round(precioIvaIncluido * 100) / 100
        : Math.round(precioIvaIncluido);

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
          "domicilio": esContribuyente ? (r.direccionProveedor || "Domicilio Fiscal") : "",
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
          // FIX Bug fecha: usar la fecha de la FACTURA del proveedor
          // (fechaFactura, nueva columna). fechaEnvio solo como fallback.
          "fecha": r.fechaFactura ? String(r.fechaFactura).substring(0, 10)
                 : (r.fechaEnvio ? String(r.fechaEnvio).substring(0, 10) : getFechaLocal()),
          // FIX: el campo correcto es timbradoProveedor (timbrado de la factura
          // del proveedor desde SQL Anywhere). numTimbrado era el timbrado de DUTRIEC
          // que venía como "PENDIENTE_TIMBRADO" y Tesaka rechazaba.
          "numeroTimbrado": String(r.timbradoProveedor || r.numTimbrado || r.timbrado || "")
        },
        "detalle": [
          {
            "cantidad": 1,
            "tasaAplica": tasaDetalle,
            "precioUnitario": precioIvaIncluido,
            // Descripción: usa el concepto/comentario de la factura si existe.
            // Fallback: referencia al comprobante.
            "descripcion": r.concepto && String(r.concepto).trim() !== ""
              ? String(r.concepto).trim().substring(0, 300)
              : "Retención correspondiente a Comprobante de Venta Nro: " + (nroComprobante || "—")
          }
        ],
        "retencion": {
          "fecha": getFechaLocal(),
          "moneda": (r.moneda === "USD" || r.moneda === "DL") ? "USD" : "PYG",
          // FIX Bug renta: el sistema calcula SOLO retención de IVA (impuesto × 30%).
          // Antes se enviaba retencionRenta: true + rentaPorcentaje: 10, lo que hacía
          // que Tesaka calcule ADEMÁS una retención de renta del 10% sobre la base —
          // un monto mucho mayor al registrado en MariaDB.
          // Configuración centralizada en RETENCION_CONFIG (arriba del archivo).
          "retencionRenta": RETENCION_CONFIG.retenerRenta,
          "conceptoRenta": RETENCION_CONFIG.retenerRenta ? CONCEPTOS_RENTA[situacion] : "",
          "retencionIva": RETENCION_CONFIG.retenerIva,
          "conceptoIva": RETENCION_CONFIG.retenerIva ? "IVA.1" : "",
          "rentaPorcentaje": RETENCION_CONFIG.rentaPorcentaje,
          "rentaCabezasBase": 0,
          "rentaCabezasCantidad": 0,
          "rentaToneladasBase": 0,
          "rentaToneladasCantidad": 0,
          "ivaPorcentaje5": tasaDetalle === "5" ? RETENCION_CONFIG.ivaPorcentaje5 : 0,
          "ivaPorcentaje10": tasaDetalle === "10" ? RETENCION_CONFIG.ivaPorcentaje10 : 0
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

  // Si hubo filas inválidas, informar al usuario con toasts
  if (erroresValidacion.length > 0) {
    console.warn("Retenciones con errores (excluidas del archivo):");
    erroresValidacion.forEach(function(e) { console.warn("  " + e); });
    // Mostrar cada error como toast individual (máx 5 para no saturar)
    var maxToasts = Math.min(erroresValidacion.length, 5);
    for (var i = 0; i < maxToasts; i++) {
      mostrarMensaje(erroresValidacion[i], "error");
    }
    if (erroresValidacion.length > 5) {
      mostrarMensaje("... y " + (erroresValidacion.length - 5) + " errores más (ver consola F12)", "warning");
    }
  }

  if (arregloJson.length === 0) {
    mostrarMensaje("Ninguna retención pasó la validación. Corregí los datos e intentá de nuevo.", "error");
    return;
  }

  // Convertimos el arreglo completo a una cadena JSON con indentación limpia de 2 espacios
  var contenidoTxt = JSON.stringify(arregloJson, null, 2);

  // Nombre del archivo: incluye proveedor y orden de pago para identificación
  var primerIdSel = seleccionadosDash.length > 0 ? Number(seleccionadosDash[0]) : null;
  var primerReg = primerIdSel !== null
    ? retencionesDB.find(function(r) { return Number(r.id) === primerIdSel; })
    : null;
  var nombreProv = primerReg && primerReg.razonSocial
    ? primerReg.razonSocial.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30)
    : "varios";
  var nroOrden = primerReg && primerReg.ordenPago
    ? "_OP" + primerReg.ordenPago
    : "";
  var cantProv = arregloJson.length > 1 ? "_" + arregloJson.length + "ret" : "";
  var nombreArchivo = "retenciones_" + nombreProv + nroOrden + cantProv + "_" + getFechaLocal() + ".txt";

  // Crear el Blob y forzar la descarga del archivo plano .txt conteniendo el JSON
  var blob = new Blob([contenidoTxt], { type: "text/plain;charset=utf-8;" });
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
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
    mostrarMensaje("Especificá el Número de Comprobante.", "warning");
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
    mostrarMensaje("Respuesta guardada correctamente", "ok");
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
    mostrarMensaje("Error al guardar respuesta: " + err.message, "error");
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
  return pestanaDashActual === "PENDIENTE" || pestanaDashActual === "RECHAZADO";
}

// Auto-refresh silencioso: facturas cada 60s, dashboard cada 120s.
// El usuario no ve spinner ni parpadeo — solo se actualizan los datos.
setInterval(function() { if (vistaActual === "facturas") cargarFacturas(); }, 60000);
setInterval(function() { if (vistaActual === "dashboard") cargarDashboard(); }, 120000);

// =============================================
// ADMINISTRACION (solo SOPORTE)
// =============================================
function cargarAdmin() {
  cargarUsuariosAdmin();
  cargarIncidencias();
}

function cargarUsuariosAdmin() {
  fetch(URL_API + "/retenciones/usuarios", { headers: authHeaders() })
    .then(function(res){ if (!res.ok) throw new Error("no autorizado"); return res.json(); })
    .then(function(usuarios){
      var tbody = document.getElementById("tbody-usuarios");
      var select = document.getElementById("cp-usuario");
      tbody.innerHTML = "";
      select.innerHTML = "<option value=''>— Elegí un usuario —</option>";
      usuarios.forEach(function(u){
        var activo = (u.activo === true || u.activo === 1 || u.activo === "1");
        tbody.innerHTML +=
          "<tr style='border-bottom:1px solid #eee'>" +
          "<td style='padding:8px'>" + u.username + "</td>" +
          "<td style='padding:8px'>" + (u.nombre || "") + "</td>" +
          "<td style='padding:8px'>" + u.rol + "</td>" +
          "<td style='padding:8px'>" + (activo ? "Sí" : "No") + "</td>" +
          "</tr>";
        select.innerHTML += "<option value='" + u.username + "'>" + u.username + " (" + u.rol + ")</option>";
      });
    })
    .catch(function(e){
      document.getElementById("tbody-usuarios").innerHTML =
        "<tr><td colspan='4' style='padding:8px;color:#a32d2d'>No se pudieron cargar los usuarios.</td></tr>";
    });
}

function cargarIncidencias() {
  fetch(URL_API + "/retenciones/auditoria/incidencias", { headers: authHeaders() })
    .then(function(res){ if (!res.ok) throw new Error("no autorizado"); return res.json(); })
    .then(function(filas){
      var tbody = document.getElementById("tbody-incidencias");
      var vacio = document.getElementById("incidencias-vacio");
      tbody.innerHTML = "";
      if (!filas || filas.length === 0) { vacio.style.display = "block"; return; }
      vacio.style.display = "none";
      filas.forEach(function(r){
        tbody.innerHTML +=
          "<tr style='border-bottom:1px solid #eee'>" +
          "<td style='padding:8px'>" + (r.nro_comprobante || "") + "</td>" +
          "<td style='padding:8px'>" + (r.razon_social || "") + "</td>" +
          "<td style='padding:8px'>" + (r.estado || "") + "</td>" +
          "<td style='padding:8px;text-align:center;font-weight:600'>" + (r.veces_revertida || 0) + "</td>" +
          "<td style='padding:8px;text-align:center;font-weight:600'>" + (r.veces_rechazada || 0) + "</td>" +
          "</tr>";
      });
    })
    .catch(function(e){
      document.getElementById("tbody-incidencias").innerHTML =
        "<tr><td colspan='5' style='padding:8px;color:#a32d2d'>No se pudieron cargar las incidencias.</td></tr>";
    });
}

// Genera el hash de la contraseña en el backend y da de alta el usuario
function crearUsuario() {
  var msg = document.getElementById("nu-msg");
  var username = document.getElementById("nu-username").value.trim();
  var nombre   = document.getElementById("nu-nombre").value.trim();
  var password = document.getElementById("nu-password").value;
  var rol      = document.getElementById("nu-rol").value;

  if (!username || !password) { msg.style.color = "#a32d2d"; msg.textContent = "Usuario y contraseña son obligatorios."; return; }
  if (password.length < 6)    { msg.style.color = "#a32d2d"; msg.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }

  msg.style.color = "#666"; msg.textContent = "Creando...";

  // Paso 1: generar el hash BCrypt en el backend
  fetch(URL_API + "/auth/hash", {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ password: password })
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) throw new Error(r.j.error || "No se pudo generar el hash.");
    // Paso 2: crear el usuario con el hash
    return fetch(URL_API + "/retenciones/usuarios", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ username: username, password_hash: r.j.hash, nombre: nombre, rol: rol })
    });
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) { msg.style.color = "#a32d2d"; msg.textContent = r.j.error || "No se pudo crear."; return; }
    msg.style.color = "#2d7a0e"; msg.textContent = "Usuario creado correctamente.";
    document.getElementById("nu-username").value = "";
    document.getElementById("nu-nombre").value = "";
    document.getElementById("nu-password").value = "";
    cargarUsuariosAdmin();
  })
  .catch(function(e){ msg.style.color = "#a32d2d"; msg.textContent = e.message; });
}

// Cambia la contraseña de un usuario: genera hash nuevo y lo guarda
function cambiarPassword() {
  var msg = document.getElementById("cp-msg");
  var username = document.getElementById("cp-usuario").value;
  var password = document.getElementById("cp-password").value;

  if (!username) { msg.style.color = "#a32d2d"; msg.textContent = "Elegí un usuario."; return; }
  if (password.length < 6) { msg.style.color = "#a32d2d"; msg.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }

  msg.style.color = "#666"; msg.textContent = "Cambiando...";

  fetch(URL_API + "/auth/hash", {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ password: password })
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) throw new Error(r.j.error || "No se pudo generar el hash.");
    return fetch(URL_API + "/retenciones/usuarios/password", {
      method: "PUT", headers: authHeaders(),
      body: JSON.stringify({ username: username, password_hash: r.j.hash })
    });
  })
  .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
  .then(function(r){
    if (!r.ok) { msg.style.color = "#a32d2d"; msg.textContent = r.j.error || "No se pudo cambiar."; return; }
    msg.style.color = "#2d7a0e"; msg.textContent = "Contraseña actualizada.";
    document.getElementById("cp-password").value = "";
  })
  .catch(function(e){ msg.style.color = "#a32d2d"; msg.textContent = e.message; });
}


// Muestra u oculta el texto de un campo de contraseña (botón "Ver"/"Ocultar")
function toggleVerPass(inputId, elemento) {
  var input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    elemento.textContent = "Ocultar";
  } else {
    input.type = "password";
    elemento.textContent = "Ver";
  }
}


// =============================================
// CARGAR RESPUESTAS TESAKA (JSON) — automatiza aprobación/rechazo
// =============================================
function cargarRespuestasJson(inputFile) {
  var file = inputFile.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var data;
    try {
      data = JSON.parse(e.target.result);
    } catch (err) {
      mostrarMensaje("El archivo no es un JSON válido: " + err.message, "error");
      inputFile.value = "";
      return;
    }
    // El JSON de Tesaka es un array de comprobantes
    var lista = Array.isArray(data) ? data : [data];
    procesarRespuestasTesaka(lista);
    inputFile.value = "";
  };
  reader.onerror = function() {
    mostrarMensaje("No se pudo leer el archivo.", "error");
    inputFile.value = "";
  };
  reader.readAsText(file);
}

// Extrae de cada comprobante el nro y el estado, y llama a guardar-respuesta.
// Formato real del TXT de Tesaka: array de { datos:{transaccion,...}, estado, recepcion:{...} }
function procesarRespuestasTesaka(lista) {
  var items = [];
  var vistos = {};       // para detectar comprobantes duplicados dentro del archivo
  var duplicados = 0;
  var borradores = 0;

  lista.forEach(function(item) {
    var datos = item.datos || item;
    var recepcion = item.recepcion || {};
    var trans = (datos && datos.transaccion) ? datos.transaccion : {};

    var nroVenta = trans.numeroComprobanteVenta || datos.id || null;
    if (!nroVenta) return;

    var estadoRaw = (item.estado || "").toString().toLowerCase();
    var recOk = recepcion.recepcionCorrecta;
    var procOk = recepcion.procesamientoCorrecto;
    var estado;
    if (recOk === false || procOk === false) {
      estado = "RECHAZADO";
    } else if (recOk === true && procOk === true) {
      estado = "APROBADO";
    } else if (estadoRaw === "enviado") {
      estado = "APROBADO";
    } else if (estadoRaw === "borrador") {
      borradores++;
      return;  // borrador: aun no procesado, se ignora
    } else {
      estado = "APROBADO";
    }

    // Deduplicar: si el mismo comprobante aparece dos veces en el archivo,
    // solo procesamos el primero (el segundo UPDATE seria redundante).
    var clave = String(nroVenta).replace(/-/g, "");
    if (vistos[clave]) { duplicados++; return; }
    vistos[clave] = true;

    var comentario = recepcion.mensajeProcesamiento || recepcion.mensajeRecepcion || null;
    var nroControl = recepcion.numeroControl || null;

    items.push({
      nro_comprobante: String(nroVenta),
      nro_comprobante_normalizado: clave,
      estado: estado,
      aprobacion_nro_control: nroControl,
      aprobacion_comentario: comentario
    });
  });

  if (items.length === 0) {
    var vacio = "No se encontraron comprobantes procesables en el archivo.";
    if (duplicados > 0) vacio += " (" + duplicados + " duplicado(s))";
    if (borradores > 0) vacio += " (" + borradores + " en borrador)";
    mostrarMensaje(vacio, "error");
    return;
  }

  mostrarMensaje("Procesando " + items.length + " comprobante(s) unico(s)...", "info");

  var aprobadas = 0, rechazadas = 0, noEncontrados = 0, errCount = 0;
  var promesas = items.map(function(it) {
    return fetch(URL_API + "/retenciones/guardar-respuesta", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify(it)
    })
    .then(function(res){ return res.json().then(function(j){ return { status: res.status, j: j, estado: it.estado }; }); })
    .then(function(r){
      if (r.status === 200) {
        if (r.estado === "RECHAZADO") rechazadas++; else aprobadas++;
      } else if (r.status === 404) {
        noEncontrados++;
      } else {
        errCount++;
      }
    })
    .catch(function(){ errCount++; });
  });

  Promise.all(promesas).then(function(){
    // Armar un desglose claro de lo que paso
    var partes = [];
    if (aprobadas > 0)     partes.push(aprobadas + " aprobada(s)");
    if (rechazadas > 0)    partes.push(rechazadas + " rechazada(s)");
    if (noEncontrados > 0) partes.push(noEncontrados + " no encontrada(s)");
    if (errCount > 0)      partes.push(errCount + " con error");
    if (duplicados > 0)    partes.push(duplicados + " duplicado(s) omitido(s)");
    if (borradores > 0)    partes.push(borradores + " en borrador");

    var msg = partes.join(", ");
    // Tipo de mensaje segun el resultado global
    var tipo = "ok";
    if (aprobadas === 0 && rechazadas === 0) tipo = "error";
    else if (noEncontrados > 0 || errCount > 0) tipo = "warning";

    mostrarMensaje(msg, tipo);
    cargarDashboard();
  });
}