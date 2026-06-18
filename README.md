# API Retenciones SIFEN — DUTRIEC SA

Sistema de gestión y envío automático de comprobantes de retención al SIFEN (SET Paraguay) y TESAKA (DNIT).

**Empresa:** DUTRIEC SA  
**RUC:** 80015056-2  

---

## Tecnologías

| Componente | Tecnología |
|---|---|
| Backend | Spring Boot 3.5 — Java 21 |
| Base de datos legada | SQL Anywhere (solo lectura) |
| Base de datos local | MariaDB — puerto 3306 |
| Frontend | HTML + JS + CSS (servido por Spring Boot) |

---

## Requisitos previos

- Java 21 instalado
- MariaDB corriendo en `localhost:3306`
- Acceso a SQL Anywhere (IP configurada en `DataSourceConfig.java`)
- Maven (incluido como `mvnw`)

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/Nicoib25/api-retenciones.git
cd api-retenciones
```

### 2. Instalar el driver de SQL Anywhere

El driver `jconn3.jar` está en la carpeta `libs/`. Instalarlo en Maven local:

```bash
mvn install:install-file -Dfile=libs/jconn3-11.0.jar -DgroupId=com.sybase -DartifactId=jconn3 -Dversion=11.0 -Dpackaging=jar
```

### 3. Crear la base de datos MariaDB

Ejecutar el script en MariaDB:

```bash
mysql -u root retenciones_sifen < retenciones_sifen.sql
```

O abrir el archivo `retenciones_sifen.sql` en un gestor de base de datos (ej. Heidisql o Dbeaver) y ejecutarlo.

### 4. Configurar credenciales

Editar `src/main/resources/application.properties` con las credenciales de MariaDB y SQL Anywhere.

### 5. Compilar y ejecutar

```bash
mvnw spring-boot:run
```

Cuando aparezca `Started ApiRetencionesApplication` el servidor está listo en `http://localhost:8080`.

---

## Acceso a la interfaz

Abrir el navegador y entrar a:

```
http://localhost:8080/index.html
```

**Usuarios disponibles:**

| Usuario | Contraseña |
|---|---|
| admin | dutriec2026 |
| vgimenez | sifen2026 |
| operador | ret2026 |

---

## Estructura del proyecto

```
api-retenciones/
├── src/main/java/com/dutriec/apiretenciones/
│   ├── ApiRetencionesApplication.java   ← Clase principal
│   ├── DataSourceConfig.java            ← Configuración SQL Anywhere + MariaDB
│   ├── Factura.java                     ← Modelo de factura
│   ├── FacturaController.java           ← Endpoints de facturas
│   ├── FacturaRepository.java           ← Consultas SQL Anywhere
│   ├── RetencionRepository.java         ← Operaciones MariaDB
│   ├── DashboardController.java         ← Dashboard control de envíos
│   ├── TesakaController.java            ← Generador JSON TESAKA
│   ├── SifenRequest.java                ← DTO para el colega SIFEN
│   └── Resultado.java                   ← Modelo de resultado
├── src/main/resources/
│   ├── application.properties           ← Configuración
│   └── static/                          ← Frontend HTML/JS/CSS
│       ├── index.html
│       ├── css/estilos.css
│       └── js/retenciones.js
├── libs/
│   └── jconn3-11.0.jar                  ← Driver SQL Anywhere
└── retenciones_sifen.sql                ← Script BD MariaDB
```

---

## Endpoints principales

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/retenciones/pendientes` | Facturas pendientes de SQL Anywhere |
| POST | `/retenciones/enviar-lote` | Enviar retenciones al SIFEN |
| GET | `/retenciones/dashboard` | Datos del dashboard desde MariaDB |
| POST | `/retenciones/reenviar/{id}` | Reenviar retención con error |
| POST | `/retenciones/generar-tesaka` | Generar JSON para TESAKA (DNIT) |

---

## Endpoint del colega (SIFEN)

El sistema envía retenciones al endpoint del colega:

```
POST /retenciones/evento/xml
Content-Type: application/json
```

**Caso factura electrónica (con CDC):**
```json
{
  "facturaElectronica": true,
  "cdcDte": "CDC de 44 dígitos del proveedor",
  "rucRetenedor": "80015056-2",
  "rucContribuyente": "RUC del proveedor",
  "numTimbre": "timbrado de retención DUTRIEC",
  "establecimiento": "001",
  "puntoExpedicion": "001",
  "numDocRet": "0000001",
  "codControlRet": "ABC123XYZ",
  "fechaEmisionRet": "2026-06-17T08:00:00",
  "montoRetencion": 1500000,
  "baseImponible": 5000000,
  "porcentajeRetencion": 30,
  "concepto": "Retenciones en carácter de pago a cuenta"
}
```

**Caso factura física (sin CDC):**
```json
{
  "facturaElectronica": false,
  "numFacturaFisica": "001-001-0000456",
  "rucRetenedor": "80015056-2",
  "rucContribuyente": "RUC del proveedor",
  ...
}
```

---

## JSON para TESAKA (DNIT)

El endpoint `POST /retenciones/generar-tesaka` genera un archivo JSON compatible con TESAKA.

**Body:**
```json
{ "ids": [3195, 3196, 3197] }
```

**Respuesta:** descarga automática del archivo `tesaka_YYYYMMDD.json`

---

## Base de datos MariaDB

**BD:** `retenciones_sifen` — puerto 3306

| Tabla | Descripción |
|---|---|
| `retenciones_enviadas` | Registro de todas las retenciones procesadas |
| `log_envios` | Log de envíos al colega |
| `configuracion` | Parámetros del sistema (timbrado, etc.) |

**Estados posibles en `retenciones_enviadas`:**

| Estado | Descripción |
|---|---|
| `PENDIENTE` | Guardado, sin enviar |
| `ENVIADO` | Enviado al colega, XML generado |
| `APROBADO` | Aprobado por SIFEN |
| `ERROR` | Error en el envío |
| `FISICA_MANUAL` | Factura física, retención manual |
| `TESAKA_GENERADO` | JSON generado para TESAKA |
| `SIMULADO` | Modo prueba |

---

## Pendientes para producción

| Item | Responsable |
|---|---|
| URL real del endpoint del colega | Colega confirma |
| Columna `cdc_proveedor` en SQL Anywhere | DBA |
| Permiso SELECT en `proveedores_migra` | DBA |
| Timbrado de retención de DUTRIEC | Trámite ante la SET |
| Certificado digital para firma | SET — ambiente de pruebas |

---

## Configuración del colega en application.properties

```properties
# URL del endpoint del colega
sifen.colega.url=http://localhost:8081

# false = simulación, true = envío real
sifen.colega.activo=false

# Timbrado (cargar también en tabla configuracion de MariaDB)
# sifen.timbrado.retencion=12345678
```
